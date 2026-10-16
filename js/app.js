/**
 * Misskey WordCloud Generator - Main App Controller
 */

document.addEventListener("DOMContentLoaded", () => {
  // Lucide Icons 初期化
  if (window.lucide) {
    lucide.createIcons();
  }

  // DOM Elements
  const form = document.getElementById("generator-form");
  const usernameInput = document.getElementById("username-input");
  const serverHostInput = document.getElementById("server-host");
  const includeHomeCheck = document.getElementById("include-home-check");

  const wordCountSlider = document.getElementById("word-count");
  const wordCountVal = document.getElementById("word-count-val");
  const bgStyleSelect = document.getElementById("bg-style");
  const rotationModeSelect = document.getElementById("rotation-mode");

  // Sections
  const inputSection = document.getElementById("input-section");
  const loadingSection = document.getElementById("loading-section");
  const resultsSection = document.getElementById("results-section");

  // Loading UI
  const loadingTitle = document.getElementById("loading-title");
  const progressBar = document.getElementById("progress-bar");
  const stepFetch = document.getElementById("step-fetch");
  const stepAnalyze = document.getElementById("step-analyze");
  const stepRender = document.getElementById("step-render");

  // Results UI
  const resultUserTitle = document.getElementById("result-user-title");
  const statsText = document.getElementById("stats-text");
  const canvasCard = document.getElementById("canvas-card");
  const canvas = document.getElementById("wordcloud-canvas");
  const downloadBtn = document.getElementById("download-btn");
  const misskeyShareLink = document.getElementById("misskey-share-link");
  const copyTextBtn = document.getElementById("copy-text-btn");
  const regenerateBtn = document.getElementById("regenerate-btn");
  const backBtn = document.getElementById("back-btn");
  const keywordsList = document.getElementById("keywords-list");
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toast-message");

  // State
  let currentResult = null;
  const renderer = new WordCloudRenderer(canvas);

  /* ==========================================================================
     UI Event Handlers
     ========================================================================== */

  // 単語数スライダーの数値反映
  wordCountSlider.addEventListener("input", (e) => {
    wordCountVal.textContent = `${e.target.value}語`;
  });

  // フォーム送信（ワードクラウド生成開始）
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = usernameInput.value.trim();
    const serverHost = serverHostInput.value.trim() || "misskey.io";
    const maxWords = parseInt(wordCountSlider.value, 10);
    const includeHome = includeHomeCheck ? includeHomeCheck.checked : true;

    if (!username) {
      alert("ユーザー名を入力してください。");
      usernameInput.focus();
      return;
    }

    // 画面切り替え: 入力 → ローディング
    inputSection.classList.add("hidden");
    resultsSection.classList.add("hidden");
    loadingSection.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });

    // ステップインジケーターのリセット
    const scopeDesc = includeHome ? "" : " (publicのみ)";
    updateLoadingStep("fetch", 15, `@${username} のデータを取得中${scopeDesc}...`);

    try {
      // Misskey API呼び出し（ノート取得 ＆ カスタム絵文字解析 ＆ 画像プリロード）
      const result = await window.SNSWordCloudAPI.fetchUserPostsAndAnalyze({
        username,
        serverHost,
        maxWords,
        includeHome,
        onProgress: ({ step, progress, message }) => {
          updateLoadingStep(step, progress, message);
        }
      });

      currentResult = result;

      // ワードクラウド描画実行
      renderCurrentResult();

      // 画面切り替え: ローディング → 結果画面
      setTimeout(() => {
        loadingSection.classList.add("hidden");
        resultsSection.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
        showToast("ワードクラウドが完成しました！");
      }, 350);

    } catch (err) {
      console.error(err);
      alert(err.message || "ワードクラウドの生成中にエラーが発生しました。");
      loadingSection.classList.add("hidden");
      inputSection.classList.remove("hidden");
    }
  });

  // 再配置（同じ単語セットで別の螺旋レイアウトを再計算）
  regenerateBtn.addEventListener("click", () => {
    if (!currentResult) return;
    // 単語の並び順を少しシャッフル
    currentResult.words.sort(() => Math.random() - 0.5);
    renderCurrentResult();
    showToast("配置を再シャッフルしました");
  });

  // 設定に戻るボタン
  backBtn.addEventListener("click", () => {
    resultsSection.classList.add("hidden");
    inputSection.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // 画像ダウンロードボタン（高解像度PNG保存）
  downloadBtn.addEventListener("click", () => {
    if (!currentResult) return;

    try {
      const dataUrl = renderer.toDataURL("image/png");
      const link = document.createElement("a");
      const safeUser = currentResult.username.replace(/[^a-zA-Z0-9_\-]/g, "_");
      link.download = `misskey_wordcloud_${safeUser}_${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showToast("PNG画像をダウンロードしました！");
    } catch (err) {
      console.error("ダウンロードエラー:", err);
      alert("画像のダウンロードに失敗しました。CORS保護によりCanvasが制限されている可能性があります。");
    }
  });

  // 共有テキストのコピーボタン
  copyTextBtn.addEventListener("click", () => {
    if (!currentResult) return;
    const shareText = buildShareText(currentResult);
    navigator.clipboard.writeText(shareText).then(() => {
      showToast("投稿テキストをクリップボードにコピーしました！");
    }).catch(() => {
      prompt("以下のテキストをコピーしてください:", shareText);
    });
  });

  // オプション（パレット・背景・回転）変更時に即座に再描画
  [bgStyleSelect, rotationModeSelect].forEach(select => {
    select.addEventListener("change", () => {
      if (currentResult && !resultsSection.classList.contains("hidden")) {
        renderCurrentResult();
      }
    });
  });

  /* ==========================================================================
     Helper Functions
     ========================================================================== */

  function updateLoadingStep(step, percent, title) {
    progressBar.style.width = `${percent}%`;
    if (title) loadingTitle.textContent = title;

    [stepFetch, stepAnalyze, stepRender].forEach(el => el.classList.remove("active", "done"));
    if (step === "fetch") {
      stepFetch.classList.add("active");
    } else if (step === "analyze") {
      stepFetch.classList.add("done");
      stepAnalyze.classList.add("active");
    } else if (step === "render" || step === "done") {
      stepFetch.classList.add("done");
      stepAnalyze.classList.add("done");
      stepRender.classList.add("active");
    }
  }

  function renderCurrentResult() {
    if (!currentResult) return;

    const { username, userDisplayName, serverHost, totalPosts, words, includeHome } = currentResult;

    // タイトルと統計表示
    const fullHandle = `@${username}@${serverHost}`;
    resultUserTitle.textContent = `${userDisplayName ? `${userDisplayName} (${fullHandle})` : fullHandle} のワードクラウド`;
    const scopeLabel = includeHome ? "ホーム含む" : "publicのみ";
    statsText.textContent = `取得ノート: ${totalPosts}件 (${scopeLabel}) / 抽出単語・絵文字: ${words.length}語`;

    // Canvas描画パラメータ
    const paletteName = "misskey";
    const bgStyle = bgStyleSelect.value;
    const rotationMode = rotationModeSelect.value;

    if (canvasCard) {
      canvasCard.classList.toggle("light-bg", bgStyle === "light");
    }

    renderer.render({
      words,
      paletteName,
      bgStyle,
      rotationMode,
      title: `${fullHandle} Word Cloud`,
      subtitle: `${totalPosts} notes analyzed`
    });

    // キーワード一覧タグ生成
    populateKeywordsList(words);

    // シェアリンクの更新
    updateShareLinks(currentResult);
  }

  function populateKeywordsList(words) {
    keywordsList.innerHTML = "";
    const topWords = words.slice(0, 15);

    topWords.forEach((item, index) => {
      const tag = document.createElement("button");
      tag.className = "keyword-tag";

      let wordContent = escapeHtml(item.word);
      if (item.isEmoji && item.emojiUrl) {
        // カスタム絵文字タグ
        wordContent = `
          <img src="${escapeHtml(item.emojiUrl)}" alt="${escapeHtml(item.word)}" class="tag-emoji-img" onerror="this.style.display='none'">
          <span class="tag-emoji-name">${escapeHtml(item.word)}</span>
        `;
      }

      tag.innerHTML = `
        <span class="tag-rank">#${index + 1}</span>
        <span class="tag-name">${wordContent}</span>
        <span class="tag-count">${item.weight}回</span>
      `;

      tag.addEventListener("click", () => {
        renderer.render({
          words: currentResult.words,
          paletteName: "misskey",
          bgStyle: bgStyleSelect.value,
          rotationMode: rotationModeSelect.value,
          title: `@${currentResult.username}@${currentResult.serverHost} Word Cloud`,
          subtitle: `${currentResult.totalPosts} notes analyzed`
        });
        renderer.highlightWord(item.word);
        showToast(`「${item.word}」を強調表示しました`);
      });

      keywordsList.appendChild(tag);
    });
  }

  function buildShareText(result) {
    const top5 = result.words.slice(0, 5).map(w => w.word).join(" ");
    const fullHandle = `@${result.username}@${result.serverHost}`;
    return `${fullHandle} のワードクラウドを作成しました！\n頻出キーワードTOP5: ${top5}\n\n#MisskeyWordCloudGenerator`;
  }

  function updateShareLinks(result) {
    const shareText = buildShareText(result);
    const pageUrl = window.location.href;

    // MisskeyShare ( https://misskeyshare.link/ ) のURL形式
    // https://misskeyshare.link/share.html?text=YOUR_MESSAGE&url=YOUR_URL
    const misskeyUrl = `https://misskeyshare.link/share.html?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`;
    misskeyShareLink.href = misskeyUrl;

    // ポップアップウィンドウで開く
    misskeyShareLink.onclick = (e) => {
      e.preventDefault();
      window.open(misskeyUrl, "misskeyshare", "width=550,height=450,menubar=no,toolbar=no,status=no");
    };
  }

  let toastTimer = null;
  function showToast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    toastMessage.textContent = message;
    toast.classList.remove("hidden");

    toastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
