import { useEffect, useState } from "react";
import Backdrop from "./Backdrop";
import { DIFF_INFO, MAX_PAUSES, MODE_INFO, MODE_ORDER, TITLE_DIFFS, type Difficulty, type ProblemMode } from "../lib/problems";
import { sfxSelect, sfxStart, sfxUI } from "../lib/audio";
import { claimName, loadPlayerName } from "../lib/ranking";
import { RANKS } from "../lib/ranks";
import { subscribeVisitCount } from "../lib/visits";

type Props = {
  onStart: (d: Difficulty, m: ProblemMode) => void;
  onRanking: () => void;
  best: Record<string, number>;
  audioReady: boolean;
  lightweight: boolean;
  ultra: boolean;
  onEnableAudio: () => void;
};

const DIFF_ORDER = TITLE_DIFFS;
const bestKey = (d: Difficulty, m: ProblemMode) => `${d}::${m}`;

export default function TitleScreen({ onStart, onRanking, best, audioReady, lightweight, ultra, onEnableAudio }: Props) {
  const [selMode, setSelMode] = useState<ProblemMode>("random");
  const [selDiff, setSelDiff] = useState<Difficulty>("normal");
  const [launching, setLaunching] = useState(false);
  const [focus, setFocus] = useState<"mode" | "diff" | "start">("mode");
  const [name, setName] = useState(() => loadPlayerName());
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [showRankTable, setShowRankTable] = useState(false);
  const [visitCount, setVisitCount] = useState<number | null>(null);

  useEffect(() => subscribeVisitCount(setVisitCount), []);

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

  const mi = MODE_INFO[selMode];
  const di = DIFF_INFO[selDiff];

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (launching) return;
      if (focus === "mode") {
        const i = MODE_ORDER.indexOf(selMode);
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSelMode(MODE_ORDER[(i + MODE_ORDER.length - 1) % MODE_ORDER.length]);
          sfxUI();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setSelMode(MODE_ORDER[(i + 1) % MODE_ORDER.length]);
          sfxUI();
        } else if (e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          setFocus("diff");
          sfxSelect();
        }
      } else if (focus === "diff") {
        const i = DIFF_ORDER.indexOf(selDiff);
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSelDiff(DIFF_ORDER[(i + DIFF_ORDER.length - 1) % DIFF_ORDER.length]);
          sfxUI();
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setSelDiff(DIFF_ORDER[(i + 1) % DIFF_ORDER.length]);
          sfxUI();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocus("mode");
          sfxSelect();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setFocus("start");
          sfxSelect();
        } else if (e.key === "Enter") {
          e.preventDefault();
          setFocus("start");
          sfxSelect();
        }
      } else {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setFocus("diff");
          sfxUI();
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          launch();
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMode, selDiff, focus, launching]);

  const launch = () => {
    if (launching) return;
    onEnableAudio();
    setLaunching(true);
    sfxStart();
    window.setTimeout(() => onStart(selDiff, selMode), 620);
  };

  return (
    <div className="relative h-full w-full overflow-y-auto overflow-x-hidden overscroll-contain">
      <Backdrop accent={mi.color} lightweight={lightweight} ultra={ultra} />

      {launching && (
        <div className="pointer-events-none absolute inset-0 z-50 bg-white" style={{ animation: "flash-fade 0.6s ease-in forwards" }} />
      )}

      <div className="relative z-10 flex min-h-full w-full flex-col items-center px-5 pb-8 pt-4 md:justify-center md:py-5">
        <div
          className="static mb-3 flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-1 font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/60 md:absolute md:inset-x-0 md:top-0 md:mb-0 md:flex-nowrap md:px-5 md:py-3"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="flex items-center gap-3">
            <span>SYS://NUMERIC_VELOCITY.EXE</span>
            <span className="pulse-soft hidden md:inline">ONLINE</span>
            {!audioReady && <span className="text-mag-neon hidden md:inline">AUDIO STANDBY</span>}
          </span>
          <span className="flex items-center gap-2">
            {editingName ? (
              <span className="flex items-center gap-1.5">
                <span className="flex flex-col items-start">
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
                    className="w-24 border border-cyan-400/40 bg-black/60 px-1.5 py-1 font-ui text-[11px] font-bold tracking-wider text-white outline-none md:w-32"
                  />
                  {nameError && (
                    <span className="mt-0.5 font-mono2 text-[9px] tracking-wider text-rose-400">{nameError}</span>
                  )}
                </span>
                <button
                  onClick={commitName}
                  disabled={nameSaving}
                  className="clip-chip bg-cyan-400/80 px-2 py-1 font-mono2 text-[9px] font-black text-black disabled:opacity-50"
                >
                  {nameSaving ? "..." : "SAVE"}
                </button>
              </span>
            ) : (
              <button
                onClick={() => {
                  sfxUI();
                  setNameDraft(name);
                  setEditingName(true);
                }}
                title="クリックしてパイロット名を変更"
                className="clip-chip border border-white/15 bg-black/40 px-2.5 py-1 font-ui text-[11px] font-bold tracking-wider text-white/75 hover:border-cyan-300/50 hover:text-cyan-100"
              >
                PILOT: {name}
              </button>
            )}
            <button
              onClick={() => {
                sfxSelect();
                onRanking();
              }}
              className="clip-chip border border-fuchsia-400/30 bg-black/40 px-2.5 py-1 font-mono2 text-[10px] font-black tracking-[0.15em] text-fuchsia-200/85 hover:border-fuchsia-300 hover:text-fuchsia-100"
            >
              🏆 RANKING
            </button>
            <button
              onClick={() => {
                sfxUI();
                setShowRankTable(true);
              }}
              className="clip-chip border border-cyan-400/30 bg-black/40 px-2.5 py-1 font-mono2 text-[10px] font-black tracking-[0.15em] text-cyan-200/85 hover:border-cyan-300 hover:text-cyan-100"
            >
              ⚙ RANK一覧
            </button>
          </span>
        </div>

        <div className="relative mb-1 flex select-none flex-col items-center gap-1 text-center">
          <div className="font-mono2 text-[11px] tracking-[0.55em] text-cyan-300/70 md:text-xs">SOLO // TIME ATTACK</div>
          <h1
            className="glitch flicker title-logo font-display font-black tracking-tight text-white neon"
            data-text="数速バトル"
          >
            数速バトル
          </h1>
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-10 bg-cyan-400/60 md:w-20" />
            <span className="font-display text-[10px] font-semibold tracking-[0.42em] text-cyan-200/90 md:text-sm">
              NUMERIC&nbsp;VELOCITY
            </span>
            <span className="h-px w-10 bg-cyan-400/60 md:w-20" />
          </div>
          <p className="mt-1.5 max-w-md text-center font-ui text-[10.5px] leading-relaxed tracking-wide text-white/40 md:text-xs">
            暗算・計算スピードを競う無料のブラウザ計算ゲーム。加減算から乗除算、素因数分解まで、頭の回転力を鍛える脳トレバトル。
          </p>
        </div>

        <div className="mt-5 w-full max-w-3xl">
          <div
            className="mb-1.5 flex items-center gap-2 font-mono2 text-[10px] tracking-[0.3em]"
            style={{ color: focus === "mode" ? mi.color : "rgba(103,232,249,0.7)" }}
          >
            <span className="h-1.5 w-1.5 rotate-45" style={{ background: mi.color }} />
            01 // 分野を選択
            <span className="ml-2 text-white/30">クリックした枠が選択中</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {MODE_ORDER.map((m) => {
              const mInfo = MODE_INFO[m];
              const selected = selMode === m;
              const focused = focus === "mode" && selected;
              return (
                <button
                  key={m}
                  onClick={() => {
                    setSelMode(m);
                    setFocus("mode");
                    sfxSelect();
                  }}
                  className="clip-btn relative overflow-hidden px-2 py-3 text-left transition-transform duration-150 hover:scale-[1.02] active:scale-95 md:px-3 md:py-4"
                  style={{
                    background: selected
                      ? `linear-gradient(135deg, ${mInfo.accent}0.32), ${mInfo.accent}0.07))`
                      : "rgba(255,255,255,0.025)",
                    border: `1px solid ${selected ? mInfo.color : "rgba(255,255,255,0.14)"}`,
                    boxShadow: selected
                      ? `0 0 30px ${mInfo.accent}0.38), inset 0 0 30px ${mInfo.accent}0.13)`
                      : "none",
                    opacity: selected ? 1 : 0.7,
                  }}
                >
                  <div className="font-mono2 text-[9px] tracking-[0.25em]" style={{ color: mInfo.color, opacity: 0.82 }}>
                    {mInfo.sub}
                  </div>
                  <div
                    className="font-display text-base font-black leading-none md:text-xl"
                    style={{ color: selected ? "#fff" : mInfo.color, textShadow: selected ? `0 0 16px ${mInfo.color}` : "none" }}
                  >
                    {mInfo.label}
                  </div>
                  {selected && (
                    <>
                      <div
                        className="absolute inset-x-0 bottom-0 h-1"
                        style={{ background: `linear-gradient(90deg, transparent, ${mInfo.color}, transparent)` }}
                      />
                      <div className="absolute right-2 top-2 font-mono2 text-[9px] tracking-widest" style={{ color: mInfo.color }}>
                        SELECTED
                      </div>
                    </>
                  )}
                  {focused && <span className="absolute inset-0 border border-white/45" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 h-4 font-ui text-[11px] tracking-wider text-white/55 md:text-xs">{mi.desc}</div>
        </div>

        <div className="mt-3 w-full max-w-3xl">
          <div
            className="mb-1.5 flex items-center gap-2 font-mono2 text-[10px] tracking-[0.3em]"
            style={{ color: focus === "diff" ? di.color : "rgba(103,232,249,0.7)" }}
          >
            <span className="h-1.5 w-1.5 rotate-45" style={{ background: di.color }} />
            02 // 難易度を選択
          </div>
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {DIFF_ORDER.map((d) => {
              const dInfo = DIFF_INFO[d];
              const selected = selDiff === d;
              const focused = focus === "diff" && selected;
              return (
                <button
                  key={d}
                  onClick={() => {
                    setSelDiff(d);
                    setFocus("diff");
                    sfxSelect();
                  }}
                  className="clip-btn relative overflow-hidden px-2 py-3 text-left transition-transform duration-150 hover:scale-[1.02] active:scale-95 md:px-4 md:py-4"
                  style={{
                    background: selected
                      ? `linear-gradient(135deg, ${dInfo.accent}0.28), ${dInfo.accent}0.06))`
                      : "rgba(255,255,255,0.025)",
                    border: `1px solid ${selected ? dInfo.color : "rgba(255,255,255,0.14)"}`,
                    boxShadow: selected
                      ? `0 0 28px ${dInfo.accent}0.36), inset 0 0 28px ${dInfo.accent}0.12)`
                      : "none",
                    opacity: selected ? 1 : 0.7,
                  }}
                >
                  <div className="font-mono2 text-[9px] tracking-[0.25em]" style={{ color: dInfo.color, opacity: 0.82 }}>
                    {dInfo.sub}
                  </div>
                  <div className="flex flex-col items-start gap-0.5 md:flex-row md:items-baseline md:gap-2">
                    <div
                      className="font-display text-lg font-black leading-none md:text-2xl"
                      style={{ color: selected ? "#fff" : dInfo.color, textShadow: selected ? `0 0 14px ${dInfo.color}` : "none" }}
                    >
                      {dInfo.label}
                    </div>
                    <div className="font-display text-base font-black leading-none md:text-xl" style={{ color: dInfo.color }}>
                      x{dInfo.points}
                    </div>
                  </div>
                  <div className="mt-1 font-mono2 text-[9px] tracking-wider text-white/40">
                    BEST {String(best[bestKey(d, selMode)] ?? 0).padStart(4, "0")}
                  </div>
                  {selected && (
                    <>
                      <div
                        className="absolute inset-x-0 bottom-0 h-1"
                        style={{ background: `linear-gradient(90deg, transparent, ${dInfo.color}, transparent)` }}
                      />
                      <div className="absolute right-2 top-2 font-mono2 text-[9px] tracking-widest" style={{ color: dInfo.color }}>
                        SELECTED
                      </div>
                    </>
                  )}
                  {focused && <span className="absolute inset-0 border border-white/45" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="clip-panel mt-3 w-full max-w-3xl border border-cyan-400/20 bg-black/45 px-4 py-3 backdrop-blur-sm">
          <div className="mb-1.5 flex items-center gap-2 font-mono2 text-[10px] tracking-[0.35em] text-cyan-300/70">
            <span className="h-2 w-2 rotate-45 bg-cyan-400" /> MISSION BRIEFING
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 font-ui text-[11.5px] leading-relaxed text-white/70 md:grid-cols-2 md:text-[12.5px]">
            <p>制限時間 <span className="font-display font-bold text-cyan-300">3:00</span>。解けた数 x 難易度倍率 = SCORE</p>
            <p>分野は <span className="text-cyan-300">加減算 / 乗除算 / 素因数分解 / ランダム</span></p>
            <p>素因数分解は素数を1つずつ ENTER。空欄で BackSpace = 1つ削除</p>
            <p>
              <span className="text-cyan-300">ESC</span> でポーズ（
              <span className="text-cyan-300">{MAX_PAUSES}回</span>まで）。30秒から赤表示、10秒からカウント音
            </p>
          </div>
        </div>

        <button
          onMouseEnter={() => setFocus("start")}
          onClick={() => {
            setFocus("start");
            launch();
          }}
          className="clip-btn group relative mt-4 overflow-hidden px-14 py-3.5 transition-transform duration-150 hover:scale-[1.04] active:scale-95 md:px-20 md:py-4"
          style={{
            background:
              focus === "start"
                ? `linear-gradient(100deg, ${mi.accent}0.3), ${di.accent}0.3))`
                : `linear-gradient(100deg, ${mi.accent}0.18), ${di.accent}0.18))`,
            border: `1px solid ${focus === "start" ? mi.color : "rgba(255,255,255,0.25)"}`,
            boxShadow: focus === "start" ? `0 0 34px ${mi.accent}0.5), 0 0 60px ${di.accent}0.35)` : "none",
          }}
        >
          <span
            className="font-display text-lg font-black tracking-[0.35em] text-white md:text-2xl"
            style={{ textShadow: `0 0 14px ${mi.color}` }}
          >
            START
          </span>
          <span className="ml-3 font-mono2 text-[10px] tracking-[0.2em] text-white/60">
            {mi.label} x {di.label}
          </span>
          <span className="absolute inset-y-0 -left-full w-1/2 skew-x-[-20deg] bg-white/25 transition-all duration-500 group-hover:left-[140%]" />
        </button>

        <div className="mt-2 font-mono2 text-[10px] tracking-[0.3em] text-white/30">
          [ CLICK ] SELECT&nbsp;&nbsp;/&nbsp;&nbsp;[ ARROWS ] MOVE&nbsp;&nbsp;/&nbsp;&nbsp;[ ENTER ] START
        </div>
        {visitCount !== null && (
          <div className="mt-1 font-mono2 text-[9px] tracking-[0.25em] text-white/25">
            TOTAL ACCESS // {String(visitCount).padStart(6, "0")}
          </div>
        )}
      </div>

      {/* RANK TABLE MODAL -- shows the score->rank breakdown (the same table
          ResultScreen uses to pick a rank) so a player can check what score
          they need for the next grade without having to finish a run first. */}
      {showRankTable && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          style={{ animation: "pop-in 0.18s ease-out both" }}
          onClick={() => {
            sfxUI();
            setShowRankTable(false);
          }}
        >
          <div
            className="clip-panel relative w-[min(92vw,520px)] max-h-[86vh] overflow-y-auto border border-cyan-400/40 bg-black/85 p-5 backdrop-blur-xl md:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="absolute left-2 top-2 h-3 w-3 border-l border-t border-cyan-300/80" />
            <span className="absolute right-2 top-2 h-3 w-3 border-r border-t border-cyan-300/80" />
            <span className="absolute bottom-2 left-2 h-3 w-3 border-b border-l border-cyan-300/80" />
            <span className="absolute bottom-2 right-2 h-3 w-3 border-b border-r border-cyan-300/80" />

            <div className="mb-1 font-mono2 text-[10px] tracking-[0.4em] text-cyan-300/70">SYSTEM // RANK TABLE</div>
            <h2 className="glitch font-display text-2xl font-black tracking-[0.15em] text-white neon md:text-3xl" data-text="RANK一覧">
              RANK一覧
            </h2>
            <div className="mt-1 mb-4 font-mono2 text-[10px] tracking-widest text-white/35">
              SCORE = 解けた数 × 難易度倍率
            </div>

            <div className="flex flex-col gap-2">
              {RANKS.map((r) => (
                <div
                  key={r.label}
                  className="clip-btn flex items-center gap-3 border px-3 py-2.5 md:px-4 md:py-3"
                  style={{ borderColor: `${r.color}55`, background: `${r.color}14` }}
                >
                  <div
                    className="font-display w-14 shrink-0 text-center text-3xl font-black leading-none md:w-16 md:text-4xl"
                    style={{ color: r.color, textShadow: `0 0 12px ${r.color}` }}
                  >
                    {r.label}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono2 text-[11px] font-bold tracking-[0.15em] md:text-xs" style={{ color: r.color }}>
                      {r.title}
                    </div>
                    <div className="mt-0.5 font-mono2 text-[9px] tracking-widest text-white/40 md:text-[10px]">
                      SCORE {r.min}〜
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                sfxUI();
                setShowRankTable(false);
              }}
              className="clip-btn mt-5 w-full border border-white/25 bg-white/5 px-5 py-2.5 font-display text-sm font-black tracking-[0.2em] text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
