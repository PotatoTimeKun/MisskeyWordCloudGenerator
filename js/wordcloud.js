/**
 * Misskey WordCloud - Canvas Word Cloud Renderer
 * 
 * 純粋なHTML5 Canvas上で螺旋配置（Archimedean spiral）と
 * AABBコリジョン判定を用いて、日本語テキストおよび
 * Misskeyのカスタム絵文字画像を美しくレイアウトする描画エンジン。
 */

const PALETTES = {
  misskey: [
    "#86b300", "#9fe200", "#a3e635", "#bef264", "#00e5ff", "#ffffff", "#4ade80", "#22c55e"
  ],
  cyberpunk: [
    "#00e5ff", "#ff007f", "#ffe600", "#a855f7", "#ffffff", "#38bdf8", "#ec4899"
  ],
  sunset: [
    "#ff6b6b", "#ffa502", "#ff4757", "#ff7f50", "#ffd32a", "#ff9ff3", "#ffffff"
  ],
  ocean: [
    "#00d2d3", "#0abde3", "#54a0ff", "#48dbfb", "#ffffff", "#5f27cd", "#1dd1a1"
  ],
  aurora: [
    "#a8ff78", "#78ffd6", "#d980fa", "#fda7df", "#ffffff", "#b388ff", "#80d8ff"
  ],
  monochrome: [
    "#ffffff", "#f1f2f6", "#ced6e0", "#dfe4ea", "#a4b0be", "#747d8c"
  ]
};

const BACKGROUNDS = {
  dark: (ctx, w, h) => {
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, "#0b0f19");
    bgGrad.addColorStop(1, "#111827");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);
  },
  gradient: (ctx, w, h) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.7);
    grad.addColorStop(0, "#1e1b4b");
    grad.addColorStop(0.5, "#0f172a");
    grad.addColorStop(1, "#020617");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  },
  midnight: (ctx, w, h) => {
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, w, h);
  },
  light: (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#f8fafc");
    grad.addColorStop(1, "#e2e8f0");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
};

class WordCloudRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.placedWords = [];
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
    const canvas = this.canvas;
    const ctx = this.ctx;
    const width = canvas.width;
    const height = canvas.height;

    // 1. 背景描画
    const bgRenderer = BACKGROUNDS[bgStyle] || BACKGROUNDS.dark;
    bgRenderer(ctx, width, height);

    // ドットパターン装飾
    ctx.fillStyle = bgStyle === "light" ? "rgba(0, 0, 0, 0.03)" : "rgba(255, 255, 255, 0.03)";
    for (let x = 20; x < width; x += 40) {
      for (let y = 20; y < height; y += 40) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!words || words.length === 0) return;

    // カラーパレット取得
    const colors = PALETTES[paletteName] || PALETTES.misskey;

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

        // 背景に柔らかなグロー（ネオン効果）
        ctx.save();
        ctx.shadowColor = pw.color;
        ctx.shadowBlur = pw.size > 40 ? 14 : 6;
        // 少し背景に丸みのあるハイライトを描く
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.roundRect(-half - 2, -half - 2, pw.size + 4, pw.size + 4, 8);
        ctx.fill();
        ctx.restore();

        // 画像を描画
        ctx.drawImage(pw.image, -half, -half, pw.size, pw.size);

      } else {
        // ===== 通常テキストの描画 =====
        ctx.font = `700 ${pw.fontSize}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        ctx.shadowColor = pw.color;
        ctx.shadowBlur = pw.fontSize > 35 ? 12 : 4;
        ctx.fillStyle = pw.color;
        ctx.fillText(pw.word, 0, 0);

        if (pw.fontSize > 45) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
          ctx.fillText(pw.word, 0, 0);
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
    const textMuted = isLight ? "#64748b" : "rgba(255, 255, 255, 0.6)";
    const accentColor = "#86b300";

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

      if (subtitle) {
      }
    }

    // 右下の透かしクレジット
    ctx.font = "600 12px 'Outfit', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = textMuted;
    ctx.fillText("Generated by MisskeyWordCloudGenerator", width - 24, height - 14);

    // 外枠の繊細なボーダー
    ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)";
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
    ctx.strokeStyle = "#86b300";
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
