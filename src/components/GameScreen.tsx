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

// Split out and memoized so this whole block only re-renders when its own
// props (accentColor) actually change -- not on every keystroke, timer tick,
// or any other GameScreen state update.
//
// ---------------------------------------------------------------------------
// Why this is built the way it is (read before touching it)
// ---------------------------------------------------------------------------
// The old version attached an `onPointerDown` to each individual <button>.
// That is the textbook "fast" approach, but it still leaves two ways for a
// press to be lost, both of which players describe identically ("I mashed the
// keys and nothing happened / ENTER stopped working"):
//
//   1. Hit-testing. A press only counts if it lands inside that button's own
//      box. The keys are ~40x60px separated by 6px gutters, plus the cut
//      corners from `.clip-chip` (clip-path clips hit-testing too) and the
//      safe-area gap at the bottom. Typing fast with thumbs, a real fraction
//      of presses land in those dead slivers and simply vanish.
//   2. Gesture/focus interference. Every press had to re-earn the browser's
//      permission to be a press (focus moves, :active, double-tap detection,
//      scroll gestures). Anything that made the browser re-interpret the
//      touch as a gesture turned the press into a pointercancel.
//
// So the pad is no longer 12 independent buttons. It is ONE surface with a
// single native `pointerdown` listener attached to its container (not via
// React, so nothing about React's render/commit timing can ever sit between
// the touch and the handler). Each press is resolved by nearest-key distance
// in viewport coordinates:
//   - a press squarely on a key resolves to that key (distance 0, no remap);
//   - a press in a gutter between keys, or a few px past the pad edge,
//     resolves to the closest key instead of falling into a hole;
//   - a press far away from everything (more than PAD_HIT_SLOP) is ignored,
//     so this never invents input.
// `preventDefault()` on the same event stops the browser from following the
// press with a focus change, text selection, synthetic click, or gesture --
// which is what made one press interfere with the next one.
//
// Visual feedback does not depend on `:active` either (preventDefault can
// suppress it): a short-lived `.pad-hit` class is applied straight to the DOM
// inside the same handler, so the key always lights up on the press itself.
//
// Only ONE event path is ever bound (pointerdown when the browser supports
// pointer events, touchstart+mousedown otherwise), so a press can never be
// counted twice -- double-firing digits would be worse than dropping them.
const PAD_HIT_SLOP = 22; // px: how far outside a key a press still counts

const NumPad = memo(function NumPad({ onPress, accentColor }: { onPress: (k: string) => void; accentColor: string }) {
  const padRef = useRef<HTMLDivElement>(null);
  // The listeners below are attached once. Routing through a ref keeps them
  // calling the *newest* handler without ever re-binding (or re-rendering).
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    const root = padRef.current;
    if (!root) return;

    type Box = { k: string; l: number; t: number; r: number; b: number };
    let boxes: Box[] = [];
    let dirty = true;

    const measure = () => {
      boxes = [];
      root.querySelectorAll<HTMLElement>("[data-key]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        boxes.push({ k: el.dataset.key as string, l: r.left, t: r.top, r: r.right, b: r.bottom });
      });
      dirty = false;
    };
    // Key geometry only changes on resize/rotation/zoom; re-measuring 12 rects
    // on every single press would be pointless forced layout work.
    const invalidate = () => {
      dirty = true;
    };

    const hitTest = (x: number, y: number): string | null => {
      if (dirty || boxes.length === 0) measure();
      let best: string | null = null;
      let bestD = Infinity;
      for (const q of boxes) {
        const dx = x < q.l ? q.l - x : x > q.r ? x - q.r : 0;
        const dy = y < q.t ? q.t - y : y > q.b ? y - q.b : 0;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = q.k;
          if (d === 0) break;
        }
      }
      return best !== null && bestD <= PAD_HIT_SLOP * PAD_HIT_SLOP ? best : null;
    };

    const flashTimers = new Map<string, number>();
    const flash = (k: string) => {
      const el = root.querySelector<HTMLElement>(`[data-key="${k}"]`);
      if (!el) return;
      const prev = flashTimers.get(k);
      if (prev !== undefined) window.clearTimeout(prev);
      el.classList.add("pad-hit");
      flashTimers.set(
        k,
        window.setTimeout(() => {
          el.classList.remove("pad-hit");
          flashTimers.delete(k);
        }, 120),
      );
    };

    const press = (x: number, y: number) => {
      const k = hitTest(x, y);
      if (k === null) return;
      flash(k);
      onPressRef.current(k);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      press(e.clientX, e.clientY);
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        press(t.clientX, t.clientY);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      press(e.clientX, e.clientY);
    };
    const onContextMenu = (e: Event) => e.preventDefault();

    const hasPointer = typeof window !== "undefined" && "PointerEvent" in window;
    if (hasPointer) {
      root.addEventListener("pointerdown", onPointerDown, { passive: false });
    } else {
      root.addEventListener("touchstart", onTouchStart, { passive: false });
      root.addEventListener("mousedown", onMouseDown);
    }
    root.addEventListener("contextmenu", onContextMenu);

    window.addEventListener("resize", invalidate);
    window.addEventListener("orientationchange", invalidate);
    window.addEventListener("scroll", invalidate, true);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(invalidate);
      ro.observe(root);
    }

    return () => {
      if (hasPointer) root.removeEventListener("pointerdown", onPointerDown);
      else {
        root.removeEventListener("touchstart", onTouchStart);
        root.removeEventListener("mousedown", onMouseDown);
      }
      root.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("orientationchange", invalidate);
      window.removeEventListener("scroll", invalidate, true);
      ro?.disconnect();
      flashTimers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <div ref={padRef} className="mt-2 select-none md:hidden" style={{ touchAction: "none" }}>
      <div className="grid grid-cols-5 gap-1.5">
        {PAD_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            data-key={k}
            tabIndex={-1}
            aria-label={k}
            className="pad-key relative flex select-none items-center justify-center"
          >
            <span aria-hidden="true" className="pad-face clip-chip absolute inset-0 border border-cyan-400/30 bg-white/5" />
            <span className="pointer-events-none relative z-10 font-display text-xl font-black text-cyan-100">{k}</span>
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          data-key="DEL"
          tabIndex={-1}
          aria-label="削除"
          title="削除"
          className="pad-key relative flex select-none items-center justify-center text-white/75"
        >
          <span
            aria-hidden="true"
            className="pad-face pad-face-dim clip-chip absolute inset-0 border border-white/25 bg-white/5"
          />
          <svg className="pointer-events-none relative z-10" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
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
          type="button"
          data-key="ENT"
          tabIndex={-1}
          aria-label="決定"
          className="pad-key relative flex select-none items-center justify-center"
        >
          <span
            aria-hidden="true"
            className="pad-face pad-face-accent clip-chip absolute inset-0"
            style={{ background: accentColor, boxShadow: `0 0 20px ${accentColor}` }}
          />
          <span className="pointer-events-none relative z-10 font-display text-lg font-black text-black">⏎ ENTER</span>
        </button>
      </div>
    </div>
  );
});

// Precomputed once per correct-answer burst (see `triggerFx`), not per
// render -- see the long comment on `triggerFx` for why this matters.
type Spark = { dx: number; dy: number; colorIndex: number };
type Fx = { key: number; kind: "correct" | "error"; gain: number; sparks?: Spark[] } | null;

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
  // Non-zero while the "GO" burst is on screen. It is painted by a
  // pointer-events-none layer in its own right, precisely so that it can never
  // block input the way the real countdown overlay does (see the countdown
  // effect for why that mattered).
  const [goAt, setGoAt] = useState(0);
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
  // ---- Race-free state mirrors -------------------------------------------
  // `pressKeyRef`/`handlePress` (further below) exist so a fast next tap
  // always calls the *newest* pressKey/submit closure, no matter how often
  // NumPad itself re-renders. That solves half the problem: it guarantees
  // the *function* is current. It does NOT guarantee the *values that
  // function closes over* (problem/input/factors) are current, because
  // those only update when React actually commits a re-render -- and a
  // re-render is not instant. If the player answers correctly and
  // immediately mashes the next key (or types several digits and hits
  // ENTER within the same frame), a new pressKey closure carrying the new
  // state may not have been assigned into the ref yet, so the key press
  // gets processed against stale data -- a digit gets silently dropped from
  // the value ENTER actually submits, or a DEL is misrouted between
  // "erase a digit" and "pop a factor chip". This is exactly the failure
  // mode described in the comments above (mashing a digit, or alternating
  // digit/ENTER quickly).
  //
  // The fix: mirror the pieces of state that change during fast play
  // (problem, input, factors) into refs that are written the instant a
  // change happens -- synchronously, in the same call that requests the
  // state update, not after React gets around to rendering. Any logic that
  // needs to react *instantly and correctly* to input (submit(), pressKey's
  // DEL branch) reads from these refs. JSX keeps reading the React state
  // variables directly, since rendering is allowed to lag a frame or two --
  // it's only the decision logic that can't.
  const problemRef = useRef(problem);
  const updateProblem = (next: Problem | ((p: Problem) => Problem)) => {
    const value = typeof next === "function" ? (next as (p: Problem) => Problem)(problemRef.current) : next;
    problemRef.current = value;
    setProblem(value);
  };

  // The typed value lives ONLY here (plus whatever node is displaying it)
  // -- deliberately NOT in React state. `updateInput` runs on every single
  // keystroke, and when this was `useState` rendered into a controlled
  // `value={input}`, each keystroke re-rendered the ENTIRE game screen (HUD,
  // problem panel, fx layers, the works) on the main thread, right in the
  // middle of the player's fastest tap bursts. Nothing on screen needs a
  // React render when a digit changes -- the value is displayed in exactly
  // one place -- so it is echoed straight into the DOM: same trick the
  // sub-second timer display uses. Game logic (submit, DEL) reads
  // `inputValRef` and never trusted state anyway.
  // Net effect: digit taps and DEL cause ZERO React re-renders.
  //
  // The display node itself differs by device (see the answer bar):
  //   - desktop (>= 768px): a real <input>, so a physical keyboard works
  //     natively with a normal caret.
  //   - phone: a plain <div>. There is NO focusable element in the mobile
  //     game screen at all, which is what makes it impossible for the virtual
  //     keyboard to flash/slide up and back down when a run starts, and
  //     impossible for focus handling to interfere with a tap.
  const inputValRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const paintInput = (value: string) => {
    const input = inputRef.current;
    if (input) {
      if (input.value !== value) input.value = value;
      return;
    }
    const display = displayRef.current;
    if (display && display.textContent !== value) display.textContent = value;
  };
  const updateInput = (next: string | ((v: string) => string)) => {
    const value = typeof next === "function" ? (next as (v: string) => string)(inputValRef.current) : next;
    inputValRef.current = value;
    paintInput(value);
  };

  const [factors, setFactors] = useState<number[]>([]);
  const factorsValRef = useRef<number[]>([]);
  const updateFactors = (next: number[] | ((f: number[]) => number[])) => {
    const value = typeof next === "function" ? (next as (f: number[]) => number[])(factorsValRef.current) : next;
    factorsValRef.current = value;
    setFactors(value);
  };
  // -------------------------------------------------------------------------

  const [msg, setMsg] = useState<{ text: string; tone: "info" | "warn" } | null>(null);
  const msgRef = useRef<{ text: string; tone: "info" | "warn" } | null>(null);
  // Showing the same message again is a no-op: mashing ENTER on an empty field
  // (or missing twice with the same number) must not queue up a React render
  // per press -- that render is exactly what would delay the next tap.
  const setMessage = (next: { text: string; tone: "info" | "warn" } | null) => {
    const cur = msgRef.current;
    if (cur === next) return;
    if (cur && next && cur.text === next.text && cur.tone === next.tone) return;
    msgRef.current = next;
    setMsg(next);
  };
  const [fx, setFx] = useState<Fx>(null);
  const [popups, setPopups] = useState<{ id: number; text: string }[]>([]);
  const [paused, setPaused] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeCount, setResumeCount] = useState(3);
  // ポーズは1プレイにつき MAX_PAUSES 回まで。使い切ったら ESC / PAUSE ボタン
  // どちらからの要求も無視し、代わりに警告メッセージを出す。
  const [pausesLeft, setPausesLeft] = useState(MAX_PAUSES);

  // The counters exist twice on purpose. The refs are authoritative and are
  // written synchronously inside the event that changes them; the state copies
  // only exist to be rendered. Reading a counter from state is not safe during
  // fast play: a digit that completes a factor problem and the ENTER for the
  // next one can both be handled before React has committed the previous
  // render, and a state-based counter would then silently lose one of them
  // (also why finish() reads the refs, not the rendered values).
  const [solved, setSolved] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [misses, setMisses] = useState(0);
  const solvedRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const missesRef = useRef(0);
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
  const fxKey = useRef(0);
  const popId = useRef(0);

  // Width (not "is it a touch device") is the switch, because it matches the
  // CSS exactly: the on-screen number pad is `md:hidden`, so below 768px the
  // pad exists and the native <input> must not. Above it there is no pad, so
  // the <input> is the only way to answer and keeps normal physical-keyboard
  // behaviour.
  //
  // Crucially, the phone side has NO focusable element at all (the answer
  // field is a plain <div>, see the answer bar) rather than the readOnly
  // <input> it used to be. A readOnly input is still focusable, so autoFocus
  // on mount still asked the OS for the virtual keyboard -- on several
  // Android browsers/webviews that request is visible as the keyboard sliding
  // up and immediately back down right as a run starts (and on iOS the
  // scroll-into-view for that focus nudges the whole layout). Removing the
  // element removes the entire class of problem instead of suppressing it.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // The display node is a different element (and a different DOM subtree)
  // after a phone/desktop switch or a rotation, so re-echo the current value
  // into whichever one is now mounted.
  useEffect(() => {
    paintInput(inputValRef.current);
  }, [isDesktop]);

  const danger = secondsLeft <= 30;
  const critical = secondsLeft <= 10;
  // A run is being played right now (used for HUD visibility only -- the input
  // path checks the same conditions itself, from refs).
  const playable = phase === "play" && !paused && !resuming;
  const score = solved * di.points;
  // Display-only. Logic that must react instantly to the latest factors
  // (submit()) recomputes this itself from `factorsValRef.current` instead
  // of trusting this memo, which is only guaranteed current as of the last
  // completed render.
  const product = useMemo(() => factors.reduce((a, b) => a * b, 1), [factors]);

  /* ---------- countdown ---------- */
  // Note the side effects are NOT inside a setState updater here. Updaters can
  // be invoked more than once (StrictMode does exactly that in development),
  // which previously meant the "GO" sound and the phase flip could fire twice.
  // A chain of plain timeouts is deterministic and fully cancellable.
  useEffect(() => {
    if (phase !== "countdown") return;
    sfxUI();
    const timers: number[] = [];
    const step = (v: number) => {
      setCount(v);
      if (v > 1) {
        timers.push(
          window.setTimeout(() => {
            sfxUI();
            step(v - 1);
          }, 1000),
        );
        return;
      }
      timers.push(
        window.setTimeout(() => {
          sfxWarn();
          // Play starts on the same frame "GO" appears. The old code kept the
          // countdown overlay -- `absolute inset-0`, so it swallows every tap
          // -- mounted for another 750ms after GO, and submit() additionally
          // refuses to run unless phase === "play". Anything pressed in that
          // window vanished with zero feedback: this is the "I typed fast and
          // ENTER just did nothing" report. GO now paints in its own
          // pointer-events-none layer, so the first tap after GO counts.
          setGoAt(performance.now());
          setPhase("play");
        }, 1000),
      );
    };
    timers.push(
      window.setTimeout(() => {
        sfxUI();
        step(2);
      }, 1000),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [phase]);

  // "GO" is decoration only -- it disappears on its own and never blocks input.
  useEffect(() => {
    if (!goAt) return;
    const id = window.setTimeout(() => setGoAt(0), 700);
    return () => window.clearTimeout(id);
  }, [goAt]);

  /* ---------- timer (suspend when paused/resuming) ---------- */
  useEffect(() => {
    if (phase !== "play") return;
    if (paused || resuming) return;
    if (bgmEnabled) setMusicMode(Math.ceil(remainRef.current / 1000) <= 30 ? "danger" : "battle");
    endRef.current = performance.now() + remainRef.current;
    // Desktop only: on phones there is no <input> to focus (and focusing one
    // is what used to summon/close the virtual keyboard mid-run).
    if (window.matchMedia("(min-width: 768px)").matches) inputRef.current?.focus();
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
          setMessage({ text: "WARNING // 残り30秒", tone: "warn" });
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
    // Authoritative counters (see the "counters exist twice" note above): the
    // rendered values can legitimately be one answer behind at the buzzer.
    const finalSolved = solvedRef.current;
    const finalMisses = missesRef.current;
    const finalMaxCombo = maxComboRef.current;
    sfxTimeUp();
    stopMusic(0.8);
    onFinish({
      difficulty,
      mode,
      solved: finalSolved,
      score: finalSolved * DIFF_INFO[difficulty].points,
      misses: finalMisses,
      maxCombo: finalMaxCombo,
      byKind: { ...byKind.current },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty, mode, onFinish]);

  const finishRef = useRef(finish);
  finishRef.current = finish;

  // ポーズ要求の唯一の入口。ESC キーとモバイルの PAUSE ボタン、両方からここを
  // 通す。残り回数が 0 のときはポーズさせず、警告音とメッセージだけ出す。
  const requestPause = () => {
    if (paused || resuming || doneRef.current) return;
    if (pausesLeft <= 0) {
      sfxError();
      setMessage({ text: `ポーズ回数の上限（${MAX_PAUSES}回）に達しました`, tone: "warn" });
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
      if (paused) {
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
        return;
      }
      if (resuming) return;
      // Phones have no answer <input> at all (see the answer bar), so a
      // Bluetooth/USB keyboard would otherwise type into nothing. Handling it
      // here keeps the physical-keyboard path working on every device without
      // reintroducing a focusable element. On desktop the <input>'s own
      // handler below does this, so these two can never both fire.
      if (!isDesktop) {
        if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          pressKeyRef.current(e.key);
        } else if (e.key === "Enter") {
          e.preventDefault();
          pressKeyRef.current("ENT");
        } else if (e.key === "Backspace") {
          e.preventDefault();
          pressKeyRef.current("DEL");
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, resuming, pausesLeft, isDesktop, onRetry, onTitle]);

  const triggerFx = (kind: "correct" | "error", gain = 0) => {
    fxKey.current += 1;
    // Spark/ring offsets are rolled ONCE, right here, at the moment the
    // burst fires -- not inline in JSX. The previous version computed
    // Math.random() positions inside the render body, which meant every
    // unrelated re-render that happened to occur while `fx` was still
    // truthy (i.e. during the ~900ms the burst animation plays) re-rolled
    // fresh positions and pushed new inline styles onto all 8 spark
    // elements + 2 rings, for zero visible benefit -- the burst is only
    // ever supposed to be decided once. Since a keystroke re-render happens
    // on literally every digit the player types, and correct answers are
    // exactly when players are typing fastest (mid-combo), this was real,
    // avoidable main-thread work landing at the worst possible moment.
    // Precomputing once and storing the result on the fx object itself
    // means render only ever reads plain data, no RNG, no matter how many
    // times it re-runs before the burst finishes.
    const sparks =
      kind === "correct" && !lightweight
        ? Array.from({ length: 8 }).map((_, i) => {
            const a = (i / 8) * Math.PI * 2 + Math.random();
            const d = 160 + Math.random() * 220;
            return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, colorIndex: i % 2 };
          })
        : undefined;
    setFx({ key: fxKey.current, kind, gain, sparks });
  };

  const nextProblem = () => {
    updateProblem((p) => generateProblem(difficulty, mode, p.kind));
    updateInput("");
    updateFactors([]);
    setMessage(null);
  };

  const onCorrect = () => {
    // Refs first (synchronously authoritative), state mirrors second. Two
    // correct answers can land in the same tick -- a digit that completes a
    // factor problem followed immediately by ENTER for the next one -- and a
    // counter read from state would silently lose one of them.
    const c = comboRef.current + 1;
    comboRef.current = c;
    if (c > maxComboRef.current) maxComboRef.current = c;
    solvedRef.current += 1;
    byKind.current[problemRef.current.kind] += 1;

    setCombo(c);
    setMaxCombo(maxComboRef.current);
    setSolved(solvedRef.current);
    nextProblem();

    sfxCorrect(c);
    // The decorative burst (full-screen flash + rings + 8 sparks) and the
    // "+points" popup go out in a separate task, after the logical state is
    // already correct. They are by far the most expensive thing that happens
    // on a solve and they land precisely when the player is already mashing
    // the next answer, so they must not be built in the same task that
    // handles the tap which produced them.
    window.setTimeout(() => {
      triggerFx("correct", di.points);
      popId.current += 1;
      const id = popId.current;
      setPopups((p) => [...p, { id, text: `+${di.points}` }]);
      window.setTimeout(() => setPopups((p) => p.filter((x) => x.id !== id)), 900);
    }, 0);
  };

  const onMiss = (text: string) => {
    comboRef.current = 0;
    missesRef.current += 1;
    setCombo(0);
    setMisses(missesRef.current);
    sfxError();
    triggerFx("error");
    setMessage({ text, tone: "warn" });
  };

  const answerBarRef = useRef<HTMLDivElement>(null);
  // "Nothing happened" is indistinguishable from "the app is broken". Used
  // when ENTER is pressed with an empty answer, so a press always has a
  // visible consequence.
  const nudgeAnswerBar = () => {
    const el = answerBarRef.current;
    if (!el) return;
    el.classList.remove("answer-bar-nudge");
    void el.offsetWidth; // restart the animation even on back-to-back presses
    el.classList.add("answer-bar-nudge");
  };

  const submit = () => {
    if (phase !== "play" || paused || resuming || doneRef.current) return;
    // Read everything from the live refs, not from `problem`/`input`/
    // `factors` state -- those only reflect whatever React last rendered,
    // which can be one or more keystrokes behind if this fires right after
    // a fast preceding key press (see the long comment above the ref
    // declarations for why). The refs are always exactly current.
    const p = problemRef.current;
    const raw = inputValRef.current.trim();

    if (raw === "") {
      // Factor mode with primes already banked: there is genuinely nothing to
      // submit (the chips are the answer), so stay quiet. Everywhere else,
      // answer the press instead of swallowing it.
      if (p.kind === "factor" && factorsValRef.current.length > 0) return;
      nudgeAnswerBar();
      sfxWarn();
      setMessage({ text: "数字を入力してから ENTER", tone: "info" });
      return;
    }

    if (p.kind !== "factor") {
      const val = Number(raw);
      if (Number.isNaN(val)) return;
      if (val === p.answer) onCorrect();
      else {
        onMiss(`MISS // ${raw} は違う`);
        updateInput("");
      }
      return;
    }

    const n = Number(raw);
    if (!Number.isInteger(n) || n < 2) {
      onMiss("2以上の素数を入力してください");
      updateInput("");
      return;
    }
    if (!isPrime(n)) {
      onMiss(`${n} は素数ではありません / 素数のみ入力できます`);
      updateInput("");
      return;
    }
    const currentFactors = factorsValRef.current;
    const currentProduct = currentFactors.reduce((a, b) => a * b, 1);
    const rest = p.target / currentProduct;
    if (rest % n !== 0) {
      onMiss(`${n} は ${p.target} の素因数ではありません`);
      updateInput("");
      return;
    }
    const nf = [...currentFactors, n].sort((a, b) => a - b);
    updateFactors(nf);
    updateInput("");
    const prod = nf.reduce((a, b) => a * b, 1);
    if (prod === p.target) {
      // Advance immediately. The old 90ms delay existed only so the last chip
      // could be admired -- but during that window the problem was still
      // "live", so a second ENTER could bank another factor and complete the
      // same problem twice (double score, and a phantom extra solve).
      onCorrect();
    } else {
      sfxFactorAdd(nf.length);
      setMessage(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Backspace") {
      if (inputValRef.current === "" && problemRef.current.kind === "factor" && factorsValRef.current.length > 0) {
        e.preventDefault();
        updateFactors((f) => f.slice(0, -1));
        sfxDelete();
        setMessage(null);
      }
    }
  };

  const pressKey = (k: string) => {
    // Nothing is accepted until the run has actually started, so phantom
    // presses before/at GO can never pre-fill the answer box.
    if (phase !== "play" || paused || resuming || doneRef.current) return;
    if (k === "ENT") {
      submit();
      return;
    }
    if (k === "DEL") {
      if (inputValRef.current === "") {
        if (problemRef.current.kind === "factor" && factorsValRef.current.length > 0) {
          updateFactors((f) => f.slice(0, -1));
          sfxDelete();
          setMessage(null);
        }
      } else {
        updateInput((v) => v.slice(0, -1));
        sfxDelete();
      }
      return;
    }
    updateInput((v) => (v.length < 9 ? v + k : v));
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
    const step = (v: number) => {
      setResumeCount(v);
      if (v > 1) {
        window.setTimeout(() => {
          sfxUI();
          step(v - 1);
        }, 1000);
        return;
      }
      // Input is live again on the same frame "GO" appears -- no extra 750ms
      // of dead keys the way it used to be.
      window.setTimeout(() => {
        sfxWarn();
        setGoAt(performance.now());
        setResuming(false);
        setPaused(false);
        lastSecRef.current = 999;
      }, 1000);
    };
    window.setTimeout(() => {
      sfxUI();
      step(2);
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
                  typing fastest. Skip them in lightweight mode. Offsets come
                  from `fx.sparks`, precomputed once in `triggerFx` (see the
                  comment there) instead of being rolled again on every
                  re-render this burst happens to overlap with. */}
              {!lightweight && (
                <>
                  <div className="ring-burst absolute h-64 w-64 rounded-full border-cyan-300" style={{ borderStyle: "solid", borderWidth: "3px" }} />
                  <div className="ring-burst absolute h-64 w-64 rounded-full border-fuchsia-400" style={{ borderStyle: "solid", borderWidth: "3px", animationDelay: "0.08s" }} />
                  {fx.sparks?.map((s, i) => (
                    <span
                      key={i}
                      className="spark absolute h-1.5 w-1.5 rounded-full"
                      style={
                        {
                          background: s.colorIndex ? "#22e4ff" : "#ff2bd1",
                          boxShadow: "0 0 12px currentColor",
                          "--dx": `${s.dx}px`,
                          "--dy": `${s.dy}px`,
                        } as React.CSSProperties
                      }
                    />
                  ))}
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

      {/* 3-2-1 countdown. This overlay is intentionally tap-blocking: the run
          has not started yet, so accepting input here would pre-fill a stale
          answer. */}
      {phase === "countdown" && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75">
          <div className="absolute h-[42vmin] w-[42vmin] rounded-full border border-cyan-300/30 countdown-halo" />
          <div className="absolute h-[32vmin] w-[32vmin] rounded-full border border-fuchsia-300/25 countdown-halo" style={{ animationDelay: "0.12s" }} />
          <div
            key={count}
            className="countdown-clear font-display text-[22vw] font-black text-white neon md:text-[180px]"
          >
            {count}
          </div>
        </div>
      )}

      {/* GO. Play has already started underneath this, and the layer is
          pointer-events-none, so the very first tap after GO counts -- the
          old 750ms blocked window after GO is gone. */}
      {goAt !== 0 && (
        <div key={goAt} className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="absolute h-[42vmin] w-[42vmin] rounded-full border border-cyan-300/30 countdown-halo" />
          <div className="absolute h-[32vmin] w-[32vmin] rounded-full border border-fuchsia-300/25 countdown-halo" style={{ animationDelay: "0.12s" }} />
          <div className="countdown-clear font-display text-[22vw] font-black text-white neon md:text-[180px]">GO</div>
        </div>
      )}

      {/* GAME UI (desaturates when paused). Top/bottom padding honors the
          device safe-area insets (needs viewport-fit=cover in index.html):
          without it the bottom number-pad row sits inside the iPhone home-
          indicator swipe zone (and Android gesture bar), where taps get
          pre-empted by the OS gesture instead of reaching the button --
          another way "bottom keys don't respond" happened on phones.
          max() keeps exactly the old 0.75rem where no insets exist. */}
      <div
        className="relative z-10 flex h-full w-full flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] md:px-8 md:py-5"
        style={{
          filter: `saturate(${saturation})`,
          transform: `scale(${paused ? 0.99 : 1})`,
          transition: "filter 0.4s ease, transform 0.4s ease",
        }}
      >
        {/* HUD -- two fixed-height rows.
            The previous HUD was one `justify-between` row of three columns
            whose natural widths (a 7.2ch timer, a w-40 progress bar, three
            chips, SCORE, SOLVED/COMBO) add up to far more than a phone's
            width, and the chips row was `flex-wrap`. So it wrapped to a second
            line at unpredictable moments -- notably the instant a run starts,
            when the PAUSE chip first appears. That extra line made the column
            taller than the screen, which pushed everything below it down and
            off the bottom edge: the "the keypad drops the moment I start"
            report. This version is sized to fit: two rows, never wrapping, and
            the pause slot is always reserved (invisible before play) so the
            HUD's height is identical during the countdown and during play. */}
        <div className="flex flex-col gap-1.5 md:gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden md:gap-2">
              {/* Mobile pause button: ESC has no touch equivalent, so this
                  gives phone players a reachable, always-visible way to pause.
                  Placed at the top, away from the number pad. Icon is drawn
                  with CSS bars (not an emoji) to match the HUD style. */}
              <button
                onClick={() => {
                  if (pausesLeft > 0) sfxSelect();
                  requestPause();
                }}
                aria-label="ポーズ"
                title={`ポーズ（残り${pausesLeft}回）`}
                className={`clip-chip inline-flex shrink-0 items-center gap-1 border border-white/25 bg-black/50 px-2 py-1 font-display text-[10px] font-black tracking-[0.15em] text-white/80 active:bg-white/15 md:hidden ${
                  playable ? "" : "invisible"
                } ${pausesLeft <= 0 ? "opacity-40" : ""}`}
              >
                <span className="flex items-center gap-[3px]" aria-hidden="true">
                  <span className="h-3 w-[3px] bg-current" />
                  <span className="h-3 w-[3px] bg-current" />
                </span>
                PAUSE
                <span className="font-mono2 text-[9px] tracking-normal text-white/50">×{pausesLeft}</span>
              </button>
              <div
                className="clip-chip inline-flex shrink-0 items-center gap-1.5 px-2 py-1 md:gap-2 md:px-3"
                style={{ background: `${di.accent}0.14)`, border: `1px solid ${di.color}66` }}
              >
                <span className="h-1.5 w-1.5 rotate-45" style={{ background: di.color }} />
                <span className="font-display text-[11px] font-black tracking-[0.18em] md:text-xs md:tracking-[0.25em]" style={{ color: di.color }}>
                  {di.label}
                </span>
                <span className="font-mono2 text-[9px] text-white/45 md:text-[10px]">×{di.points}</span>
              </div>
              <div
                className="clip-chip inline-flex shrink-0 items-center gap-1.5 px-2 py-1 md:gap-2 md:px-3"
                style={{ background: `${mi.accent}0.14)`, border: `1px solid ${mi.color}66` }}
              >
                <span className="h-1.5 w-1.5 rotate-45" style={{ background: mi.color }} />
                <span className="font-display text-[10px] font-black tracking-[0.18em] md:text-[11px] md:tracking-[0.25em]" style={{ color: mi.color }}>
                  {mi.label}
                </span>
              </div>
            </div>

            {/* Desktop keeps SOLVED / COMBO in the top-right corner. On phones
                they live under SCORE instead (see below) so the top row can
                never overflow. */}
            <div className="hidden shrink-0 items-end gap-4 md:flex">
              <div className="text-right">
                <div className="font-mono2 text-[10px] tracking-[0.35em] text-cyan-300/60">SOLVED</div>
                <div className="font-display text-4xl font-black leading-none text-white">{solved}</div>
              </div>
              <div className="text-right">
                <div className="font-mono2 text-[10px] tracking-[0.35em] text-fuchsia-300/60">COMBO</div>
                <div
                  className="font-display text-3xl font-black leading-none"
                  style={{ color: combo >= 3 ? "#ff2bd1" : "rgba(255,255,255,0.5)", textShadow: combo >= 3 ? "0 0 16px #ff2bd1" : "none" }}
                >
                  ×{combo}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-2">
            <div className="relative min-w-0">
              <div className="font-mono2 text-[9px] tracking-[0.3em] text-cyan-300/60 md:text-[10px] md:tracking-[0.35em]">SCORE</div>
              <div className="font-display text-3xl font-black leading-none text-white neon md:text-6xl">
                {String(score).padStart(score >= 1000 ? 4 : 3, "0")}
              </div>
              {/* Phone-only: SOLVED + COMBO as one compact line directly under
                  the score. Zero horizontal pressure, so nothing here can push
                  the timer off-screen. */}
              <div className="mt-1 flex items-baseline gap-1.5 md:hidden">
                <span className="font-mono2 text-[9px] tracking-[0.12em] text-cyan-300/50">SOLVED</span>
                <span className="font-display text-base font-black leading-none text-white">{solved}</span>
                <span className="ml-1 font-mono2 text-[9px] tracking-[0.12em] text-fuchsia-300/50">COMBO</span>
                <span
                  className="font-display text-base font-black leading-none"
                  style={{ color: combo >= 3 ? "#ff2bd1" : "rgba(255,255,255,0.5)" }}
                >
                  ×{combo}
                </span>
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

            <div className="flex shrink-0 flex-col items-end">
              <div
                className="font-mono2 text-[9px] tracking-[0.28em] md:text-[10px] md:tracking-[0.4em]"
                style={{ color: danger ? "#ff8095" : "rgba(103,232,249,0.6)" }}
              >
                <span className="md:hidden">TIME</span>
                <span className="hidden md:inline">TIME REMAINING</span>
              </div>
              <div
                ref={bigTimeRef}
                className={`font-display text-4xl font-black leading-none tabular-nums transition-colors duration-300 md:text-7xl ${
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
                  // changed, and because it sits opposite SCORE in the HUD,
                  // that flicker was also nudging it left-right. Pinning this
                  // box to a fixed width (generous enough for the widest
                  // possible "M:SS.CC") stops it from ever resizing, so
                  // nothing here or beside it can jitter, regardless of the
                  // font's actual glyph metrics.
                  width: "7.2ch",
                  textAlign: "center",
                }}
              >
                {mm}:{String(ss).padStart(2, "0")}
                <span ref={csRef} className="text-xl md:text-3xl" style={{ fontVariantNumeric: "tabular-nums" }}>
                  .00
                </span>
              </div>
              <div className="mt-1 h-1.5 w-28 overflow-hidden bg-white/10 md:w-72">
                <div
                  ref={progressBarRef}
                  className="h-full transition-[width] duration-100"
                  style={{ width: "100%", background: `linear-gradient(90deg, ${timeColor}, #fff)`, boxShadow: `0 0 14px ${timeColor}` }}
                />
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
            className="slide-swap clip-panel relative w-full max-w-4xl border bg-black/55 px-5 py-6 md:px-10 md:py-9 md:backdrop-blur-md"
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

        {/* ANSWER AREA -- footer block glued to the bottom, outside the
            flex-1 problem area above. Every child in here has a FIXED
            height: nothing in this footer may ever grow or shrink, because
            any change pushes the number pad up/down under the player's
            finger mid-tap (the "keys keep moving / first digit shoved the
            pad down" complaint). The flex-1 problem panel above absorbs all
            screen-height differences instead. */}
        <div className="mx-auto w-full max-w-4xl shrink-0 pt-3 md:pt-5">
          {/* Factor chips. This row previously existed ONLY in factor mode
              and was allowed to wrap: entering the first prime swapped the
              one-line hint for taller chips (pad jumps down), each extra
              prime could wrap the row onto another line (pad jumps down
              again), and in random mode the whole row appeared/disappeared
              between problems (pad jumps by the full row height). Now: the
              row is ALWAYS rendered (empty in non-factor modes) at one
              fixed height, wrapping is forbidden, and the "/ target" tail
              is hidden on phones so a hard-mode 5-factor answer still fits
              on one line -- the pad below never moves a pixel. */}
          <div className="mb-2 h-8 overflow-hidden md:h-9">
            {problem.kind === "factor" && (
              <div className="flex h-full items-center justify-center gap-1 whitespace-nowrap md:gap-2">
                {factors.length === 0 && (
                  <span className="font-mono2 text-xs tracking-widest text-white/30">素数を1つずつ ENTER で追加</span>
                )}
                {factors.map((f, i) => (
                  <span key={`${f}-${i}`} className="flex items-center gap-1 md:gap-2">
                    {i > 0 && <span className="font-display text-sm text-cyan-300/60 md:text-lg">×</span>}
                    <span
                      className="pop-in clip-chip px-2 py-0.5 font-display text-sm font-black leading-none text-white md:px-3 md:py-1 md:text-2xl"
                      style={{ background: "rgba(34,228,255,0.16)", border: "1px solid rgba(34,228,255,0.6)", boxShadow: "0 0 18px rgba(34,228,255,0.3)" }}
                    >
                      {f}
                    </span>
                  </span>
                ))}
                {factors.length > 0 && (
                  <span className="ml-1.5 font-mono2 text-xs tracking-wider text-cyan-200/80 md:ml-2 md:text-sm">
                    = <span className="font-display text-base font-black text-cyan-300 md:text-xl">{product}</span>
                    <span className="ml-2 hidden text-white/35 md:inline">/ {problem.target}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* backdrop blur only on md+: this bar and the problem panel sit
              directly over Backdrop's continuously-animating glyph streams,
              so a backdrop-filter blur has to be re-sampled by the GPU on
              EVERY animation frame, forever -- one of the most expensive
              things on a phone, and constant background work that makes
              taps feel heavy. On the desktop GPU it's cheap, so keep the
              glass effect there; on mobile the bg-black/* fill alone looks
              nearly identical over the dark backdrop. */}
          <div
            ref={answerBarRef}
            className="answer-bar clip-btn relative flex items-center gap-2 border bg-black/60 px-3 py-2 md:gap-3 md:px-4 md:py-3 md:backdrop-blur"
            style={{ borderColor: `${di.accent}0.6)`, boxShadow: `0 0 26px ${di.accent}0.22) inset` }}
          >
            <span className="font-mono2 text-sm text-cyan-400/80">{">"}</span>
            {isDesktop ? (
              <input
                ref={inputRef}
                // Uncontrolled on purpose -- see `updateInput` above. The
                // displayed value is written straight into the DOM so a
                // keystroke never triggers a full-screen React render.
                // Desktop typing still flows through onChange below, which
                // sanitizes the text and syncs `inputValRef`; when
                // sanitization actually changes the text, updateInput writes
                // the corrected value back into the DOM too.
                defaultValue=""
                inputMode="numeric"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  if (paused || resuming) return;
                  const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 9);
                  if (v.length > inputValRef.current.length) sfxType();
                  updateInput(v);
                }}
                onKeyDown={onKeyDown}
                className="w-full bg-transparent font-display text-3xl font-black tracking-widest text-white placeholder-white/20 md:text-4xl"
                placeholder={problem.kind === "factor" ? "素数を入力" : "答えを入力"}
              />
            ) : (
              // Phones get a plain, non-focusable element instead of an
              // <input>. This is the whole fix for the "keyboard slides down
              // the moment I start" complaint: there is nothing focusable in
              // the mobile game screen, so no virtual keyboard can be
              // requested (or dismissed) on mount, on tap, or at any phase
              // change, and the OS never scrolls/focus-ring-shifts the layout
              // to reveal an input. The typed digits are written into this
              // node's textContent directly (`paintInput`), and the caret plus
              // placeholder are pure CSS, so typing stays zero-React-render.
              <div
                ref={displayRef}
                className="answer-value pointer-events-none w-full font-display text-3xl font-black text-white"
                data-placeholder={problem.kind === "factor" ? "素数を入力" : "答えを入力"}
                aria-hidden="true"
              />
            )}
            {/* Submission is on pointerdown, not click: same reasoning as the
                keypad. The DOM order (and therefore the tab order on desktop)
                is unaffected. */}
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                submit();
              }}
              className="clip-chip shrink-0 px-4 py-2 font-display text-sm font-black tracking-[0.2em] text-black"
              style={{ background: di.color, boxShadow: `0 0 20px ${di.color}` }}
            >
              ENTER
            </button>
          </div>

          {/* Fixed height, no wrapping: this row used to be min-h-[22px],
              so any message long enough to hit a second line (the factor-
              mode error messages, easily, on a phone-width screen) grew the
              row on a miss and shoved the number pad ~20px down, then it
              snapped back up when the message cleared -- another source of
              the "keys keep moving" complaint. Long messages now ellipsize
              in place instead of moving anything. */}
          <div className="mt-2 flex h-[22px] items-center justify-between gap-3 overflow-hidden">
            <span
              className={`min-w-0 flex-1 truncate font-ui text-[13px] tracking-wide ${msg?.tone === "warn" ? "text-rose-400 neon-red" : "text-cyan-200/60"}`}
            >
              {msg?.text ??
                (problem.kind === "factor"
                  ? isDesktop
                    ? "空欄で BackSpace = 直前の数字を削除"
                    : "空欄で DEL = 直前の数字を削除"
                  : isDesktop
                    ? "ENTER で解答 / ESC でポーズ"
                    : "ENTER で解答 / 上部のボタンでポーズ")}
            </span>
            <span className="hidden shrink-0 font-mono2 text-[10px] tracking-[0.25em] text-white/25 md:block">
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
          <div className="clip-panel relative w-[min(92vw,560px)] border border-cyan-400/40 bg-black/75 p-6 md:p-8 md:backdrop-blur-xl">
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

      {/* RESUME 3-2-1 countdown -- pointer-events-none, and input is unblocked
          on the exact frame "GO" appears (see startResume). */}
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
