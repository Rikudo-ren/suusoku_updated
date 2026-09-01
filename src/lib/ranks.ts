/**
 * Score-to-rank table. Pulled out of ResultScreen (which used to define this
 * inline) so TitleScreen can also show the full breakdown without importing
 * a component file just for a constant.
 */
export type RankDef = { min: number; label: string; color: string; title: string };

export const RANKS: RankDef[] = [
  { min: 90, label: "SS", color: "#ffe45e", title: "TRANSCENDENT CALCULATOR" },
  { min: 70, label: "S", color: "#ff2bd1", title: "OVERCLOCKED MIND" },
  { min: 50, label: "A", color: "#22e4ff", title: "ELITE OPERATOR" },
  { min: 32, label: "B", color: "#3ef2a1", title: "STABLE PROCESSOR" },
  { min: 18, label: "C", color: "#9aa7c7", title: "BOOT SEQUENCE OK" },
  { min: 0, label: "D", color: "#7c8598", title: "RECALIBRATION NEEDED" },
];

export function getRank(score: number): RankDef {
  return RANKS.find((r) => score >= r.min) ?? RANKS[RANKS.length - 1];
}
