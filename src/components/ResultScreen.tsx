import { useEffect, useMemo, useRef, useState } from "react";
import Backdrop from "./Backdrop";
import { DIFF_INFO, MODE_INFO } from "../lib/problems";
import type { GameStats } from "./GameScreen";
import { setMusicMode, sfxRank, sfxResultHit, sfxSelect, sfxUI, startMusic } from "../lib/audio";
import { claimName, fetchMyRank, loadPlayerName, submitScore } from "../lib/ranking";

const RANKS: { min: number; label: string; color: string; title: string }[] = [
  { min: 90, label: "SS", color: "#ffe45e", title: "TRANSCENDENT CALCULATOR" },
  { min: 70, label: "S", color: "#ff2bd1", title: "OVERCLOCKED MIND" },
  { min: 50, label: "A", color: "#22e4ff", title: "ELITE OPERATOR" },
  { min: 32, label: "B", color: "#3ef2a1", title: "STABLE PROCESSOR" },
  { min: 18, label: "C", color: "#9aa7c7", title: "BOOT SEQUENCE OK" },
  { min: 0, label: "D", color: "#7c8598", title: "RECALIBRATION NEEDED" },
];

function useCountUp(target: number, run: boolean, dur = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(target * e));
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, run, dur]);
  return v;
}

export default function ResultScreen({
  stats,
  isBest,
  lightweight,
  ultra,
  onRetry,
  onTitle,
  onRanking,
}: {
  stats: GameStats;
  isBest: boolean;
  lightweight: boolean;
  ultra: boolean;
  onRetry: () => void;
  onTitle: () => void;
  onRanking: () => void;
}) {
  const di = DIFF_INFO[stats.difficulty];
  const mi = MODE_INFO[stats.mode];
  const rank = useMemo(() => RANKS.find((r) => stats.score >= r.min) ?? RANKS[RANKS.length - 1], [stats.score]);
  const [stage, setStage] = useState(0); // 0 timeup, 1 panel, 2 rows, 3 score, 4 rank, 5 buttons
  const timers = useRef<number[]>([]);

  // Leaderboard placement for this run, e.g. "12位にランクイン！". Submitting
  // the score and then looking up where it landed both happen here (rather
  // than in App.tsx) so the two stay in order: we must wait for the submit
  // to finish writing before asking the board where we rank, or we'd read a
  // stale position.
  const [rankInfo, setRankInfo] = useState<{ rank: number; total: number } | null>(null);
  const [rankPending, setRankPending] = useState(false);

  useEffect(() => {
    if (stats.score <= 0) return;
    let cancelled = false;
    setRankPending(true);
    submitScore(stats.mode, stats.difficulty, {
      score: stats.score,
      solved: stats.solved,
      misses: stats.misses,
      maxCombo: stats.maxCombo,
    })
      .then(() => fetchMyRank(stats.mode, stats.difficulty))
      .then((r) => {
        if (!cancelled) setRankInfo(r);
      })
      .catch(() => {
        /* leaderboard is best-effort; the result screen never blocks on it */
      })
      .finally(() => {
        if (!cancelled) setRankPending(false);
      });
    return () => {
      cancelled = true;
    };
    // Run once per mount -- `stats` is fixed for the lifetime of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pilot name, editable right here so registering for the ranking doesn't
  // require a trip to the separate ranking screen.
  const [name, setName] = useState(() => loadPlayerName());
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);

  const commitName = async () => {
    if (nameSaving) return;
    setNameSaving(true);
    setNameError(null);
    const res = await claimName(nameDraft);
    setNameSaving(false);
    if (res.ok) {
      setName(res.name);
      setNameDraft(res.name);
      setEditingName(false);
    } else {
      setNameError(res.reason === "taken" ? "その名前は使用済みです" : "名前を入力してください");
    }
  };

  useEffect(() => {
    const add = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
    add(() => setStage(1), 1500);
    add(() => {
      setStage(2);
      startMusic("result");
      setMusicMode("result");
    }, 2000);
    [0, 1, 2, 3].forEach((i) => add(() => sfxResultHit(i), 2200 + i * 220));
    add(() => setStage(3), 3150);
    add(() => {
      setStage(4);
      sfxRank();
    }, 4200);
    add(() => setStage(5), 5100);
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const skip = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setStage(5);
    startMusic("result");
    setMusicMode("result");
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // While the pilot-name field is focused, Enter/Escape should only
      // save/cancel the name -- not also retry or jump to the title screen.
      if (editingName) return;
      if (stage < 5) {
        skip();
        return;
      }
      if (e.key === "Enter" || e.key.toLowerCase() === "r") {
        sfxSelect();
        onRetry();
      } else if (e.key === "Escape" || e.key.toLowerCase() === "t") {
        sfxSelect();
        onTitle();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [stage, onRetry, onTitle, editingName]);

  const scoreVal = useCountUp(stats.score, stage >= 3, 1000);
  const solvedVal = useCountUp(stats.solved, stage >= 2, 700);

  const rows = [
    { k: "SOLVED", v: `${solvedVal}`, sub: "問正解" },
    { k: "MULTIPLIER", v: `×${di.points}`, sub: di.label },
    { k: "MAX COMBO", v: `×${stats.maxCombo}`, sub: "連続正解" },
    { k: "MISS", v: `${stats.misses}`, sub: "誤答回数" },
  ];

  const kinds = [
    { k: "加減算", v: stats.byKind.arith, c: "#3ef2a1" },
    { k: "乗除算", v: stats.byKind.muldiv, c: "#22e4ff" },
    { k: "素因数分解", v: stats.byKind.factor, c: "#ff2bd1" },
  ];
  const maxKind = Math.max(1, ...kinds.map((x) => x.v));

  return (
    <div className="relative h-full w-full overflow-hidden" onClick={() => stage < 5 && skip()}>
      <Backdrop accent={rank.color} intensity={0.8} lightweight={lightweight} ultra={ultra} />

      {stage === 0 && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/85">
          <div className="absolute inset-0 opacity-40">
            {Array.from({ length: 26 }).map((_, i) => (
              <span
                key={i}
                className="absolute top-0 font-mono2 text-xs text-cyan-400/40"
                style={{
                  left: `${(i / 26) * 100}%`,
                  animation: `sweep-line ${0.8 + Math.random() * 1.4}s linear ${Math.random()}s infinite`,
                }}
              >
                {Array.from({ length: 12 })
                  .map(() => Math.floor(Math.random() * 10))
                  .join("")}
              </span>
            ))}
          </div>
          <h1
            className="glitch zoom-slam font-display text-[14vw] font-black tracking-[0.1em] text-white neon-red md:text-[130px]"
            data-text="TIME UP"
          >
            TIME UP
          </h1>
        </div>
      )}

      {/* This used to be a fixed h-full flex box with no overflow-y-auto, so
          on short mobile screens (or with a long breakdown/rank section) the
          panel could overflow the viewport top/bottom with no way to reach
          the clipped part -- e.g. the RETRY/TITLE/RANKING buttons at the
          very bottom. overflow-y-auto below turns that into a normal
          scrollable area whenever content is taller than the screen. */}
      {/* justify-center (not items-center) on purpose: centering a
          scrollable flex container with align-items/justify-content:
          center is a known browser quirk where the overflowed start of
          the content becomes unreachable by scrolling. The child's
          `my-auto` below centers it vertically when it fits, and behaves
          like a normal top-anchored, fully scrollable block when it
          doesn't. */}
      <div className="relative z-10 flex h-full w-full justify-center overflow-y-auto px-4 py-6">
        {stage >= 1 && (
          <div className="wipe-in clip-panel relative my-auto w-full max-w-5xl border border-cyan-400/30 bg-black/60 px-5 py-6 backdrop-blur-md md:px-12 md:py-8">
            <div className="mb-4 flex items-center justify-between font-mono2 text-[10px] tracking-[0.35em] text-cyan-300/60">
              <span className="flex items-center gap-2">
                MISSION REPORT //
                <span style={{ color: mi.color }}>{mi.sub}</span>
                <span style={{ color: di.color }}>×{di.label}</span>
              </span>
              <span className="pulse-soft">SESSION CLOSED</span>
            </div>

            <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
              <div>
                {stage >= 2 && (
                  <div className="space-y-2">
                    {rows.map((r, i) => (
                      <div
                        key={r.k}
                        className="rise-fade flex items-center justify-between border-b border-white/10 pb-1.5"
                        style={{ animationDelay: `${i * 0.16}s` }}
                      >
                        <span className="font-mono2 text-[11px] tracking-[0.3em] text-cyan-200/60">{r.k}</span>
                        <span className="flex items-baseline gap-2">
                          <span className="font-display text-2xl font-black text-white md:text-3xl">{r.v}</span>
                          <span className="font-ui text-[11px] text-white/35">{r.sub}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {stage >= 3 && (
                  <div className="mt-5 space-y-2">
                    <div className="font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/50">BREAKDOWN</div>
                    {kinds.map((k, i) => (
                      <div key={k.k} className="flex items-center gap-3">
                        <span className="w-24 font-ui text-xs text-white/60">{k.k}</span>
                        <span className="h-2 flex-1 bg-white/8">
                          <span
                            className="bar-grow block h-full"
                            style={{
                              width: `${(k.v / maxKind) * 100}%`,
                              background: `linear-gradient(90deg, ${k.c}, #ffffff88)`,
                              boxShadow: `0 0 12px ${k.c}`,
                              animationDelay: `${i * 0.1}s`,
                            }}
                          />
                        </span>
                        <span className="w-6 text-right font-display text-sm font-black" style={{ color: k.c }}>
                          {k.v}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center">
                {stage >= 3 && (
                  <div className="rise-fade text-center">
                    <div className="font-mono2 text-[11px] tracking-[0.45em] text-cyan-300/70">TOTAL SCORE</div>
                    <div className="font-display text-6xl font-black leading-none text-white neon md:text-8xl">
                      {String(scoreVal).padStart(3, "0")}
                    </div>
                    <div className="mt-1 font-mono2 text-[11px] tracking-widest text-white/40">
                      {stats.solved} Q × {di.points} PTS
                    </div>
                    {isBest && stats.score > 0 && (
                      <div className="mt-2 inline-block clip-chip bg-yellow-300/20 px-3 py-1 font-display text-xs font-black tracking-[0.3em] text-yellow-200 neon">
                        NEW RECORD
                      </div>
                    )}
                  </div>
                )}

                {stage >= 4 && (
                  <div className="relative mt-5 flex flex-col items-center">
                    <div
                      className="orbit-rev absolute -inset-8 rounded-full border border-dashed opacity-40"
                      style={{ borderColor: rank.color }}
                    />
                    <div
                      className="rank-in font-display text-8xl font-black leading-none md:text-9xl"
                      style={{ color: rank.color, textShadow: `0 0 24px ${rank.color}, 0 0 70px ${rank.color}88` }}
                    >
                      {rank.label}
                    </div>
                    <div
                      className="rise-fade mt-1 font-mono2 text-[10px] tracking-[0.28em]"
                      style={{ color: rank.color, animationDelay: "0.5s" }}
                    >
                      {rank.title}
                    </div>

                    {/* Placement on the global leaderboard + a one-click way
                        to set/change the pilot name, right where the eye
                        lands right after the grade reveal -- this is the
                        moment the player wants to know "did I make the
                        ranking?", and renaming here means they don't have to
                        detour through the separate ranking screen to do it. */}
                    <div
                      className="rise-fade clip-panel mt-4 w-full max-w-[280px] border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 text-center"
                      style={{ animationDelay: "0.65s" }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rankInfo ? (
                        <>
                          <div className="font-mono2 text-[9px] tracking-[0.3em] text-fuchsia-200/70">GLOBAL RANKING</div>
                          <div className="mt-1 flex items-baseline justify-center gap-1">
                            <span className="font-display text-3xl font-black leading-none text-white neon" style={{ color: "#ff2bd1" }}>
                              {rankInfo.rank}
                            </span>
                            <span className="font-display text-sm font-black text-white/80">位</span>
                            <span className="ml-1 font-mono2 text-[10px] text-white/40">/ {rankInfo.total}人中</span>
                          </div>
                          <div className="font-mono2 text-[10px] tracking-[0.25em] text-fuchsia-200">にランクイン！</div>
                        </>
                      ) : rankPending ? (
                        <div className="pulse-soft py-1 font-mono2 text-[10px] tracking-widest text-white/40">集計中…</div>
                      ) : null}

                      <div className={`border-t border-white/10 pt-2.5 ${rankInfo || rankPending ? "mt-3" : ""}`}>
                        <div className="mb-1 font-mono2 text-[9px] tracking-[0.3em] text-cyan-300/60">PILOT NAME</div>
                        {editingName ? (
                          <div className="flex items-center gap-1.5">
                            <div className="flex min-w-0 flex-1 flex-col">
                              <input
                                autoFocus
                                value={nameDraft}
                                maxLength={12}
                                onChange={(e) => {
                                  setNameDraft(e.target.value);
                                  if (nameError) setNameError(null);
                                }}
                                onKeyDown={(e) => {
                                  e.stopPropagation();
                                  if (e.key === "Enter") commitName();
                                  if (e.key === "Escape") {
                                    setNameDraft(name);
                                    setNameError(null);
                                    setEditingName(false);
                                  }
                                }}
                                className="w-full border border-cyan-400/40 bg-black/60 px-2 py-1 text-center font-display text-xs font-bold tracking-wider text-white outline-none"
                              />
                              {nameError && (
                                <span className="mt-0.5 font-mono2 text-[9px] tracking-wider text-rose-400">{nameError}</span>
                              )}
                            </div>
                            <button
                              onClick={commitName}
                              disabled={nameSaving}
                              className="clip-chip shrink-0 bg-cyan-400/80 px-2.5 py-1 font-display text-[10px] font-black tracking-wider text-black disabled:opacity-50"
                            >
                              {nameSaving ? "..." : "SAVE"}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              sfxUI();
                              setNameDraft(name);
                              setEditingName(true);
                            }}
                            className="font-display text-sm font-black tracking-wider text-white underline decoration-cyan-400/50 decoration-dashed underline-offset-4 hover:text-cyan-200"
                            title="クリックして名前を変更"
                          >
                            {name} <span className="ml-1 font-mono2 text-[9px] text-white/30">EDIT</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {stage >= 5 && (
              <div className="rise-fade mt-7 flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-5">
                <button
                  onClick={() => {
                    sfxSelect();
                    onRetry();
                  }}
                  className="clip-btn group relative w-full overflow-hidden px-10 py-3 md:w-auto"
                  style={{
                    background: `linear-gradient(100deg, ${di.accent}0.3), rgba(0,0,0,0.4))`,
                    border: `1px solid ${di.color}`,
                    boxShadow: `0 0 26px ${di.accent}0.4)`,
                  }}
                >
                  <span className="font-display text-lg font-black tracking-[0.3em] text-white">RETRY</span>
                  <span className="absolute inset-y-0 -left-full w-1/2 skew-x-[-20deg] bg-white/20 transition-all duration-500 group-hover:left-[140%]" />
                </button>
                <button
                  onClick={() => {
                    sfxSelect();
                    onTitle();
                  }}
                  className="clip-btn w-full border border-white/25 bg-white/5 px-10 py-3 font-display text-lg font-black tracking-[0.3em] text-white/70 transition-colors hover:bg-white/10 hover:text-white md:w-auto"
                >
                  TITLE
                </button>
                <button
                  onClick={() => {
                    sfxSelect();
                    onRanking();
                  }}
                  className="clip-btn w-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-10 py-3 font-display text-lg font-black tracking-[0.3em] text-fuchsia-200 transition-colors hover:bg-fuchsia-500/20 hover:text-white md:w-auto"
                >
                  🏆 RANKING
                </button>
              </div>
            )}

            {stage < 5 && (
              <div className="mt-6 text-center font-mono2 text-[10px] tracking-[0.3em] text-white/30">CLICK / ANY KEY TO SKIP</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
