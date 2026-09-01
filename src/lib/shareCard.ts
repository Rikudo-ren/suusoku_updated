import type { ShareLang, ShareStats } from "./shareText";

/**
 * Renders the shareable result image as a purpose-built card via the Canvas
 * 2D API, rather than screenshotting the live result-screen DOM.
 *
 * This is deliberate: the real result screen leans on `backdrop-filter`
 * blur, conic/radial gradients, clip-path panels, dozens of animated glyph
 * spans, and mid-animation state (the reveal is still playing pieces in on a
 * timer) -- none of which a DOM-to-canvas capture reproduces reliably across
 * browsers, and any of which could land the player with a half-finished or
 * visually broken screenshot. Drawing a fixed 1200x630 (the standard
 * OG/Twitter-card size) card by hand instead guarantees a clean, correctly
 * sized, correctly themed image every time, on every device, with no extra
 * dependency.
 */

const CARD_W = 1200;
const CARD_H = 630;

function spaced(text: string, gap = 2): string {
  return text.split("").join(" ".repeat(gap));
}

/** Manual rounded-rect path -- avoids depending on `CanvasRenderingContext2D.roundRect`,
 * which isn't available in every browser this card might be generated on. */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The same asymmetric cut-corner silhouette as the site's `.clip-panel`
 * CSS class, redrawn as a canvas path so the card reads as part of the same
 * UI language as the rest of the game. */
function panelPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const c1 = 16;
  const c2 = 30;
  ctx.beginPath();
  ctx.moveTo(x, y + c1);
  ctx.lineTo(x + c1, y);
  ctx.lineTo(x + w - c2, y);
  ctx.lineTo(x + w, y + c2);
  ctx.lineTo(x + w, y + h - c1);
  ctx.lineTo(x + w - c1, y + h);
  ctx.lineTo(x + c2, y + h);
  ctx.lineTo(x, y + h - c2);
  ctx.closePath();
}

/** Shrinks the font size until `text` fits within `maxWidth`, so an
 * unusually large score never overflows into the neighboring column. */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  weight: number,
  family: string,
  startSize: number,
  minSize: number,
): number {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 4;
  }
  return size;
}

function withGlow(ctx: CanvasRenderingContext2D, color: string, blur: number, draw: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.shadowBlur = blur * 1.8;
  draw();
  ctx.restore();
}

const FONT_DISPLAY = "'Orbitron', sans-serif";
const FONT_MONO = "'Share Tech Mono', monospace";
const FONT_UI = "'Rajdhani', 'Noto Sans JP', sans-serif";

export async function renderShareCard(stats: ShareStats, lang: ShareLang): Promise<Blob> {
  // Canvas text silently falls back to the system default font if the
  // Google Fonts request the page kicked off on load hasn't resolved yet --
  // wait for it so the card actually uses Orbitron/Share Tech Mono.
  try {
    await document.fonts?.ready;
  } catch {
    /* best effort -- worst case the card renders with a fallback font */
  }

  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * dpr;
  canvas.height = CARD_H * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.scale(dpr, dpr);
  ctx.textBaseline = "alphabetic";

  const mode = lang === "ja" ? stats.modeLabelJa : stats.modeLabelEn;

  /* ---------------- background ---------------- */
  ctx.fillStyle = "#03060d";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glowBottom = ctx.createRadialGradient(CARD_W * 0.5, CARD_H * 1.1, 0, CARD_W * 0.5, CARD_H * 1.1, CARD_W * 0.75);
  glowBottom.addColorStop(0, "rgba(34,228,255,0.20)");
  glowBottom.addColorStop(1, "rgba(34,228,255,0)");
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glowTop = ctx.createRadialGradient(CARD_W * 0.5, -CARD_H * 0.15, 0, CARD_W * 0.5, -CARD_H * 0.15, CARD_W * 0.7);
  glowTop.addColorStop(0, "rgba(130,10,90,0.45)");
  glowTop.addColorStop(1, "rgba(130,10,90,0)");
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.strokeStyle = "rgba(34,228,255,0.07)";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= CARD_W; gx += 46) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, CARD_H);
    ctx.stroke();
  }
  for (let gy = 0; gy <= CARD_H; gy += 46) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(CARD_W, gy);
    ctx.stroke();
  }

  panelPath(ctx, 14, 14, CARD_W - 28, CARD_H - 28);
  ctx.strokeStyle = "rgba(34,228,255,0.45)";
  ctx.lineWidth = 2;
  ctx.stroke();

  /* ---------------- header ---------------- */
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(34,228,255,0.85)";
  ctx.font = `600 14px ${FONT_MONO}`;
  ctx.fillText(spaced("NUMERIC VELOCITY", 2), 54, 58);

  ctx.textAlign = "right";
  ctx.fillStyle = stats.rankColor;
  ctx.font = `700 15px ${FONT_MONO}`;
  ctx.fillText(spaced(`${mode} × ${stats.difficultyLabel}`, 1), CARD_W - 54, 58);

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(54, 78);
  ctx.lineTo(CARD_W - 54, 78);
  ctx.stroke();

  // vertical divider between the rank column and the score column
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(590, 104);
  ctx.lineTo(590, 552);
  ctx.stroke();

  /* ---------------- left column: rank ---------------- */
  const leftCenterX = 307;

  ctx.textAlign = "center";
  withGlow(ctx, stats.rankColor, 34, () => {
    ctx.fillStyle = stats.rankColor;
    ctx.font = `900 220px ${FONT_DISPLAY}`;
    ctx.fillText(stats.rankLabel, leftCenterX, 300);
  });

  ctx.fillStyle = stats.rankColor;
  ctx.font = `700 21px ${FONT_MONO}`;
  ctx.fillText(spaced(stats.rankTitle, 2), leftCenterX, 348);

  let nextY = 348;
  if (stats.isNewRecord) {
    const badgeText =
      lang === "ja"
        ? `🏆 ${stats.prevBest > 0 ? `自己ベスト更新 (+${stats.bestDiff})` : "自己ベスト達成"}`
        : `🏆 New personal best${stats.prevBest > 0 ? ` (+${stats.bestDiff})` : ""}`;
    ctx.font = `700 18px ${FONT_UI}`;
    const textW = ctx.measureText(badgeText).width;
    const padX = 22;
    const badgeW = textW + padX * 2;
    const badgeH = 42;
    const badgeY = nextY + 32;
    roundRectPath(ctx, leftCenterX - badgeW / 2, badgeY, badgeW, badgeH, badgeH / 2);
    ctx.fillStyle = "rgba(255,228,94,0.14)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,228,94,0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffe45e";
    ctx.textAlign = "center";
    ctx.fillText(badgeText, leftCenterX, badgeY + badgeH / 2 + 6);
    nextY = badgeY + badgeH;
  }

  if (stats.rankInfo) {
    const rankLine =
      lang === "ja"
        ? `🎉 ランキング ${stats.rankInfo.rank}位にランクイン（${stats.rankInfo.total}人中）`
        : `🎉 Ranked #${stats.rankInfo.rank} of ${stats.rankInfo.total}!`;
    ctx.font = `600 17px ${FONT_UI}`;
    ctx.fillStyle = "#ff9be8";
    ctx.textAlign = "center";
    ctx.fillText(rankLine, leftCenterX, nextY + 34);
  }

  /* ---------------- right column: score + stats ---------------- */
  const rightX = 622;
  const rightEdge = CARD_W - 54;

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(34,228,255,0.75)";
  ctx.font = `600 15px ${FONT_MONO}`;
  ctx.fillText(spaced("TOTAL SCORE", 3), rightX, 148);

  const scoreText = String(stats.score);
  const scoreSize = fitFontSize(ctx, scoreText, rightEdge - rightX, 900, FONT_DISPLAY, 150, 80);
  withGlow(ctx, "#22e4ff", 26, () => {
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${scoreSize}px ${FONT_DISPLAY}`;
    ctx.fillText(scoreText, rightX, 290);
  });

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(rightX, 322);
  ctx.lineTo(rightEdge, 322);
  ctx.stroke();

  const rows: { label: string; value: string }[] = [
    { label: "SOLVED", value: String(stats.solved) },
    { label: "MAX COMBO", value: `×${stats.maxCombo}` },
    { label: "MISS", value: String(stats.misses) },
  ];
  const rowStartY = 342;
  const rowH = 56;
  rows.forEach((row, i) => {
    const rowTop = rowStartY + i * rowH;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(216,246,255,0.55)";
    ctx.font = `600 15px ${FONT_MONO}`;
    ctx.fillText(spaced(row.label, 2), rightX, rowTop + 24);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 28px ${FONT_DISPLAY}`;
    ctx.fillText(row.value, rightEdge, rowTop + 28);

    if (i < rows.length - 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(rightX, rowTop + 44);
      ctx.lineTo(rightEdge, rowTop + 44);
      ctx.stroke();
    }
  });

  /* ---------------- footer ---------------- */
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(54, CARD_H - 46);
  ctx.lineTo(CARD_W - 54, CARD_H - 46);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(216,246,255,0.75)";
  ctx.font = `600 15px ${FONT_MONO}`;
  ctx.fillText("suusokubattle.vercel.app", 54, CARD_H - 20);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `500 15px ${FONT_UI}`;
  ctx.fillText(
    lang === "ja" ? "瞬時の暗算力を競う無料の計算ゲーム" : "A free brain-speed math game",
    CARD_W - 54,
    CARD_H - 20,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("failed to encode share card"));
    }, "image/png");
  });
}
