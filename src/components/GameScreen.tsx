import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Backdrop from "./Backdrop";
import {
  DIFF_INFO,
  generateProblem,
  isPrime,
  MAX_PAUSES,
  MODE_INFO,
  type Difficulty,
  type Problem,
  type ProblemKind,
  type ProblemMode,
} from "../lib/problems";
import {
  setMusicMode,
  sfxCorrect,
  sfxDelete,
  sfxError,
  sfxFactorAdd,
  sfxSelect,
  sfxTick,
  sfxTimeUp,
  sfxType,
  sfxUI,
  sfxWarn,
  stopMusic,
} from "../lib/audio";

export type GameStats = {
  difficulty: Difficulty;
  mode: ProblemMode;
  solved: number;
  score: number;
  misses: number;
  maxCombo: number;
  byKind: Record<ProblemKind, number>;
};

const TOTAL_MS = 180_000;
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

// Split out and memoized so this whole 12-button block only re-renders when
// its own props (accentColor) actually change -- not on every keystroke,
// timer tick, or any other GameScreen state update. `onPress` must be a
// referentially stable function (see `handlePress` in GameScreen) or this
// memoization does nothing.
const NumPad = memo(function NumPad({ onPress, accentColor }: { onPress: (k: string) => void; accentColor: string }) {
  return (
    <>
      <div className="mt-3 grid grid-cols-5 gap-1.5 md:hidden">
        {PAD_KEYS.map((k) => (
          <button
            key={k}
            onPointerDown={() => onPress(k)}
            style={{ touchAction: "manipulation" }}
            className="clip-chip select-none border border-cyan-400/30 bg-white/5 py-3 font-display text-lg font-black text-cyan-100 active:bg-cyan-400/30"
          >
            {k}
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5 md:hidden">
        <button
          onPointerDown={() => onPress("DEL")}
          aria-label="削除"
          title="削除"
          style={{ touchAction: "manipulation" }}
          className="clip-chip flex select-none items-center justify-center border border-white/25 bg-white/5 py-3 text-white/75 active:bg-white/20"
        >
          <svg width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
            <path
              d="M7.2 1H20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7.2a1 1 0 0 1-.77-.36L1 8l5.43-6.64A1 1 0 0 1 7.2 1Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M11 5.5 16.5 11M16.5 5.5 11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onPointerDown={() => onPress("ENT")}
          style={{ touchAction: "manipulation", background: accentColor, boxShadow: `0 0 20px ${accentColor}` }}
          className="clip-chip select-none py-3 font-display text-lg font-black text-black active:brightness-90"
        >
          ⏎ ENTER
        </button>
      </div>
    </>
  );
});

type Fx = { key: number; kind: "correct" | "error"; gain: number } | null;

type Props = {
  difficulty: Difficulty;
  mode: ProblemMode;
  bgmEnabled: boolean;
  lightweight: boolean;
  ultra: boolean;
  onFinish: (s: GameStats) => void;
  onTitle: () => void;
  onRetry: () => void;
};

export default function GameScreen({ difficulty, mode, bgmEnabled, lightweight, ultra, onFinish, onTitle, onRetry }: Props) {
  const di = DIFF_INFO[difficulty];
  const mi = MODE_INFO[mode];

  const [phase, setPhase] = useState<"countdown" | "play">("countdown");
  const [count, setCount] = useState(3);
  // `remain` used to be React state updated every animation frame (~60x/sec),
  // which forced the ENTIRE screen (HUD, problem panel, on-screen keypad,
  // Backdrop) to re-render 60 times a second. That constant re-render work
  // competed with touch-event handling on the main thread and was the main
  // cause of taps feeling dropped/late during fast play. Sub-second display
  // (centiseconds + progress bar + the "critical" pulse) is now written
  // directly to the DOM via refs inside the rAF loop below, bypassing React
  // entirely. Only whole-second changes go through React state, since that's
  // the coarsest granularity anything else on screen actually needs.
  const remainRef = useRef(TOTAL_MS);
  const [secondsLeft, setSecondsLeft] = useState(Math.floor(TOTAL_MS / 1000));
  const progressBarRef = useRef<HTMLDivElement>(null);
  const csRef = useRef<HTMLSpanElement>(null);
  const bigTimeRef = useRef<HTMLDivElement>(null);

  const [problem, setProblem] = useState<Problem>(() => generateProblem(difficulty, mode));
  const [input, setInput] = useState("");
  const [factors, setFactors] = useState<number[]>([]);
  const [msg, setMsg] = useState<{ text: string; tone: "info" | "warn" } | null>(null);
  const [fx, setFx] = useState<Fx>(null);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);
  const [paused, setPaused] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeCount, setResumeCount] = useState(3);
  // ポーズは1プレイにつき MAX_PAUSES 回まで。使い切ったら ESC / PAUSE ボタン
  // どちらからの要求も無視し、代わりに警告メッセージを出す。
  const [pausesLeft, setPausesLeft] = useState(MAX_PAUSES);

  const [solved, setSolved] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [misses, setMisses] = useState(0);
  const byKind = useRef<Record<ProblemKind, number>>({ arith: 0, muldiv: 0, factor: 0 });

  const endRef = useRef(0);
  const lastSecRef = useRef(999);
  // Track the last value actually written to the DOM for the sub-second
  // bits (centiseconds text, critical-pulse transform) so the rAF loop can
  // skip re-writing them when nothing changed, instead of touching the DOM
  // unconditionally on every single frame (~60x/sec) regardless of whether
  // the value differs from last frame.
  const lastCsRef = useRef(-1);
  const lastPulseRef = useRef(false);
  const finishTimeoutRef = useRef<number | null>(null);
  const warnedRef = useRef(false);
  const doneRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fxKey = useRef(0);
  const popId = useRef(0);

  // On phones there's an on-screen number pad (below), so the real <input>
  // never needs the native virtual keyboard -- and if it gets focused (which
  // happens a lot: autoFocus, tapping anywhere, pressing a pad key) the OS
  // keyboard would otherwise pop up and cover half the screen. Making the
  // input readOnly on small screens keeps it focusable/blinking-caret and
  // fully controllable from React state, but stops the virtual keyboard from
  // ever appearing. Desktop (md+) keeps normal physical-keyboard typing.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const danger = secondsLeft <= 30;
  const critical = secondsLeft <= 10;
  const score = solved * di.points;
  const product = useMemo(() => factors.reduce((a, b) => a * b, 1), [factors]);

  /* ---------- countdown ---------- */
  useEffect(() => {
    if (phase !== "countdown") return;
    sfxUI();
    let go = 0;
    const id = window.setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          window.clearInterval(id);
          sfxWarn();
          go = window.setTimeout(() => setPhase("play"), 750);
          return 0;
        }
        sfxUI();
        return c - 1;
      });
    }, 1000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(go);
    };
  }, [phase]);

  /* ---------- timer (suspend when paused/resuming) ---------- */
  useEffect(() => {
    if (phase !== "play") return;
    if (paused || resuming) return;
    if (bgmEnabled) setMusicMode(Math.ceil(remainRef.current / 1000) <= 30 ? "danger" : "battle");
    endRef.current = performance.now() + remainRef.current;
    inputRef.current?.focus();
    let raf = 0;
    const loop = () => {
      const left = Math.max(0, endRef.current - performance.now());
      remainRef.current = left;

      // Sub-second visuals: written straight to the DOM, no setState, so
      // this never triggers a React render. Only touch the DOM when the
      // value actually changed since last frame -- writing the identical
      // string/transform ~60x/sec was extra main-thread work competing
      // with touch handling during fast play, for no visible benefit.
      if (progressBarRef.current) progressBarRef.current.style.width = `${(left / TOTAL_MS) * 100}%`;
      // `s` (whole seconds) and `cs` (centiseconds) must be derived from the
      // same Math.floor() of `left`, so they always agree with each other.
      // The old code used Math.ceil for `s` but Math.floor for `cs`, which
      // made the seconds digit hold its value for a full extra ~1000ms
      // after the centiseconds had already rolled over -- e.g. the display
      // sat on "0:01.00" for the entire final second and then snapped
      // straight to "0:00.00" instead of counting through "0:00.99" ...
      // "0:00.00" like the centiseconds actually did. The same mismatch is
      // why the clock could read a whole second ahead of where it actually
      // was right as play began.
      const totalCs = Math.floor(left / 10);
      const s = Math.floor(totalCs / 100);
      const cs = totalCs % 100;
      if (csRef.current && cs !== lastCsRef.current) {
        lastCsRef.current = cs;
        csRef.current.textContent = `.${String(cs).padStart(2, "0")}`;
      }
      if (bigTimeRef.current) {
        const pulse = left <= 10_000 && left % 1000 < 150;
        if (pulse !== lastPulseRef.current) {
          lastPulseRef.current = pulse;
          bigTimeRef.current.style.transform = pulse ? "scale(1.06)" : "";
        }
      }

      if (s !== lastSecRef.current) {
        lastSecRef.current = s;
        setSecondsLeft(s);
        if (s <= 10 && s > 0) sfxTick(s <= 3);
        if (s === 30 && !warnedRef.current) {
          warnedRef.current = true;
          sfxWarn();
          setMusicMode("danger");
          setMsg({ text: "WARNING // 残り30秒", tone: "warn" });
        }
      }
      if (left <= 0) {
        // Don't call finish() in this same tick. finish() flips state in
        // the parent that unmounts this whole screen, and since that
        // happens synchronously right here, React was batching it together
        // with this frame's setSecondsLeft(0) -- so the "0:00" frame never
        // actually got painted; the clock visually froze on "0:01.00" and
        // then jumped straight to the results screen. Force the true final
        // frame (0:00.00, empty bar) onto the DOM directly, then give the
        // browser a brief moment to actually show it before transitioning.
        if (csRef.current) csRef.current.textContent = ".00";
        if (progressBarRef.current) progressBarRef.current.style.width = "0%";
        if (bigTimeRef.current) bigTimeRef.current.style.transform = "";
        finishTimeoutRef.current = window.setTimeout(() => finishRef.current(), 260);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (finishTimeoutRef.current !== null) window.clearTimeout(finishTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, resuming, bgmEnabled]);

  useEffect(() => {
    if (phase === "play" && (paused || resuming)) stopMusic(0.18);
  }, [phase, paused, resuming]);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    sfxTimeUp();
    stopMusic(0.8);
    onFinish({
      difficulty,
      mode,
      solved,
      score: solved * di.points,
      misses,
      maxCombo,
      byKind: { ...byKind.current },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved, misses, maxCombo, difficulty, di.points, mode, onFinish]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  // ポーズ要求の唯一の入口。ESC キーとモバイルの PAUSE ボタン、両方からここを
  // 通す。残り回数が 0 のときはポーズさせず、警告音とメッセージだけ出す。
  const requestPause = () => {
    if (paused || resuming || doneRef.current) return;
    if (pausesLeft <= 0) {
      sfxError();
      setMsg({ text: `ポーズ回数の上限（${MAX_PAUSES}回）に達しました`, tone: "warn" });
      return;
    }
    setPausesLeft((p) => p - 1);
    setPaused(true);
  };

  /* ---------- ESC: pause + pause shortcuts ---------- */
  useEffect(() => {
    if (phase !== "play") return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestPause();
        return;
      }
      if (!paused) return;
      const k = e.key.toLowerCase();
      if (e.key === "Enter") {
        e.preventDefault();
        sfxSelect();
        startResume();
      } else if (k === "r") {
        e.preventDefault();
        sfxSelect();
        onRetry();
      } else if (k === "t") {
        e.preventDefault();
        sfxSelect();
        onTitle();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, resuming, pausesLeft, onRetry, onTitle]);

  const triggerFx = (kind: "correct" | "error", gain = 0) => {
    fxKey.current += 1;
    setFx({ key: fxKey.current, kind, gain });
  };

  const nextProblem = () => {
    setProblem((p) => generateProblem(difficulty, mode, p.kind));
    setInput("");
    setFactors([]);
    setMsg(null);
  };

  const onCorrect = () => {
    const c = combo + 1;
    setCombo(c);
    setMaxCombo((m) => Math.max(m, c));
    setSolved((s) => s + 1);
    byKind.current[problem.kind] += 1;
    sfxCorrect(c);
    triggerFx("correct", di.points);
    popId.current += 1;
    const id = popId.current;
    setPopups((p) => [...p, { id, text: `+${di.points}` }]);
    window.setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 900);
    nextProblem();
  };

  const onMiss = (text: string) => {
    setCombo(0);
    setMisses((m) => m + 1);
    sfxError();
    triggerFx("error");
    setMsg({ text, tone: "warn" });
  };

  const submit = () => {
    if (phase !== "play" || paused || resuming || doneRef.current) return;
    const raw = input.trim();

    if (problem.kind !== "factor") {
      if (raw === "") return;
      const val = Number(raw);
      if (Number.isNaN(val)) return;
      if (val === problem.answer) onCorrect();
      else {
        onMiss(`MISS // ${raw} は違う`);
        setInput("");
      }
      return;
    }

    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 2) {
      onMiss("2以上の素数を入力してください");
      setInput("");
      return;
    }
    if (!isPrime(n)) {
      onMiss(`${n} は素数ではありません / 素数のみ入力できます`);
      setInput("");
      return;
    }
    const rest = problem.target / product;
    if (rest % n !== 0) {
      onMiss(`${n} は ${problem.target} の素因数ではありません`);
      setInput("");
      return;
    }
    const nf = [...factors, n].sort((a, b) => a - b);
    setFactors(nf);
    setInput("");
    const prod = nf.reduce((a, b) => a * b, 1);
    if (prod === problem.target) {
      window.setTimeout(() => onCorrect(), 90);
    } else {
      sfxFactorAdd(nf.length);
      setMsg(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Backspace") {
      if (input === "" && problem.kind === "factor" && factors.length > 0) {
        e.preventDefault();
        setFactors((f) => f.slice(0, -1));
        sfxDelete();
        setMsg(null);
      }
    }
  };

  const pressKey = (k: string) => {
    if (paused || resuming) return;
    if (k === "ENT") {
      submit();
      return;
    }
    if (k === "DEL") {
      if (input === "") {
        if (problem.kind === "factor" && factors.length > 0) {
          setFactors((f) => f.slice(0, -1));
          sfxDelete();
        }
      } else {
        setInput((v) => v.slice(0, -1));
        sfxDelete();
      }
      return;
    }
    setInput((v) => (v.length < 9 ? v + k : v));
    sfxType();
    // NOTE: previously called inputRef.current?.focus() here for a visible
    // caret on mobile, but re-focusing a readOnly input on every keypad tap
    // fights the browser's own focus/tap handling and was making rapid
    // consecutive taps (especially digit -> ENTER) feel unresponsive. The
    // input still shows the typed value without needing focus.
  };

  // `pressKey` above is recreated every render (it closes over `input`,
  // `factors`, `problem`, `paused`, `resuming`, ...), which is necessary for
  // it to always act on the latest state. But that means its identity
  // changes on every keystroke, which would defeat NumPad's memoization if
  // passed directly. Routing through a ref keeps the prop we hand to NumPad
  // permanently stable (`handlePress` never changes identity) while it still
  // always calls the *current* pressKey underneath.
  const pressKeyRef = useRef(pressKey);
  pressKeyRef.current = pressKey;
  const handlePress = useCallback((k: string) => pressKeyRef.current(k), []);

  /* ---------- resume countdown ---------- */
  const startResume = () => {
    if (resuming) return;
    setResuming(true);
    setResumeCount(3);
    sfxUI();
    const id = window.setInterval(() => {
      setResumeCount((c) => {
        if (c <= 1) {
          window.clearInterval(id);
          sfxWarn();
          window.setTimeout(() => {
            setResuming(false);
            setPaused(false);
            lastSecRef.current = 999;
          }, 750);
          return 0;
        }
        sfxUI();
        return c - 1;
      });
    }, 1000);
  };

  const timeColor = danger ? "#ff3b5c" : "#22e4ff";
  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  // Only desaturate while paused/resuming -- this used to also blur the
  // problem panel (ramping back to sharp over the resume countdown), but
  // that blur came from a CSS `filter`, and ULTRA mode's global CSS rule
  // strips ALL filters for performance. That meant an ULTRA player could
  // keep reading the problem through a pause while everyone else on
  // LITE/normal had it hidden -- a real, mode-dependent advantage, not just
  // a cosmetic difference. Desaturation alone doesn't hide any information
  // (the digits stay fully legible, just less vivid), so it's fine for this
  // to differ slightly under ULTRA (where it's stripped too) -- nothing
  // here can be exploited either way.
  const saturation = resuming ? 1 - Math.max(0, resumeCount) * 0.14 : paused ? 0.4 : 1;

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onMouseDown={() => {
        // Only re-steal focus back to the input on desktop, where typing
        // happens on the physical keyboard. On mobile this is unnecessary
        // (the input is readOnly and driven by the on-screen keypad) and
        // the synthetic mousedown that follows every tap was fighting the
        // keypad buttons' own focus, making fast consecutive taps (e.g.
        // digit -> ENTER) feel like they needed a pause in between.
        if (isDesktop) inputRef.current?.focus();
      }}
    >
      <Backdrop accent={di.color} danger={danger} lightweight={lightweight} ultra={ultra} />

      {/* correct / error full-screen fx */}
      {fx && (
        <div key={fx.key} className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          {fx.kind === "correct" ? (
            <>
              <div className="flash-fade absolute inset-0" style={{ background: "radial-gradient(circle at 50% 45%, rgba(34,228,255,0.35), transparent 60%)" }} />
              {/* Rings + sparks are the priciest part of this burst, and it
                  fires on every single correct answer -- the single most
                  frequent event in the game, and exactly when the player is
                  typing fastest. Skip them in lightweight mode, and use
                  fewer sparks even in normal mode (14 -> 8) to cut down on
                  main-thread work competing with touch input. */}
              {!lightweight && (
                <>
                  <div className="ring-burst absolute h-64 w-64 rounded-full border-cyan-300" style={{ borderStyle: "solid", borderWidth: "3px" }} />
                  <div className="ring-burst absolute h-64 w-64 rounded-full border-fuchsia-400" style={{ borderStyle: "solid", borderWidth: "3px", animationDelay: "0.08s" }} />
                  {Array.from({ length: 8 }).map((_, i) => {
                    const a = (i / 8) * Math.PI * 2 + Math.random();
                    const d = 160 + Math.random() * 220;
                    return (
                      <span
                        key={i}
                        className="spark absolute h-1.5 w-1.5 rounded-full"
                        style={
                          {
                            background: i % 2 ? "#22e4ff" : "#ff2bd1",
                            boxShadow: "0 0 12px currentColor",
                            "--dx": `${Math.cos(a) * d}px`,
                            "--dy": `${Math.sin(a) * d}px`,
                          } as React.CSSProperties
                        }
                      />
                    );
                  })}
                </>
              )}
              <div className="pop-in font-display text-4xl font-black tracking-[0.3em] text-white neon md:text-6xl" style={{ animation: "float-up 0.75s ease-out forwards" }}>
                CORRECT
              </div>
            </>
          ) : (
            <div className="flash-fade absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(255,45,85,0.35), transparent 65%)" }} />
          )}
        </div>
      )}

      {/* countdown */}
      {phase === "countdown" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75">
          <div className="absolute h-[42vmin] w-[42vmin] rounded-full border border-cyan-300/30 countdown-halo" />
          <div className="absolute h-[32vmin] w-[32vmin] rounded-full border border-fuchsia-300/25 countdown-halo" style={{ animationDelay: "0.12s" }} />
          <div
            key={count}
            className="countdown-clear font-display text-[22vw] font-black text-white neon md:text-[180px]"
          >
            {count > 0 ? count : "GO"}
          </div>
        </div>
      )}

      {/* GAME UI (desaturates when paused) */}
      <div
        className="relative z-10 flex h-full w-full flex-col px-4 py-3 md:px-8 md:py-5"
        style={{
          filter: `saturate(${saturation})`,
          transform: `scale(${paused ? 0.99 : 1})`,
          transition: "filter 0.4s ease, transform 0.4s ease",
        }}
      >
        {/* HUD */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Mobile pause button: ESC (below) has no touch equivalent, so
                  this gives phone players a reachable, always-visible way to
                  pause. Placed at the top, away from the number pad. Icon is
                  drawn with CSS bars (not an emoji) to match the HUD style. */}
              {phase === "play" && !paused && !resuming && (
                <button
                  onClick={() => {
                    if (pausesLeft > 0) sfxSelect();
                    requestPause();
                  }}
                  aria-label="ポーズ"
                  title={`ポーズ（残り${pausesLeft}回）`}
                  className={`clip-chip inline-flex items-center gap-1.5 border border-white/25 bg-black/50 px-3 py-1 font-display text-xs font-black tracking-[0.2em] text-white/80 active:bg-white/15 md:hidden ${
                    pausesLeft <= 0 ? "opacity-40" : ""
                  }`}
                >
                  <span className="flex items-center gap-[3px]" aria-hidden="true">
                    <span className="h-3 w-[3px] bg-current" />
                    <span className="h-3 w-[3px] bg-current" />
                  </span>
                  PAUSE
                  <span className="font-mono2 text-[9px] tracking-normal text-white/50">×{pausesLeft}</span>
                </button>
              )}
              <div
                className="clip-chip inline-flex items-center gap-2 px-3 py-1"
                style={{ background: `${di.accent}0.14)`, border: `1px solid ${di.color}66` }}
              >
                <span className="h-1.5 w-1.5 rotate-45" style={{ background: di.color }} />
                <span className="font-display text-xs font-black tracking-[0.25em]" style={{ color: di.color }}>
                  {di.label}
                </span>
                <span className="font-mono2 text-[10px] text-white/45">×{di.points}</span>
              </div>
              <div
                className="clip-chip inline-flex items-center gap-2 px-3 py-1"
                style={{ background: `${mi.accent}0.14)`, border: `1px solid ${mi.color}66` }}
              >
                <span className="h-1.5 w-1.5 rotate-45" style={{ background: mi.color }} />
                <span className="font-display text-[11px] font-black tracking-[0.25em]" style={{ color: mi.color }}>
                  {mi.label}
                </span>
              </div>
            </div>
            <div className="relative">
              <div className="font-mono2 text-[10px] tracking-[0.35em] text-cyan-300/60">SCORE</div>
              <div className="font-display text-4xl font-black leading-none text-white neon md:text-6xl">
                {String(score).padStart(score >= 1000 ? 4 : 3, "0")}
              </div>
              {popups.map((p) => (
                <span
                  key={p.id}
                  className="float-up pointer-events-none absolute left-full top-2 ml-2 font-display text-2xl font-black text-cyan-300 neon"
                >
                  {p.text}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center">
            <div className="font-mono2 text-[10px] tracking-[0.4em]" style={{ color: danger ? "#ff8095" : "rgba(103,232,249,0.6)" }}>
              TIME REMAINING
            </div>
            <div
              ref={bigTimeRef}
              className={`font-display text-5xl font-black leading-none tabular-nums transition-colors duration-300 md:text-7xl ${
                critical ? "animate-pulse" : ""
              }`}
              style={{
                color: timeColor,
                textShadow: `0 0 12px ${timeColor}, 0 0 40px ${timeColor}88`,
                // Orbitron (loaded from Google Fonts) doesn't actually ship
                // tabular/fixed-width digit glyphs, so the `tabular-nums`
                // class above has no real effect on it -- a "1" stays
                // visibly narrower than an "8". That made this element's
                // own width flicker by a couple of px every time a digit
                // changed, and because it sits in a `justify-between` HUD
                // row next to SCORE/SOLVED, that flicker was also nudging
                // those neighbours left-right. Pinning this box to a fixed
                // width (generous enough for the widest possible
                // "M:SS.CC") stops it from ever resizing, so nothing here
                // or beside it can jitter, regardless of the font's actual
                // glyph metrics.
                width: "7.2ch",
                textAlign: "center",
              }}
            >
              {mm}:{String(ss).padStart(2, "0")}
              <span ref={csRef} className="text-2xl md:text-3xl" style={{ fontVariantNumeric: "tabular-nums" }}>
                .00
              </span>
            </div>
            <div className="mt-1 h-1.5 w-40 overflow-hidden bg-white/10 md:w-72">
              <div
                ref={progressBarRef}
                className="h-full transition-[width] duration-100"
                style={{ width: "100%", background: `linear-gradient(90deg, ${timeColor}, #fff)`, boxShadow: `0 0 14px ${timeColor}` }}
              />
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <div className="font-mono2 text-[10px] tracking-[0.35em] text-cyan-300/60">SOLVED</div>
              <div className="font-display text-3xl font-black leading-none text-white md:text-4xl">{solved}</div>
            </div>
            <div className="text-right">
              <div className="font-mono2 text-[10px] tracking-[0.35em] text-fuchsia-300/60">COMBO</div>
              <div
                className="font-display text-2xl font-black leading-none md:text-3xl"
                style={{ color: combo >= 3 ? "#ff2bd1" : "rgba(255,255,255,0.5)", textShadow: combo >= 3 ? "0 0 16px #ff2bd1" : "none" }}
              >
                ×{combo}
              </div>
            </div>
          </div>
        </div>

        {/* PROBLEM -- flex-1 + min-h-0 so this area (and only this area)
            grows/shrinks with available space. The answer area below
            (input + number pad) sits outside this flex-1 block, so its
            on-screen position never depends on the problem box's height. */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden py-2">
          <div
            key={problem.id}
            className="slide-swap clip-panel relative w-full max-w-4xl border bg-black/55 px-5 py-6 backdrop-blur-md md:px-10 md:py-9"
            style={{
              borderColor: danger ? "rgba(255,59,92,0.5)" : `${di.accent}0.45)`,
              boxShadow: `0 0 60px ${danger ? "rgba(255,59,92,0.18)" : `${di.accent}0.16)`}, inset 0 0 60px rgba(0,0,0,0.6)`,
            }}
          >
            <span className="absolute left-2 top-2 h-3 w-3 border-l border-t border-cyan-300/70" />
            <span className="absolute right-2 top-2 h-3 w-3 border-r border-t border-cyan-300/70" />
            <span className="absolute bottom-2 left-2 h-3 w-3 border-b border-l border-cyan-300/70" />
            <span className="absolute bottom-2 right-2 h-3 w-3 border-b border-r border-cyan-300/70" />

            <div className="mb-3 flex items-center justify-between font-mono2 text-[10px] tracking-[0.3em] text-cyan-300/70">
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-cyan-400" />
                {problem.label}
              </span>
              <span className="text-white/30">Q-{String(solved + 1).padStart(3, "0")}</span>
            </div>

            {/* Shake feedback lives on this inner wrapper now, not the
                panel above. The panel has backdrop-blur-md + clip-path,
                and animating `transform` on an element with
                backdrop-filter forces the browser to keep re-sampling
                whatever's behind it on every single frame of the
                animation -- one of the more expensive things you can ask
                a mobile GPU to do. That cost was landing right after every
                wrong answer, competing with the very next tap, which is
                why input could feel like it needed a beat to "wake up"
                after a miss. Shaking this plain (non-blurred) inner block
                instead keeps the same visual feedback for a fraction of
                the cost. `key` forces the animation to restart even on
                back-to-back misses -- otherwise re-applying the same
                class name to an element that's already mid-animation is a
                no-op, so a second quick miss would silently get no shake
                at all. */}
            <div key={fx?.kind === "error" ? fx.key : "idle"} className={fx?.kind === "error" ? "shake-x" : ""}>
              {problem.kind === "factor" ? (
                <div className="text-center">
                  <div className="font-display text-5xl font-black leading-none text-white neon md:text-7xl">
                    {problem.target}
                  </div>
                  <div className="mt-1 font-ui text-xs tracking-[0.2em] text-cyan-200/60">を素因数分解せよ</div>
                </div>
              ) : (
                <div className="text-center font-display text-4xl font-black leading-none text-white neon md:text-7xl">
                  {problem.expr} <span className="text-cyan-300/70">=</span> <span className="caret text-cyan-300">?</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ANSWER AREA -- fixed-height footer block, outside the flex-1
            problem area above, so the number pad's position stays put
            regardless of problem-box size (single-line expr vs factor
            mode vs a long factor chip row). */}
        <div className="mx-auto w-full max-w-4xl shrink-0 pt-3 md:pt-5">
          {problem.kind === "factor" && (
            <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
              {factors.length === 0 && (
                <span className="font-mono2 text-xs tracking-widest text-white/30">素数を1つずつ ENTER で追加</span>
              )}
              {factors.map((f, i) => (
                <span key={`${f}-${i}`} className="flex items-center gap-2">
                  {i > 0 && <span className="font-display text-lg text-cyan-300/60">×</span>}
                  <span
                    className="pop-in clip-chip px-3 py-1 font-display text-xl font-black text-white md:text-2xl"
                    style={{ background: "rgba(34,228,255,0.16)", border: "1px solid rgba(34,228,255,0.6)", boxShadow: "0 0 18px rgba(34,228,255,0.3)" }}
                  >
                    {f}
                  </span>
                </span>
              ))}
              {factors.length > 0 && (
                <span className="ml-2 font-mono2 text-sm tracking-wider text-cyan-200/80">
                  = <span className="font-display text-xl font-black text-cyan-300">{product}</span>
                  <span className="ml-2 text-white/35">/ {problem.target}</span>
                </span>
              )}
            </div>
          )}

          <div
            className="clip-btn relative flex items-center gap-3 border bg-black/60 px-4 py-3 backdrop-blur"
            style={{ borderColor: `${di.accent}0.6)`, boxShadow: `0 0 26px ${di.accent}0.22) inset` }}
          >
            <span className="font-mono2 text-sm text-cyan-400/80">{">"}</span>
            <input
              ref={inputRef}
              value={input}
              inputMode="numeric"
              autoFocus
              readOnly={!isDesktop}
              spellCheck={false}
              onChange={(e) => {
                if (paused || resuming) return;
                const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 9);
                if (v.length > input.length) sfxType();
                setInput(v);
              }}
              onKeyDown={onKeyDown}
              className="w-full bg-transparent font-display text-3xl font-black tracking-widest text-white placeholder-white/20 md:text-4xl"
              placeholder={problem.kind === "factor" ? "素数を入力" : "答えを入力"}
            />
            <button
              onClick={submit}
              className="clip-chip shrink-0 px-4 py-2 font-display text-sm font-black tracking-[0.2em] text-black"
              style={{ background: di.color, boxShadow: `0 0 20px ${di.color}` }}
            >
              ENTER
            </button>
          </div>

          <div className="mt-2 flex min-h-[22px] items-center justify-between gap-3">
            <span
              className={`font-ui text-[13px] tracking-wide ${msg?.tone === "warn" ? "text-rose-400 neon-red" : "text-cyan-200/60"}`}
            >
              {msg?.text ??
                (problem.kind === "factor"
                  ? "空欄で BackSpace = 直前の数字を削除"
                  : isDesktop
                    ? "ENTER で解答 / ESC でポーズ"
                    : "ENTER で解答 / 上部のボタンでポーズ")}
            </span>
            <span className="hidden font-mono2 text-[10px] tracking-[0.25em] text-white/25 md:block">
              MISS {misses} · MAX COMBO ×{maxCombo}
            </span>
          </div>

          {/* Numeric keypad: two rows of 1-5 / 6-0 (natural left-to-right
              reading order), with DEL/ENTER as a full-width row underneath
              so they're not squeezed into a 6th column. Buttons use
              onPointerDown (not onClick) plus touch-action: manipulation so
              rapid repeated taps register immediately instead of waiting
              out the browser's double-tap/ghost-click delay. Pulled out into
              a memoized NumPad (see above) so this block doesn't re-render
              on every keystroke/timer-tick. */}
          <NumPad onPress={handlePress} accentColor={di.color} />
        </div>
      </div>

      {/* PAUSE OVERLAY */}
      {paused && !resuming && phase === "play" && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/65"
          style={{ animation: "pop-in 0.18s ease-out both" }}
        >
          <div className="clip-panel relative w-[min(92vw,560px)] border border-cyan-400/40 bg-black/75 p-6 backdrop-blur-xl md:p-8">
            <span className="absolute left-2 top-2 h-3 w-3 border-l border-t border-cyan-300/80" />
            <span className="absolute right-2 top-2 h-3 w-3 border-r border-t border-cyan-300/80" />
            <span className="absolute bottom-2 left-2 h-3 w-3 border-b border-l border-cyan-300/80" />
            <span className="absolute bottom-2 right-2 h-3 w-3 border-b border-r border-cyan-300/80" />

            <div className="mb-1 font-mono2 text-[10px] tracking-[0.4em] text-cyan-300/70">SYSTEM // PAUSE</div>
            <h2
              className="glitch font-display text-4xl font-black tracking-[0.2em] text-white neon md:text-5xl"
              data-text="PAUSED"
            >
              PAUSED
            </h2>
            <div className="mt-1 font-mono2 text-[10px] tracking-widest text-white/35">
              {di.label} × {mi.label} · SCORE {String(score).padStart(3, "0")} · {mm}:{String(ss).padStart(2, "0")}
            </div>
            <div
              className={`mt-1 font-mono2 text-[10px] tracking-widest ${
                pausesLeft <= 0 ? "text-rose-300/80" : "text-cyan-300/60"
              }`}
            >
              ポーズ残り {pausesLeft} / {MAX_PAUSES}
              {pausesLeft <= 0 && <span className="ml-1.5 text-rose-300/80">（次はできません）</span>}
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <button
                autoFocus
                onClick={() => {
                  sfxSelect();
                  startResume();
                }}
                className="clip-btn group relative overflow-hidden px-5 py-3 text-left transition-transform active:scale-95"
                style={{
                  background: `linear-gradient(100deg, ${di.accent}0.32), rgba(0,0,0,0.4))`,
                  border: `1px solid ${di.color}`,
                  boxShadow: `0 0 26px ${di.accent}0.45)`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-xl font-black tracking-[0.2em] text-white">続ける</span>
                  <span className="font-mono2 text-[10px] tracking-widest text-white/60">ENTER</span>
                </div>
              </button>

              <button
                onClick={() => {
                  sfxSelect();
                  onRetry();
                }}
                className="clip-btn px-5 py-3 text-left transition-colors hover:bg-white/5"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.18)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg font-black tracking-[0.2em] text-white/85">やり直し</span>
                  <span className="font-mono2 text-[10px] tracking-widest text-white/45">R</span>
                </div>
              </button>

              <button
                onClick={() => {
                  sfxSelect();
                  onTitle();
                }}
                className="clip-btn px-5 py-3 text-left transition-colors hover:bg-rose-500/10"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,90,110,0.3)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg font-black tracking-[0.2em] text-rose-300">タイトルへ</span>
                  <span className="font-mono2 text-[10px] tracking-widest text-rose-200/60">T</span>
                </div>
              </button>
            </div>

            <div className="mt-3 font-mono2 text-[10px] tracking-[0.25em] text-white/30">
              [ ENTER ] 続ける&nbsp;&nbsp;·&nbsp;&nbsp;[ R ] やり直し&nbsp;&nbsp;·&nbsp;&nbsp;[ T ] タイトル
            </div>
          </div>
        </div>
      )}

      {/* RESUME 3-2-1 countdown */}
      {resuming && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-black/25">
          <div className="absolute h-[42vmin] w-[42vmin] rounded-full border border-cyan-300/30 countdown-halo" />
          <div className="absolute h-[32vmin] w-[32vmin] rounded-full border border-fuchsia-300/25 countdown-halo" style={{ animationDelay: "0.12s" }} />
          <div
            key={resumeCount}
            className="countdown-clear font-display text-[22vw] font-black text-white neon md:text-[180px]"
          >
            {resumeCount > 0 ? resumeCount : "GO"}
          </div>
        </div>
      )}
    </div>
  );
}
