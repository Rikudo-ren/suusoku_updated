import { DIFF_INFO, MODE_INFO } from "./problems";
import type { GameStats } from "../components/GameScreen";

export type ShareLang = "ja" | "en";

/**
 * Everything the caption/card builders need, pre-resolved into plain
 * strings/numbers so those builders don't have to know about `Difficulty`,
 * `ProblemMode`, or how the rank-letter table works. Built once per result
 * via `buildShareStats` and then reused for every share action (X, Discord,
 * native share, copy, download) so they all describe the exact same run.
 */
export type ShareStats = {
  score: number;
  solved: number;
  misses: number;
  maxCombo: number;
  /** Japanese mode name, e.g. "乗除算". */
  modeLabelJa: string;
  /** English mode short-label already used elsewhere in the UI, e.g. "MUL-DIV". */
  modeLabelEn: string;
  /** Difficulty word -- already English in both languages ("EASY"/"NORMAL"/"HARD"). */
  difficultyLabel: string;
  rankLabel: string;
  rankTitle: string;
  rankColor: string;
  /** True only when this run just set a new personal best (matches ResultScreen's `isBest`). */
  isNewRecord: boolean;
  prevBest: number;
  bestDiff: number;
  /**
   * The run's placement on the global leaderboard. Only meaningful (and only
   * ever passed in) when `isNewRecord` is true -- on a non-record run the
   * board still holds the OLD best under this player's uid, so any
   * placement we could compute for a non-record run would be hypothetical
   * ("if this score were your best"), not something actually on the board.
   * Sharing a rank the player didn't really claim would be misleading, so
   * callers should pass `null` here whenever `isNewRecord` is false.
   */
  rankInfo: { rank: number; total: number } | null;
};

export function buildShareStats(params: {
  stats: GameStats;
  rankLabel: string;
  rankTitle: string;
  rankColor: string;
  isNewRecord: boolean;
  prevBest: number;
  bestDiff: number;
  rankInfo: { rank: number; total: number } | null;
}): ShareStats {
  const di = DIFF_INFO[params.stats.difficulty];
  const mi = MODE_INFO[params.stats.mode];
  return {
    score: params.stats.score,
    solved: params.stats.solved,
    misses: params.stats.misses,
    maxCombo: params.stats.maxCombo,
    modeLabelJa: mi.label,
    modeLabelEn: mi.sub,
    difficultyLabel: di.label,
    rankLabel: params.rankLabel,
    rankTitle: params.rankTitle,
    rankColor: params.rankColor,
    isNewRecord: params.isNewRecord,
    prevBest: params.prevBest,
    bestDiff: params.bestDiff,
    // Defensive: even if a caller passes a placement in on a non-record
    // run, never let it reach the caption/card builders below.
    rankInfo: params.isNewRecord ? params.rankInfo : null,
  };
}

export const SHARE_SITE_URL = "https://suusokubattle.vercel.app/";
const HASHTAGS_JA = "#数速バトル #NumericVelocity";
const HASHTAGS_EN = "#NumericVelocity";

/**
 * Builds the caption in three parts (body / hashtags / url) instead of one
 * string, because the X/Twitter intent link has its own `url` query param
 * and would show the link twice if it were also left inside `text`. Callers
 * that just want one block of text (Discord paste, clipboard copy, the Web
 * Share API's plain-text fallback) use `buildFullCaption` below, which joins
 * all three.
 */
export function buildShareCaption(s: ShareStats, lang: ShareLang): { body: string; hashtags: string; url: string } {
  const mode = lang === "ja" ? s.modeLabelJa : s.modeLabelEn;
  const lines: string[] = [];

  if (lang === "ja") {
    lines.push(`数速バトルで${mode}×${s.difficultyLabel}に挑戦！`);
    lines.push(`スコア ${s.score}｜ランク ${s.rankLabel}「${s.rankTitle}」`);
    if (s.isNewRecord) {
      lines.push(s.prevBest > 0 ? `🏆 自己ベスト更新！(+${s.bestDiff})` : "🏆 自己ベスト達成！");
    }
    if (s.rankInfo) {
      lines.push(`🎉 ランキング${s.rankInfo.rank}位にランクイン！（${s.rankInfo.total}人中）`);
    }
  } else {
    lines.push(`Just played Numeric Velocity — ${mode} × ${s.difficultyLabel}!`);
    lines.push(`Score ${s.score} | Rank ${s.rankLabel} "${s.rankTitle}"`);
    if (s.isNewRecord) {
      lines.push(s.prevBest > 0 ? `🏆 New personal best! (+${s.bestDiff})` : "🏆 New personal best!");
    }
    if (s.rankInfo) {
      lines.push(`🎉 Ranked #${s.rankInfo.rank} of ${s.rankInfo.total}!`);
    }
  }

  return { body: lines.join("\n"), hashtags: lang === "ja" ? HASHTAGS_JA : HASHTAGS_EN, url: SHARE_SITE_URL };
}

/** One block of text (body + hashtags + link) for anywhere that only has a
 * single text field to fill -- Discord, clipboard copy, Web Share API text. */
export function buildFullCaption(s: ShareStats, lang: ShareLang): string {
  const { body, hashtags, url } = buildShareCaption(s, lang);
  return `${body}\n${hashtags}\n${url}`;
}

/** X/Twitter's web intent: `text` and `url` are separate params so X renders
 * the link as its own attachment instead of as plain text inside the tweet. */
export function buildTweetIntentUrl(s: ShareStats, lang: ShareLang): string {
  const { body, hashtags, url } = buildShareCaption(s, lang);
  const params = new URLSearchParams({ text: `${body}\n${hashtags}`, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}
