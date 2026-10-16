/**
 * Misskey WordCloud Generator - API Module
 * 
 * Misskey API を使用して、指定したサーバー・ユーザーから直近のノートを取得し、
 * 本文・CWから形態素・単語およびカスタム絵文字（:emoji:）を抽出します。
 */

// ノイズとなる一般的な助詞・代名詞・記号等のストップワード
const STOP_WORDS = new Set([
  "これ", "それ", "あれ", "どれ", "ここ", "そこ", "こと", "もの", "ため", "よう",
  "そう", "どう", "どこ", "だれ", "なに", "何", "やつ", "さん", "くん", "ちゃん",
  "https", "http", "t", "co", "jp", "com", "www", "する", "ある", "いる",
  "れる", "られる", "ない", "なる", "できる", "思う", "言う", "いく", "くる",
  "今日", "昨日", "明日", "毎日", "自分", "私", "僕", "俺", "みんな", "たち",
  "ほんと", "本当に", "マジ", "感じ", "気", "最近", "今", "あと", "前", "次"
]);

/**
 * サーバーホスト名の正規化
 * 例: "https://sushi.ski/" -> "sushi.ski"
 */
function normalizeHost(host) {
  if (!host) return "misskey.io";
  return host.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * ユーザー名の正規化
 * 例: "@syuilo" -> "syuilo"
 */
function normalizeUsername(username) {
  if (!username) return "";
  return username.trim().replace(/^@/, "");
}

/**
 * Misskey API 汎用POSTリクエスト
 */
async function callMisskeyApi(host, endpoint, body = {}) {
  const url = `https://${host}/api/${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = `HTTP ${response.status} ${response.statusText}`;
    }
    throw new Error(`Misskey API (${endpoint}) エラー: ${errorDetail}`);
  }

  return await response.json();
}

/**
 * サーバーのカスタム絵文字一覧を取得してマップを作成
 */
async function fetchServerEmojisMap(host) {
  const emojiMap = new Map();
  try {
    const data = await callMisskeyApi(host, "emojis");
    const emojis = data?.emojis || (Array.isArray(data) ? data : []);
    emojis.forEach(e => {
      if (e.name && e.url) {
        emojiMap.set(e.name, e.url);
        if (Array.isArray(e.aliases)) {
          e.aliases.forEach(alias => {
            if (alias) emojiMap.set(alias, e.url);
          });
        }
      }
    });
  } catch (err) {
    console.warn("サーバー全体のカスタム絵文字取得に失敗しました（個別ノートのemojis等で代替します）:", err);
  }
  return emojiMap;
}

/**
 * ユーザーのノートをAPIから取得（最大200件）
 * @param {string} host - Misskeyサーバーホスト
 * @param {string} userId - 対象ユーザーID
 * @param {number} targetCount - 取得目標件数
 * @param {Function} onProgress - 進捗コールバック
 * @param {boolean} includeHome - ホーム投稿を含めるかどうか（falseなら visibility === "public" のみ）
 */
async function fetchUserNotes(host, userId, targetCount = 200, onProgress = () => {}, includeHome = true) {
  const allNotes = [];
  let untilId = null;
  let fetchAttempts = 0;
  const maxAttempts = 12; // 過剰なAPIコール防止（ホーム除外時に最大1200件まで探索）

  while (allNotes.length < targetCount && fetchAttempts < maxAttempts) {
    fetchAttempts++;
    const fetchLimit = Math.min(100, (targetCount - allNotes.length) * 2); // 余裕を持って取得
    const body = {
      userId,
      limit: Math.max(20, Math.min(100, fetchLimit)),
      includeReplies: true,
      includeMyRenotes: false
    };
    if (untilId) {
      body.untilId = untilId;
    }

    const notes = await callMisskeyApi(host, "users/notes", body);
    if (!Array.isArray(notes) || notes.length === 0) {
      break;
    }

    // visibilityフィルタ: includeHomeがfalseなら "public" のみ抽出
    const filteredNotes = includeHome
      ? notes
      : notes.filter(n => n.visibility === "public");

    allNotes.push(...filteredNotes);
    untilId = notes[notes.length - 1].id;

    onProgress({
      step: "fetch",
      progress: Math.min(45, 20 + Math.round((allNotes.length / targetCount) * 25)),
      message: `ノートを取得中... (${allNotes.length}件${!includeHome ? " / publicのみ" : ""})`
    });

    if (notes.length < body.limit) {
      // ユーザーの過去ノートが尽きた場合
      break;
    }
  }

  // targetCount件までに調整
  return allNotes.slice(0, targetCount);
}

/**
 * ノート群からカスタム絵文字と通常単語を抽出
 */
function extractWordsAndEmojis(notes, serverEmojiMap, host) {
  // wordKey -> { word, count, isEmoji, emojiName, emojiUrl }
  const wordStats = new Map();

  // ノート内のローカル/リモート絵文字マッピングを補完
  const noteEmojisMap = new Map();
  notes.forEach(note => {
    // note.emojis が配列の場合: [{ name: "...", url: "..." }]
    if (Array.isArray(note.emojis)) {
      note.emojis.forEach(e => {
        if (e.name && e.url) noteEmojisMap.set(e.name, e.url);
      });
    } else if (note.emojis && typeof note.emojis === "object") {
      // note.emojis がオブジェクトの場合: { "name": "url" }
      Object.entries(note.emojis).forEach(([name, url]) => {
        if (name && url) noteEmojisMap.set(name, url);
      });
    }

    // reactionEmojis からも補完
    if (Array.isArray(note.reactionEmojis)) {
      note.reactionEmojis.forEach(e => {
        if (e.name && e.url) noteEmojisMap.set(e.name, e.url);
      });
    }
  });

  // MFM関数（$[scale ...], $[shake ...] 等）やメンション・URLを除去する正規表現
  const mfmRegex = /\$\[[a-zA-Z0-9_.]+(?:\.[a-zA-Z0-9_.]+)?(?:\([^\)]*\))?(?:[^\s\]]+)?\s*/g;
  const urlRegex = /https?:\/\/[^\s]+/g;
  const mentionRegex = /@[\w\-.]+(?:@[\w\-.]+)?/g;

  // カスタム絵文字の正規表現: :emoji_name: または :emoji_name@remote.host: または :emoji_name@.:
  const customEmojiRegex = /:([a-zA-Z0-9_+-]+)(?:@([a-zA-Z0-9_.-]+))?:/g;

  // 日本語名詞・単語・英単語の抽出パターン（2文字以上）
  const tokenRegex = /([#＃][\w\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF_-]+|[a-zA-Z0-9_+#.-]{2,}|[ァ-ヶー]{2,}|[一-龠]{2,}|[一-龠ァ-ヶa-zA-Z]{2,})/g;

  notes.forEach(note => {
    // text と cw の両方を対象にする
    const rawTexts = [note.text, note.cw].filter(Boolean);
    if (rawTexts.length === 0) return;

    rawTexts.forEach(rawText => {
      // 1. URL・メンション・MFMタグの除去
      let cleaned = rawText
        .replace(urlRegex, " ")
        .replace(mentionRegex, " ")
        .replace(mfmRegex, " ")
        .replace(/\]/g, " ");

      // 2. カスタム絵文字の抽出とカウント
      const emojiMatches = Array.from(cleaned.matchAll(customEmojiRegex));
      emojiMatches.forEach(match => {
        const fullMatch = match[0]; // 例: ":blobcat:" または ":blobcat@sushi.ski:"
        const name = match[1];      // 例: "blobcat"
        const remoteHost = match[2];

        // 絵文字URLの解決
        let emojiUrl = serverEmojiMap.get(name) || noteEmojisMap.get(name);
        
        // リモート指定がない、または自ホスト/ローカル指定の場合
        if (!emojiUrl && (!remoteHost || remoteHost === "." || remoteHost === host)) {
          emojiUrl = serverEmojiMap.get(name);
        }

        const key = fullMatch;
        if (!wordStats.has(key)) {
          wordStats.set(key, {
            word: key,
            count: 0,
            isEmoji: true,
            emojiName: name,
            emojiUrl: emojiUrl || null
          });
        }
        wordStats.get(key).count += 1;
      });

      // 3. カスタム絵文字部分を空白に置換してから通常単語を抽出
      const textWithoutEmojis = cleaned.replace(customEmojiRegex, " ");
      const wordMatches = textWithoutEmojis.match(tokenRegex) || [];

      wordMatches.forEach(token => {
        const word = token.trim();
        // ハッシュタグ
        const isHashtag = word.startsWith("#") || word.startsWith("＃");
        const cleanWord = isHashtag ? word : word.replace(/^#/, "");

        if (cleanWord.length >= 2 && !STOP_WORDS.has(cleanWord) && !STOP_WORDS.has(cleanWord.toLowerCase())) {
          if (!wordStats.has(cleanWord)) {
            wordStats.set(cleanWord, {
              word: cleanWord,
              count: 0,
              isEmoji: false,
              emojiName: null,
              emojiUrl: null
            });
          }
          wordStats.get(cleanWord).count += 1;
        }
      });
    });
  });

  return Array.from(wordStats.values());
}

/**
 * カスタム絵文字画像を事前にロード
 * CORS対応でHTMLImageElementを準備
 */
async function preloadEmojiImages(words) {
  const emojiItems = words.filter(w => w.isEmoji && w.emojiUrl);
  
  const promises = emojiItems.map(item => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        item.image = img;
        resolve();
      };
      img.onerror = () => {
        console.warn(`絵文字画像の読み込みに失敗しました (${item.word}):`, item.emojiUrl);
        item.image = null; // フォールバック用
        resolve();
      };
      img.src = item.emojiUrl;
    });
  });

  await Promise.all(promises);
}

/**
 * 外部公開API: 指定サーバー・ユーザーの投稿取得から解析・画像準備までを実行
 * 
 * @param {Object} params
 * @param {string} params.username - ユーザー名
 * @param {string} params.serverHost - Misskeyサーバーホスト（例: 'sushi.ski', 'misskey.io'）
 * @param {number} params.maxWords - 最大単語数
 * @param {boolean} params.includeHome - ホーム投稿を含めるかどうか（falseなら visibility === "public" のみ）
 * @param {Function} params.onProgress - 進捗コールバック
 * @returns {Promise<{ username: string, serverHost: string, totalPosts: number, words: Array, includeHome: boolean }>}
 */
async function fetchUserPostsAndAnalyze({
  username = "",
  serverHost = "misskey.io",
  maxWords = 50,
  includeHome = true,
  onProgress = () => {}
}) {
  const host = normalizeHost(serverHost);
  const cleanUsername = normalizeUsername(username);

  if (!cleanUsername) {
    throw new Error("ユーザー名を入力してください。");
  }

  // 1. ユーザー情報とサーバーカスタム絵文字一覧の並行取得
  onProgress({
    step: "fetch",
    progress: 15,
    message: `ユーザー @${cleanUsername} を検索中 (${host})...`
  });

  let user = null;
  let serverEmojiMap = new Map();

  try {
    const [userData, emojiMap] = await Promise.all([
      callMisskeyApi(host, "users/show", { username: cleanUsername }),
      fetchServerEmojisMap(host)
    ]);
    user = userData;
    serverEmojiMap = emojiMap;
  } catch (err) {
    throw new Error(`ユーザー「@${cleanUsername}」がサーバー「${host}」で見つかりませんでした。\n(${err.message})`);
  }

  // 2. ノートの取得（直近100〜200件）
  onProgress({
    step: "fetch",
    progress: 30,
    message: `@${cleanUsername} の直近ノートを取得中...`
  });

  const notes = await fetchUserNotes(host, user.id, 200, onProgress, includeHome);

  if (notes.length === 0) {
    const scopeMsg = includeHome ? "公開ノート（パブリック・ホーム）" : "公開ノート（パブリックのみ）";
    throw new Error(`ユーザー @${cleanUsername} の${scopeMsg}が見つかりませんでした。`);
  }

  // 3. 形態素・単語抽出 ＆ カスタム絵文字の検出
  onProgress({
    step: "analyze",
    progress: 60,
    message: `${notes.length}件のノートから単語・カスタム絵文字を抽出中...`
  });

  // 少し描画スレッドに余裕を持たせるための短い待機
  await new Promise(r => setTimeout(r, 50));

  const allWords = extractWordsAndEmojis(notes, serverEmojiMap, host);

  if (allWords.length === 0) {
    throw new Error("ノートから単語を抽出できませんでした。");
  }

  // 出現頻度順にソートし、最大単語数まで取得
  allWords.sort((a, b) => b.count - a.count);
  const topWords = allWords.slice(0, maxWords).map(item => ({
    ...item,
    weight: item.count
  }));

  // 4. カスタム絵文字画像のプリロード
  onProgress({
    step: "analyze",
    progress: 78,
    message: "カスタム絵文字画像を読み込んでいます..."
  });

  await preloadEmojiImages(topWords);

  // 5. ワードクラウド配置
  onProgress({
    step: "render",
    progress: 92,
    message: "ワードクラウドを生成中..."
  });

  await new Promise(r => setTimeout(r, 100));

  return {
    username: cleanUsername,
    userDisplayName: user.name || cleanUsername,
    serverHost: host,
    totalPosts: notes.length,
    words: topWords,
    includeHome
  };
}

// グローバルに公開
window.SNSWordCloudAPI = {
  fetchUserPostsAndAnalyze,
  normalizeHost,
  normalizeUsername
};
