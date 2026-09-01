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
 * dependency. The layout below deliberately borrows the site's own visual
 * language -- cut-corner "clip-chip" tags, the dashed orbit ring from behind
 * the rank letter, HUD-style corner brackets -- rather than plain boxes of
 * text, so the card reads as part of the same game instead of a generic
 * stat sheet.
 */

const CARD_W = 1200;
const CARD_H = 630;

const FONT_DISPLAY = "'Orbitron', sans-serif";
const FONT_MONO = "'Share Tech Mono', monospace";
const FONT_UI = "'Rajdhani', 'Noto Sans JP', sans-serif";

function spaced(text: string, gap = 2): string {
  return text.split("").join(" ".repeat(gap));
}

/** Appends an alpha channel to a 6-digit hex color (`#22e4ff` -> `#22e4ffcc`).
 * Falls back to the original string for anything that isn't a plain 6-digit
 * hex (the only shape every color used on this card actually is). */
function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
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

/** The smaller, symmetric cut-corner silhouette used by `.clip-chip` --
 * for tag-style pills (header labels, the pilot-name tag, the NEW RECORD /
 * ranking badges). */
function chipPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const c = Math.min(h * 0.32, 14);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - c, y);
  ctx.lineTo(x + w, y + c);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + c, y + h);
  ctx.lineTo(x, y + h - c);
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

/** Draws a small cut-corner tag: fills, strokes, centers `text` inside, and
 * hands back the box it occupied (so a caller can stack the next element
 * right after it without hard-coding widths). */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  opts: {
    x: number;
    y: number;
    align: "left" | "center" | "right";
    height: number;
    paddingX: number;
    font: string;
    textColor: string;
    borderColor: string;
    fillColor: string;
  },
): { left: number; right: number; bottom: number } {
  ctx.font = opts.font;
  const textW = ctx.measureText(text).width;
  const w = textW + opts.paddingX * 2;
  const left = opts.align === "left" ? opts.x : opts.align === "right" ? opts.x - w : opts.x - w / 2;

  chipPath(ctx, left, opts.y, w, opts.height);
  ctx.fillStyle = opts.fillColor;
  ctx.fill();
  ctx.strokeStyle = opts.borderColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = opts.textColor;
  ctx.textAlign = "center";
  const prevBaseline = ctx.textBaseline;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + w / 2, opts.y + opts.height / 2 + 1);
  ctx.textBaseline = prevBaseline;

  return { left, right: left + w, bottom: opts.y + opts.height };
}

/** Four HUD-style corner brackets around a rect -- a cheap, high-impact way
 * to make a static image read as "sci-fi viewfinder" rather than a plain
 * bordered box. */
function drawCornerBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, len: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = "square";

  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y + h - len);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + len, y + h);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + w - len, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w, y + h - len);
  ctx.stroke();
}

/** One HUD-style readout box for the SOLVED / MAX COMBO / MISS row: a thin
 * cut-corner panel with a colored top accent bar, an icon+label, and the
 * big value -- replacing what used to be a plain stacked list. */
function drawStatBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string,
  icon: string,
  label: string,
  value: string,
) {
  panelPath(ctx, x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.fillRect(x + 16, y + 8, w - 32, 3);

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = `600 12px ${FONT_MONO}`;
  ctx.fillText(`${icon} ${spaced(label, 1)}`, x + w / 2, y + 40);

  withGlow(ctx, accent, 16, () => {
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 32px ${FONT_DISPLAY}`;
    ctx.fillText(value, x + w / 2, y + 90);
  });
}

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
  const frameX = 14;
  const frameY = 14;
  const frameW = CARD_W - 28;
  const frameH = CARD_H - 28;

  /* ---------------- background (clipped to the panel silhouette) ---------------- */
  ctx.save();
  panelPath(ctx, frameX, frameY, frameW, frameH);
  ctx.clip();

  ctx.fillStyle = "#03060d";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glowBottom = ctx.createRadialGradient(CARD_W * 0.5, CARD_H * 1.05, 0, CARD_W * 0.5, CARD_H * 1.05, CARD_W * 0.78);
  glowBottom.addColorStop(0, withAlpha(stats.rankColor, 0.22));
  glowBottom.addColorStop(1, withAlpha(stats.rankColor, 0));
  ctx.fillStyle = glowBottom;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glowTop = ctx.createRadialGradient(CARD_W * 0.5, -CARD_H * 0.15, 0, CARD_W * 0.5, -CARD_H * 0.15, CARD_W * 0.7);
  glowTop.addColorStop(0, "rgba(130,10,90,0.4)");
  glowTop.addColorStop(1, "rgba(130,10,90,0)");
  ctx.fillStyle = glowTop;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  ctx.strokeStyle = "rgba(34,228,255,0.06)";
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

  // diagonal glass-sheen sweep for a bit of polish/shine
  ctx.save();
  ctx.translate(CARD_W * 0.26, CARD_H * 0.5);
  ctx.rotate((-13 * Math.PI) / 180);
  const sheen = ctx.createLinearGradient(-160, 0, 160, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.07)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-160, -CARD_H, 320, CARD_H * 2);
  ctx.restore();

  ctx.restore(); // end background clip

  ctx.strokeStyle = "rgba(34,228,255,0.45)";
  ctx.lineWidth = 2;
  panelPath(ctx, frameX, frameY, frameW, frameH);
  ctx.stroke();

  drawCornerBrackets(ctx, 34, 34, CARD_W - 68, CARD_H - 68, 26, withAlpha(stats.rankColor, 0.75));

  /* ---------------- header: logo / pilot name / mode chips ---------------- */
  drawChip(ctx, spaced("NUMERIC VELOCITY", 2), {
    x: 40,
    y: 40,
    align: "left",
    height: 34,
    paddingX: 16,
    font: `700 13px ${FONT_MONO}`,
    textColor: "rgba(220,250,255,0.9)",
    borderColor: "rgba(34,228,255,0.55)",
    fillColor: "rgba(34,228,255,0.10)",
  });

  drawChip(ctx, `PILOT ${stats.playerName}`, {
    x: CARD_W / 2,
    y: 40,
    align: "center",
    height: 34,
    paddingX: 18,
    font: `700 14px ${FONT_UI}`,
    textColor: "rgba(255,214,245,0.95)",
    borderColor: "rgba(255,43,209,0.55)",
    fillColor: "rgba(255,43,209,0.10)",
  });

  drawChip(ctx, spaced(`${mode} × ${stats.difficultyLabel}`, 1), {
    x: CARD_W - 40,
    y: 40,
    align: "right",
    height: 34,
    paddingX: 16,
    font: `700 13px ${FONT_MONO}`,
    textColor: stats.rankColor,
    borderColor: withAlpha(stats.rankColor, 0.55),
    fillColor: withAlpha(stats.rankColor, 0.1),
  });

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(54, 96);
  ctx.lineTo(CARD_W - 54, 96);
  ctx.stroke();

  // vertical divider between the rank column and the score column
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(590, 118);
  ctx.lineTo(590, 560);
  ctx.stroke();

  /* ---------------- left column: rank ---------------- */
  const leftCenterX = 307;

  ctx.setLineDash([10, 7]);
  ctx.strokeStyle = withAlpha(stats.rankColor, 0.35);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(leftCenterX, 250, 148, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "center";
  withGlow(ctx, stats.rankColor, 34, () => {
    ctx.fillStyle = stats.rankColor;
    ctx.font = `900 210px ${FONT_DISPLAY}`;
    ctx.fillText(stats.rankLabel, leftCenterX, 330);
  });

  // The rank title varies a lot in length ("ELITE OPERATOR" vs
  // "TRANSCENDENT CALCULATOR", and even more so once letter-spaced via
  // `spaced()`), and the left column isn't very wide. Shrink the font -- and
  // as a last resort, drop the letter-spacing gap from 2 to 1 -- until the
  // spaced string actually fits, so a long title never spills past the
  // rank-letter column into the divider/score column next to it.
  const titleMaxWidth = 250;
  let rankTitleGap = 2;
  let rankTitleText = spaced(stats.rankTitle, rankTitleGap);
  let rankTitleSize = fitFontSize(ctx, rankTitleText, titleMaxWidth, 700, FONT_MONO, 20, 13);
  if (rankTitleSize <= 13) {
    ctx.font = `700 13px ${FONT_MONO}`;
    if (ctx.measureText(rankTitleText).width > titleMaxWidth) {
      rankTitleGap = 1;
      rankTitleText = spaced(stats.rankTitle, rankTitleGap);
      rankTitleSize = fitFontSize(ctx, rankTitleText, titleMaxWidth, 700, FONT_MONO, 18, 11);
    }
  }
  ctx.fillStyle = stats.rankColor;
  ctx.font = `700 ${rankTitleSize}px ${FONT_MONO}`;
  ctx.fillText(rankTitleText, leftCenterX, 376);

  let nextY = 376;
  if (stats.isNewRecord) {
    const badgeText =
      lang === "ja"
        ? `🏆 ${stats.prevBest > 0 ? `自己ベスト更新 (+${stats.bestDiff})` : "自己ベスト達成"}`
        : `🏆 New personal best${stats.prevBest > 0 ? ` (+${stats.bestDiff})` : ""}`;
    const badge = drawChip(ctx, badgeText, {
      x: leftCenterX,
      y: nextY + 26,
      align: "center",
      height: 40,
      paddingX: 20,
      font: `700 17px ${FONT_UI}`,
      textColor: "#ffe45e",
      borderColor: "rgba(255,228,94,0.7)",
      fillColor: "rgba(255,228,94,0.14)",
    });
    nextY = badge.bottom;
  }

  if (stats.rankInfo) {
    const rankLine =
      lang === "ja"
        ? `🎉 ${stats.rankInfo.rank}位にランクイン（${stats.rankInfo.total}人中）`
        : `🎉 Ranked #${stats.rankInfo.rank} of ${stats.rankInfo.total}!`;
    drawChip(ctx, rankLine, {
      x: leftCenterX,
      y: nextY + 14,
      align: "center",
      height: 36,
      paddingX: 18,
      font: `600 15px ${FONT_UI}`,
      textColor: "#ff9be8",
      borderColor: "rgba(255,43,209,0.45)",
      fillColor: "rgba(255,43,209,0.08)",
    });
  }

  /* ---------------- right column: score + stats ---------------- */
  const rightX = 622;
  const rightEdge = CARD_W - 54;

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(34,228,255,0.75)";
  ctx.font = `600 15px ${FONT_MONO}`;
  ctx.fillText(spaced("TOTAL SCORE", 3), rightX, 150);
  ctx.fillStyle = "rgba(34,228,255,0.55)";
  ctx.fillRect(rightX, 160, 64, 3);

  const scoreText = String(stats.score);
  const scoreSize = fitFontSize(ctx, scoreText, rightEdge - rightX, 900, FONT_DISPLAY, 148, 80);
  withGlow(ctx, "#22e4ff", 28, () => {
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${scoreSize}px ${FONT_DISPLAY}`;
    ctx.fillText(scoreText, rightX, 296);
  });

  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(rightX, 326);
  ctx.lineTo(rightEdge, 326);
  ctx.stroke();

  // Share card intentionally shows SCORE only alongside the identity/rank
  // info -- MISS and MAX COMBO aren't meaningful to someone just glancing at
  // a shared image, so they're left off here (they still show on the result
  // screen itself). SOLVED alone doesn't need three cramped boxes, so it
  // gets one wide box instead of a 3-way split.
  const boxY = 346;
  const boxH = 132;
  drawStatBox(ctx, rightX, boxY, rightEdge - rightX, boxH, "#22e4ff", "✅", "SOLVED", String(stats.solved));

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
