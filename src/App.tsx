import { useCallback, useEffect, useRef, useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import TitleScreen from "./components/TitleScreen";
import GameScreen, { type GameStats } from "./components/GameScreen";
import ResultScreen from "./components/ResultScreen";
import RankingScreen from "./components/RankingScreen";
import { type Difficulty, type ProblemMode } from "./lib/problems";
import { initPlayerIdentity, submitScore } from "./lib/ranking";
import {
  initAudio,
  isMusicMuted,
  isSfxMuted,
  setMusicMode,
  setMusicMuted,
  setSfxMuted,
  startMusic,
  stopMusic,
} from "./lib/audio";

type Screen = "title" | "game" | "result" | "ranking";
type Prefs = { bgmOn: boolean; soundOn: boolean; lightweight: boolean; ultra: boolean };

const BEST_KEY = "numeric-velocity-best-v2";
const PREF_KEY = "numeric-velocity-prefs-v1";
const bestKey = (d: Difficulty, m: ProblemMode) => `${d}::${m}`;

const loadBest = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
};

const loadPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { bgmOn: true, soundOn: true, lightweight: false, ultra: false, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { bgmOn: !isMusicMuted(), soundOn: !isSfxMuted(), lightweight: false, ultra: false };
};

const savePrefs = (prefs: Prefs) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
};

export default function App() {
  const prefs = useRef(loadPrefs()).current;
  const [screen, setScreen] = useState<Screen>("title");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [mode, setMode] = useState<ProblemMode>("random");
  const [stats, setStats] = useState<GameStats | null>(null);
  const [isBest, setIsBest] = useState(false);
  const [best, setBest] = useState<Record<string, number>>(loadBest);
  const [audioReady, setAudioReady] = useState(false);
  const [bgmOn, setBgmOn] = useState(prefs.bgmOn);
  const [soundOn, setSoundOn] = useState(prefs.soundOn);
  const [lightweight, setLightweight] = useState(prefs.lightweight);
  const [ultra, setUltra] = useState(prefs.ultra);
  const [runKey, setRunKey] = useState(0);
  const [rankingFrom, setRankingFrom] = useState<{ d: Difficulty; m: ProblemMode } | null>(null);
  const enabled = useRef(false);

  useEffect(() => {
    // Silently sign in (anonymous) and reserve/sync this device's pilot name.
    initPlayerIdentity().catch(() => {
      /* best effort; the game still works fully offline-first with the local name */
    });
  }, []);

  useEffect(() => {
    setMusicMuted(!bgmOn);
    setSfxMuted(!soundOn);
    savePrefs({ bgmOn, soundOn, lightweight, ultra });
  }, [bgmOn, soundOn, lightweight, ultra]);

  const screenMusic = useCallback(() => {
    if (screen === "result") return "result" as const;
    if (screen === "game") return "battle" as const;
    return "title" as const;
  }, [screen]);

  const enableAudio = useCallback(() => {
    if (enabled.current) return;
    enabled.current = true;
    initAudio();
    setMusicMuted(!bgmOn);
    setSfxMuted(!soundOn);
    if (bgmOn) startMusic(screenMusic());
    setAudioReady(true);
  }, [bgmOn, soundOn, screenMusic]);

  useEffect(() => {
    const h = () => enableAudio();
    window.addEventListener("pointerdown", h, { once: true });
    window.addEventListener("keydown", h, { once: true });
    return () => {
      window.removeEventListener("pointerdown", h);
      window.removeEventListener("keydown", h);
    };
  }, [enableAudio]);

  const start = (d: Difficulty, m: ProblemMode) => {
    setDifficulty(d);
    setMode(m);
    setRunKey((k) => k + 1);
    setScreen("game");
  };

  const finish = (s: GameStats) => {
    setStats(s);
    const prev = best[bestKey(s.difficulty, s.mode)] ?? 0;
    if (s.score > prev) {
      const nb = { ...best, [bestKey(s.difficulty, s.mode)]: s.score };
      setBest(nb);
      setIsBest(true);
      try {
        localStorage.setItem(BEST_KEY, JSON.stringify(nb));
      } catch {
        /* ignore */
      }
    } else {
      setIsBest(false);
    }
    submitScore(s.mode, s.difficulty, {
      score: s.score,
      solved: s.solved,
      misses: s.misses,
      maxCombo: s.maxCombo,
    }).catch(() => {
      /* leaderboard is best-effort; never block the result screen on it */
    });
    setScreen("result");
  };

  const toRanking = (d?: Difficulty, m?: ProblemMode) => {
    setRankingFrom(d && m ? { d, m } : null);
    setScreen("ranking");
  };

  const toTitle = () => {
    setScreen("title");
    stopMusic(0.3);
    window.setTimeout(() => {
      if (enabled.current && bgmOn) startMusic("title");
      setMusicMode("title");
    }, 340);
  };

  const retry = () => {
    stopMusic(0.18);
    setRunKey((k) => k + 1);
    setScreen("game");
  };

  const toggleBgm = () => {
    enableAudio();
    const next = !bgmOn;
    setBgmOn(next);
    setMusicMuted(!next);
    if (next && screen !== "game") startMusic(screenMusic());
  };

  const toggleSound = () => {
    enableAudio();
    const next = !soundOn;
    setSoundOn(next);
    setSfxMuted(!next);
  };

  const toggleLightweight = () => setLightweight((v) => !v);
  const toggleUltra = () => setUltra((v) => !v);

  // On phones the on-screen number pad (GameScreen, md:hidden) sits at the
  // bottom of the screen; a fixed bottom-right settings bar there would sit
  // on top of it and block taps. So on mobile widths we hide this bar while
  // actually in the game screen, and show it again everywhere else. Desktop
  // (md+) is unaffected since it never shows the on-screen number pad.
  const [isDesktopUI, setIsDesktopUI] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktopUI(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const showSettingsBar = isDesktopUI || screen !== "game";

  // ULTRA implies every existing LITE-mode reduction too, so screens only
  // need to check one boolean (`lightweight`) internally. `ultra` is passed
  // through separately just for Backdrop, which goes fully flat under it.
  const effectiveLightweight = lightweight || ultra;

  return (
    <div className={`relative h-full w-full select-none bg-[#03060d] text-white ${ultra ? "ultra-mode" : ""}`}>
      {screen === "title" && (
        <TitleScreen
          onStart={start}
          onRanking={() => toRanking()}
          best={best}
          audioReady={audioReady}
          lightweight={effectiveLightweight}
          ultra={ultra}
          onEnableAudio={enableAudio}
        />
      )}
      {screen === "game" && (
        <GameScreen
          key={runKey}
          difficulty={difficulty}
          mode={mode}
          bgmEnabled={bgmOn}
          lightweight={effectiveLightweight}
          ultra={ultra}
          onFinish={finish}
          onTitle={toTitle}
          onRetry={retry}
        />
      )}
      {screen === "result" && stats && (
        <ResultScreen
          stats={stats}
          isBest={isBest}
          lightweight={effectiveLightweight}
          ultra={ultra}
          onRetry={retry}
          onTitle={toTitle}
          onRanking={() => toRanking(stats.difficulty, stats.mode)}
        />
      )}
      {screen === "ranking" && (
        <RankingScreen
          lightweight={effectiveLightweight}
          ultra={ultra}
          initialDifficulty={rankingFrom?.d}
          initialMode={rankingFrom?.m}
          onBack={toTitle}
        />
      )}

      <div
        className="fixed bottom-3 right-3 z-50 flex flex-col gap-1.5 md:flex-row"
        style={{ display: showSettingsBar ? undefined : "none" }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={toggleBgm}
          title="BGM ON/OFF"
          className="clip-chip border border-cyan-400/30 bg-black/65 px-3 py-2 font-mono2 text-[10px] tracking-[0.2em] text-cyan-200/75 backdrop-blur transition-colors hover:border-cyan-300 hover:text-cyan-100"
        >
          BGM {bgmOn ? "ON" : "OFF"}
        </button>
        <button
          onClick={toggleSound}
          title="SOUND ON/OFF"
          className="clip-chip border border-fuchsia-400/30 bg-black/65 px-3 py-2 font-mono2 text-[10px] tracking-[0.2em] text-fuchsia-200/75 backdrop-blur transition-colors hover:border-fuchsia-300 hover:text-fuchsia-100"
        >
          SOUND {soundOn ? "ON" : "OFF"}
        </button>
        <button
          onClick={toggleLightweight}
          title="軽量化モード"
          className="clip-chip border border-white/25 bg-black/65 px-3 py-2 font-mono2 text-[10px] tracking-[0.2em] text-white/70 backdrop-blur transition-colors hover:border-white/45 hover:text-white"
        >
          LITE {lightweight ? "ON" : "OFF"}
        </button>
        <button
          onClick={toggleUltra}
          title="スーパー軽量モード（演出をほぼ全カット）"
          className="clip-chip border border-white/25 bg-black/65 px-3 py-2 font-mono2 text-[10px] tracking-[0.2em] text-white/70 backdrop-blur transition-colors hover:border-white/45 hover:text-white"
        >
          ULTRA {ultra ? "ON" : "OFF"}
        </button>
      </div>
      <Analytics />
    </div>
  );
}
