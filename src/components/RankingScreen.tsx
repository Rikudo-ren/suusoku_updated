import { useEffect, useMemo, useState } from "react";
import Backdrop from "./Backdrop";
import { DIFF_INFO, MODE_INFO, MODE_ORDER, TITLE_DIFFS, type Difficulty, type ProblemMode } from "../lib/problems";
import { boardKey, claimName, ensureAuthUid, getCurrentUid, loadPlayerName, subscribeBoard, type RankEntry } from "../lib/ranking";
import { sfxSelect, sfxUI } from "../lib/audio";

type Props = {
  lightweight: boolean;
  ultra: boolean;
  initialMode?: ProblemMode;
  initialDifficulty?: Difficulty;
  onBack: () => void;
};

type Step = "mode" | "difficulty" | "board";

const MEDAL = ["#ffe45e", "#d7e2f5", "#ff9a4d"];

function fmtDate(ts: number) {
  if (!ts) return "―";
  const d = new Date(ts);
  return d.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function RankingScreen({ lightweight, ultra, initialMode, initialDifficulty, onBack }: Props) {
  const initialBoth = Boolean(initialMode && initialDifficulty);
  const [step, setStep] = useState<Step>(initialBoth ? "board" : "mode");
  const [selMode, setSelMode] = useState<ProblemMode | null>(initialMode ?? null);
  const [selDiff, setSelDiff] = useState<Difficulty | null>(initialDifficulty ?? null);
  const [boards, setBoards] = useState<Partial<Record<string, RankEntry[]>>>({});
  const [name, setName] = useState(() => loadPlayerName());
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(() => getCurrentUid());

  useEffect(() => {
    if (!myUid) ensureAuthUid().then(setMyUid).catch(() => {});
  }, [myUid]);

  useEffect(() => {
    const unsubs = MODE_ORDER.flatMap((m) =>
      TITLE_DIFFS.map((d) =>
        subscribeBoard(m, d, 20, (entries) => {
          setBoards((prev) => ({ ...prev, [boardKey(m, d)]: entries }));
        }),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  const top1 = useMemo(() => {
    const map: Partial<Record<string, RankEntry>> = {};
    for (const m of MODE_ORDER) {
      for (const d of TITLE_DIFFS) {
        const arr = boards[boardKey(m, d)];
        if (arr && arr.length) map[boardKey(m, d)] = arr[0];
      }
    }
    return map;
  }, [boards]);

  const bestOfMode = (m: ProblemMode) => {
    let best: RankEntry | null = null;
    for (const d of TITLE_DIFFS) {
      const e = top1[boardKey(m, d)];
      if (e && (!best || e.score > best.score)) best = e;
    }
    return best;
  };

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

  const pickMode = (m: ProblemMode) => {
    sfxSelect();
    setSelMode(m);
    setStep("difficulty");
  };

  const pickDiff = (d: Difficulty) => {
    sfxSelect();
    setSelDiff(d);
    setStep("board");
  };

  const backTo = (s: Step) => {
    sfxUI();
    setStep(s);
  };

  const mi = selMode ? MODE_INFO[selMode] : null;
  const di = selDiff ? DIFF_INFO[selDiff] : null;
  const accent = mi?.color ?? "#22e4ff";

  const activeKey = selMode && selDiff ? boardKey(selMode, selDiff) : null;
  const activeEntries = activeKey ? boards[activeKey] : undefined;
  const loading = activeEntries === undefined;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Backdrop accent={accent} intensity={0.75} lightweight={lightweight} ultra={ultra} />

      <div className="relative z-10 flex h-full w-full flex-col items-center overflow-y-auto px-4 py-5 md:px-8">
        <div className="flex w-full max-w-3xl items-center justify-between font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/60">
          <span>SYS://RANKING.EXE</span>
          <span className="pulse-soft">LIVE</span>
        </div>

        <div className="mt-1 flex w-full max-w-3xl items-center justify-between">
          <h1 className="glitch font-display text-2xl font-black tracking-tight text-white neon md:text-4xl" data-text="GLOBAL RANKING">
            GLOBAL RANKING
          </h1>
          <button
            onClick={() => {
              sfxSelect();
              onBack();
            }}
            className="clip-btn border border-white/25 bg-white/5 px-4 py-2 font-display text-xs font-black tracking-[0.2em] text-white/75 transition-colors hover:bg-white/10 hover:text-white md:text-sm"
          >
            ← TITLE
          </button>
        </div>

        {/* player name */}
        <div className="clip-panel mt-3 flex w-full max-w-3xl items-center justify-between gap-3 border border-cyan-400/20 bg-black/45 px-4 py-2.5 backdrop-blur-sm">
          <span className="font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/60">PILOT NAME</span>
          {editingName ? (
            <div className="flex flex-1 items-center gap-2">
              <div className="flex min-w-0 flex-1 max-w-[220px] flex-col">
                <input
                  autoFocus
                  value={nameDraft}
                  maxLength={12}
                  onChange={(e) => {
                    setNameDraft(e.target.value);
                    if (nameError) setNameError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") {
                      setNameDraft(name);
                      setNameError(null);
                      setEditingName(false);
                    }
                  }}
                  className="w-full border border-cyan-400/40 bg-black/60 px-2 py-1 font-display text-sm font-bold tracking-wider text-white outline-none"
                />
                {nameError && (
                  <span className="mt-0.5 font-mono2 text-[10px] tracking-wider text-rose-400">{nameError}</span>
                )}
              </div>
              <button
                onClick={commitName}
                disabled={nameSaving}
                className="clip-chip shrink-0 bg-cyan-400/80 px-3 py-1 font-display text-xs font-black tracking-wider text-black disabled:opacity-50"
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
              className="font-display text-sm font-black tracking-wider text-white/90 underline decoration-cyan-400/50 decoration-dashed underline-offset-4 hover:text-cyan-200"
              title="クリックして名前を変更"
            >
              {name} <span className="ml-1 font-mono2 text-[9px] text-white/30">EDIT</span>
            </button>
          )}
        </div>

        {/* breadcrumb */}
        <div className="mt-3 flex w-full max-w-3xl items-center gap-2 font-mono2 text-[10px] tracking-[0.25em]">
          <button
            onClick={() => backTo("mode")}
            className={step === "mode" ? "text-white" : "text-cyan-300/60 hover:text-cyan-200"}
          >
            01 分野
          </button>
          <span className="text-white/20">/</span>
          <button
            onClick={() => selMode && backTo("difficulty")}
            disabled={!selMode}
            className={
              step === "difficulty"
                ? "text-white"
                : selMode
                  ? "text-cyan-300/60 hover:text-cyan-200"
                  : "text-white/20"
            }
          >
            02 難易度{selMode ? ` — ${MODE_INFO[selMode].label}` : ""}
          </button>
          <span className="text-white/20">/</span>
          <span className={step === "board" ? "text-white" : "text-white/20"}>
            03 ランキング{selDiff ? ` — ${DIFF_INFO[selDiff].label}` : ""}
          </span>
        </div>

        {/* STEP 1: mode select */}
        {step === "mode" && (
          <div className="mt-3 w-full max-w-3xl">
            <div className="mb-1.5 flex items-center gap-2 font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/60">
              <span className="h-1.5 w-1.5 rotate-45 bg-cyan-400" /> STEP 1 // 分野を選択
            </div>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {MODE_ORDER.map((m) => {
                const info = MODE_INFO[m];
                const best = bestOfMode(m);
                return (
                  <button
                    key={m}
                    onClick={() => pickMode(m)}
                    className="clip-btn relative overflow-hidden px-3 py-5 text-left transition-transform duration-150 hover:scale-[1.03] active:scale-95"
                    style={{
                      background: `linear-gradient(135deg, ${info.accent}0.22), ${info.accent}0.05))`,
                      border: `1px solid ${info.color}`,
                      boxShadow: `0 0 24px ${info.accent}0.25)`,
                    }}
                  >
                    <div className="font-mono2 text-[9px] tracking-[0.25em]" style={{ color: info.color, opacity: 0.85 }}>
                      {info.sub}
                    </div>
                    <div
                      className="font-display text-xl font-black leading-none md:text-2xl"
                      style={{ color: "#fff", textShadow: `0 0 14px ${info.color}` }}
                    >
                      {info.label}
                    </div>
                    <div className="mt-2 font-mono2 text-[9px] tracking-widest text-white/35">
                      {best ? (
                        <>
                          TOP <span className="text-white/70">{best.name}</span> ・{" "}
                          <span className="font-display text-xs font-black text-white">{best.score}</span>
                        </>
                      ) : (
                        "NO DATA"
                      )}
                    </div>
                    <span className="absolute bottom-2 right-2 font-mono2 text-[10px] tracking-widest" style={{ color: info.color }}>
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: difficulty select */}
        {step === "difficulty" && selMode && mi && (
          <div className="mt-3 w-full max-w-3xl">
            <div
              className="mb-1.5 flex items-center justify-between gap-2 font-mono2 text-[10px] tracking-[0.3em]"
              style={{ color: mi.color }}
            >
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rotate-45" style={{ background: mi.color }} /> STEP 2 // {mi.label} の難易度を選択
              </span>
              <button onClick={() => backTo("mode")} className="text-white/40 hover:text-white">
                ← 分野選択に戻る
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              {TITLE_DIFFS.map((d) => {
                const info = DIFF_INFO[d];
                const top = top1[boardKey(selMode, d)];
                return (
                  <button
                    key={d}
                    onClick={() => pickDiff(d)}
                    className="clip-btn relative overflow-hidden px-4 py-5 text-left transition-transform duration-150 hover:scale-[1.03] active:scale-95"
                    style={{
                      background: `linear-gradient(135deg, ${info.accent}0.24), ${info.accent}0.05))`,
                      border: `1px solid ${info.color}`,
                      boxShadow: `0 0 24px ${info.accent}0.28)`,
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <div className="font-mono2 text-[9px] tracking-[0.25em]" style={{ color: info.color, opacity: 0.85 }}>
                        {info.sub}
                      </div>
                    </div>
                    <div
                      className="font-display text-2xl font-black leading-none md:text-3xl"
                      style={{ color: "#fff", textShadow: `0 0 14px ${info.color}` }}
                    >
                      {info.label}
                    </div>
                    <div className="mt-2 font-mono2 text-[10px] tracking-widest text-white/40">
                      {top ? (
                        <>
                          👑 <span className="text-white/75">{top.name}</span> —{" "}
                          <span className="font-display text-sm font-black text-white">{top.score}</span> pt
                        </>
                      ) : (
                        "NO DATA"
                      )}
                    </div>
                    <span className="absolute bottom-3 right-3 font-mono2 text-[11px] tracking-widest" style={{ color: info.color }}>
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3: board detail */}
        {step === "board" && selMode && selDiff && mi && di && (
          <div className="clip-panel mt-3 mb-6 w-full max-w-3xl border border-cyan-400/20 bg-black/50 px-4 py-4 backdrop-blur-sm md:px-6 md:py-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono2 text-[10px] tracking-[0.3em]" style={{ color: mi.color }}>
                  {mi.label} / {mi.sub}
                </span>
                <span className="font-mono2 text-[10px] tracking-[0.3em]" style={{ color: di.color }}>
                  × {di.label}
                </span>
              </div>
              <button onClick={() => backTo("difficulty")} className="font-mono2 text-[9px] tracking-[0.25em] text-white/40 hover:text-white">
                ← 難易度選択に戻る
              </button>
            </div>

            {loading && <div className="py-8 text-center font-mono2 text-xs tracking-widest text-white/30">LOADING…</div>}

            {!loading && activeEntries.length === 0 && (
              <div className="py-8 text-center font-mono2 text-xs tracking-widest text-white/30">
                まだ記録がありません。最初のランカーになろう。
              </div>
            )}

            {!loading && activeEntries.length > 0 && (
              <div className="space-y-1">
                {activeEntries.map((e, i) => {
                  const isYou = e.uid ? e.uid === myUid : e.name === name;
                  return (
                    <div
                      key={e.id}
                      className="rise-fade flex items-center gap-3 border-b border-white/8 px-1 py-1.5"
                      style={{
                        animationDelay: `${Math.min(i, 10) * 0.03}s`,
                        background: isYou ? "rgba(34,228,255,0.08)" : "transparent",
                      }}
                    >
                      <span
                        className="w-8 shrink-0 text-center font-display text-sm font-black md:w-10 md:text-base"
                        style={{ color: MEDAL[i] ?? "rgba(255,255,255,0.4)" }}
                      >
                        {i < 3 ? "●" : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-ui text-[13px] font-semibold text-white/85 md:text-sm">
                        {e.name}
                        {isYou && (
                          <span className="ml-2 clip-chip bg-cyan-400/20 px-1.5 py-0.5 font-mono2 text-[8px] tracking-widest text-cyan-200">
                            YOU
                          </span>
                        )}
                      </span>
                      <span className="hidden shrink-0 font-mono2 text-[10px] tracking-wider text-white/30 sm:block">
                        MISS {e.misses} · MAX×{e.maxCombo}
                      </span>
                      <span className="hidden shrink-0 font-mono2 text-[9px] tracking-wider text-white/25 md:block">{fmtDate(e.ts)}</span>
                      <span className="w-16 shrink-0 text-right font-display text-lg font-black text-white md:w-20 md:text-xl">
                        {e.score}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
