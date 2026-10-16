/**
 * Misskey WordCloud - Canvas Word Cloud Renderer
 * 
 * 純粋なHTML5 Canvas上で螺旋配置（Archimedean spiral）と
 * AABBコリジョン判定を用いて、日本語テキストおよび
 * Misskeyのカスタム絵文字画像を美しくレイアウトする描画エンジン。
 */

const PALETTES = {
  // 黒背景用パレット（黒背景でハッキリ見える明るい高コントラスト色）
  dark: {
    misskey: [
      "#a3e635", "#bef264", "#ffffff", "#4ade80", "#22d3ee", "#86b300", "#e2e8f0"
    ],
    colorful: [
      "#38bdf8", "#f472b6", "#facc15", "#c084fc", "#4ade80", "#ffffff", "#fb923c"
    ],
    monochrome: [
      "#ffffff", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8"
    ],
    ocean: [
      "#38bdf8", "#22d3ee", "#818cf8", "#67e8f9", "#ffffff", "#0284c7"
    ],
    sunset: [
      "#fb7185", "#f97316", "#facc15", "#fda4af", "#ffffff", "#fb923c"
    ]
  },
  // 白背景用パレット（白背景でハッキリ見える濃い高コントラスト色、淡色・白色は不使用）
  light: {
    misskey: [
      "#15803d", "#166534", "#3f6212", "#0f172a", "#1e3a8a", "#14532d", "#334155"
    ],
    colorful: [
      "#1d4ed8", "#be185d", "#b45309", "#6b21a8", "#047857", "#0f172a", "#c2410c"
    ],
    monochrome: [
      "#0f172a", "#1e293b", "#334155", "#475569", "#111827"
    ],
    ocean: [
      "#0369a1", "#1e40af", "#0e7490", "#1d4ed8", "#0f172a", "#312e81"
    ],
    sunset: [
      "#be123c", "#c2410c", "#b45309", "#9f1239", "#0f172a", "#831843"
    ]
  }
};

/**
 * テーマ名と背景種別から最適なカラーパレット配列を取得
 */
function getThemePalette(paletteName, isLight) {
  const group = isLight ? PALETTES.light : PALETTES.dark;
  const aliasMap = {
    cyberpunk: "colorful",
    aurora: "ocean"
  };
  const key = aliasMap[paletteName] || paletteName;
  return group[key] || group.misskey || Object.values(group)[0];
}

const BACKGROUNDS = {
  // 黒背景 (Black)
  dark: (ctx, w, h) => {
    ctx.fillStyle = "#090d16";
    ctx.fillRect(0, 0, w, h);
  },
  // 白背景 (White)
  light: (ctx, w, h) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
};

class WordCloudRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.placedWords = [];
    this.lastBgStyle = "dark";
  }

  /**
   * 単語・絵文字バウンディングボックスの重複チェック
   */
  checkCollision(box, placedBoxes) {
    const pad = 5;
    const b1 = {
      x: box.x - pad,
      y: box.y - pad,
      w: box.w + pad * 2,
      h: box.h + pad * 2
    };

    for (let i = 0; i < placedBoxes.length; i++) {
      const b2 = placedBoxes[i];
      if (
        b1.x < b2.x + b2.w &&
        b1.x + b1.w > b2.x &&
        b1.y < b2.y + b2.h &&
        b1.y + b1.h > b2.y
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * ワードクラウドを描画
   */
  render({
    words = [],
    paletteName = "misskey",
    bgStyle = "dark",
    rotationMode = "mixed",
    fontFamily = "'Outfit', 'Noto Sans JP', sans-serif",
    title = "",
    subtitle = ""
  }) {
    this.lastBgStyle = bgStyle;
    const canvas = this.canvas;
    const ctx = this.ctx;
    const width = canvas.width;
    const height = canvas.height;

    // 1. 背景描画（dark または light）
    const isLight = bgStyle === "light";
    const bgRenderer = isLight ? BACKGROUNDS.light : BACKGROUNDS.dark;
    bgRenderer(ctx, width, height);

    // ドットパターン装飾
    ctx.fillStyle = isLight ? "rgba(0, 0, 0, 0.03)" : "rgba(255, 255, 255, 0.03)";
    for (let x = 20; x < width; x += 40) {
      for (let y = 20; y < height; y += 40) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!words || words.length === 0) return;

    // カラーパレット取得（背景色に合わせて見やすいパレットを取得）
    const colors = getThemePalette(paletteName, isLight);

    // 重み正規化
    const maxWeight = Math.max(...words.map(w => w.weight), 1);
    const minWeight = Math.min(...words.map(w => w.weight), 1);

    // 最大・最小フォントサイズ
    const maxFontSize = Math.min(width, height) * 0.17; // 約80〜95px
    const minFontSize = 15;

    this.placedWords = [];
    const placedBoxes = [];

    // 中心座標
    const centerX = width / 2;
    const centerY = height / 2 + 10;

    // 単語・絵文字ごとに配置計算
    words.forEach((item, index) => {
      const norm = (item.weight - minWeight) / (maxWeight - minWeight || 1);
      const fontSize = Math.round(minFontSize + Math.pow(norm, 0.78) * (maxFontSize - minFontSize));

      const hasValidImage = item.isEmoji && item.image && item.image.complete && item.image.naturalWidth > 0;

      let boxW = 0;
      let boxH = 0;
      let rotate = 0;
      let emojiSize = 0;

      if (hasValidImage) {
        // カスタム絵文字画像の場合（文字サイズに応じた正方形）
        emojiSize = Math.round(fontSize * 1.25);
        // 絵文字は基本的に水平で見やすく配置（視認性向上）
        rotate = 0;
        boxW = emojiSize;
        boxH = emojiSize;
      } else {
        // 通常の単語またはフォールバックテキスト
        if (rotationMode === "mixed") {
          rotate = (index % 5 === 0 && norm < 0.6) ? -Math.PI / 2 : 0;
        } else if (rotationMode === "dynamic") {
          const angles = [0, 0, 0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2];
          rotate = angles[index % angles.length];
        }

        ctx.font = `700 ${fontSize}px ${fontFamily}`;
        const textMetrics = ctx.measureText(item.word);
        const textWidth = textMetrics.width;
        const textHeight = fontSize;

        boxW = textWidth;
        boxH = textHeight;
        if (rotate !== 0) {
          const cos = Math.abs(Math.cos(rotate));
          const sin = Math.abs(Math.sin(rotate));
          boxW = textWidth * cos + textHeight * sin;
          boxH = textWidth * sin + textHeight * cos;
        }
      }

      // 螺旋探索（Archimedean spiral）
      let placed = false;
      const a = 3;
      const stepTheta = 0.22;
      let theta = (index * 1.45);
      const maxRadius = Math.max(width, height) * 0.65;

      while (!placed) {
        const r = a * theta;
        if (r > maxRadius) break;

        const x = centerX + r * Math.cos(theta) * 1.35 - boxW / 2;
        const y = centerY + r * Math.sin(theta) * 0.85 - boxH / 2;

        if (x > 18 && x + boxW < width - 18 && y > 48 && y + boxH < height - 24) {
          const candidateBox = { x, y, w: boxW, h: boxH };

          if (!this.checkCollision(candidateBox, placedBoxes)) {
            placedBoxes.push(candidateBox);
            const color = colors[index % colors.length];

            this.placedWords.push({
              word: item.word,
              weight: item.weight,
              fontSize,
              x: x + boxW / 2,
              y: y + boxH / 2,
              color,
              rotate,
              box: candidateBox,
              isEmoji: item.isEmoji,
              image: hasValidImage ? item.image : null,
              size: emojiSize
            });

            placed = true;
          }
        }

        theta += stepTheta;
      }
    });

    // 2. 単語・絵文字画像の描画
    this.placedWords.forEach((pw) => {
      ctx.save();
      ctx.translate(pw.x, pw.y);
      if (pw.rotate !== 0) {
        ctx.rotate(pw.rotate);
      }

      if (pw.image) {
        // ===== カスタム絵文字画像の描画 =====
        const half = pw.size / 2;

        ctx.save();
        if (isLight) {
          // 白背景：透過・薄色絵文字が埋もれないよう、控えめな背景と繊細な枠線
          ctx.shadowColor = "rgba(0, 0, 0, 0.08)";
          ctx.shadowBlur = 4;
          ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
          ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(-half - 3, -half - 3, pw.size + 6, pw.size + 6, 8);
          ctx.fill();
          ctx.stroke();
        } else {
          // 黒背景：背景に柔らかなネオングロー
          ctx.shadowColor = pw.color;
          ctx.shadowBlur = pw.size > 40 ? 14 : 6;
          ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
          ctx.beginPath();
          ctx.roundRect(-half - 2, -half - 2, pw.size + 4, pw.size + 4, 8);
          ctx.fill();
        }
        ctx.restore();

        // 画像を描画
        ctx.drawImage(pw.image, -half, -half, pw.size, pw.size);

      } else {
        // ===== 通常テキストの描画 =====
        ctx.font = `700 ${pw.fontSize}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (isLight) {
          // 白背景：くっきりと文字の輪郭が見えるよう、滲みを作らず高コントラスト描画
          ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
          ctx.shadowBlur = 2;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 1;
          ctx.fillStyle = pw.color;
          ctx.fillText(pw.word, 0, 0);
        } else {
          // 黒背景：発光感のあるネオングロー
          ctx.shadowColor = pw.color;
          ctx.shadowBlur = pw.fontSize > 35 ? 12 : 4;
          ctx.fillStyle = pw.color;
          ctx.fillText(pw.word, 0, 0);

          if (pw.fontSize > 45) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
            ctx.fillText(pw.word, 0, 0);
          }
        }
      }

      ctx.restore();
    });

    // 3. メタ情報（ヘッダー・フッター透かし）をCanvas内に描画
    this.drawCanvasOverlay(ctx, width, height, title, subtitle, bgStyle);
  }

  /**
   * Canvasの上下にタイトル・日時などのメタ情報を描き込む
   */
  drawCanvasOverlay(ctx, width, height, title, subtitle, bgStyle) {
    ctx.save();
    const isLight = bgStyle === "light";
    const textPrimary = isLight ? "#0f172a" : "#ffffff";
    const textMuted = isLight ? "#475569" : "rgba(255, 255, 255, 0.65)";
    const accentColor = isLight ? "#15803d" : "#a3e635";

    // 上部タイトルバー
    if (title) {
      // アイコン風アクセント
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(36, 32, 6, 0, Math.PI * 2);
      ctx.fill();

      // タイトルテキスト
      ctx.font = "800 18px 'Outfit', 'Noto Sans JP', sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = textPrimary;
      ctx.fillText(title, 52, 32);
    }

    // 右下の透かしクレジット
    ctx.font = "600 12px 'Outfit', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = textMuted;
    ctx.fillText("Generated by MisskeyWordCloudGenerator", width - 24, height - 14);

    // 外枠の繊細なボーダー
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.12)" : "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    ctx.restore();
  }

  /**
   * 指定した単語をハイライト強調する（タグクリック時）
   */
  highlightWord(targetWord) {
    const item = this.placedWords.find(w => w.word === targetWord);
    if (!item) return;

    const ctx = this.ctx;
    ctx.save();
    const isLight = this.lastBgStyle === "light";
    ctx.strokeStyle = isLight ? "#15803d" : "#86b300";
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(item.box.x - 3, item.box.y - 3, item.box.w + 6, item.box.h + 6);
    ctx.restore();
  }

  /**
   * 高解像度PNGデータURLを出力
   */
  toDataURL(type = "image/png", quality = 1.0) {
    return this.canvas.toDataURL(type, quality);
  }
}

// グローバル公開
window.WordCloudRenderer = WordCloudRenderer;
