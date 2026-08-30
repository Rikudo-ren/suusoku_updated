import { useMemo } from "react";

type Props = {
  accent?: string;
  danger?: boolean;
  intensity?: number;
  lightweight?: boolean;
};

const GLYPHS = [
  "∑", "∏", "∫", "∂", "∇", "∝", "≈", "≠", "≤", "≥", "±", "∞", "√", "π", "θ", "λ", "Ω", "Δ", "Φ", "Ψ",
  "sin", "cos", "tan", "log", "lim", "dx", "dy", "ƒ(x)", "ℝ", "ℕ", "ℤ", "ℚ",
  "∪", "∩", "∈", "∉", "⊂", "⊃", "⇒", "⇔", "∀", "∃", "∄",
  "1", "0", "7", "13", "21", "34", "55", "89", "144",
  "{", "}", "(", ")", "[", "]", "→", "λ",
  "e", "i", "φ", "ψ", "σ", "μ", "ε",
];

function makeStream(seed: number, count: number) {
  // simple mulberry32
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, i) => {
    const big = rand() < 0.18;
    return {
      id: i,
      x: rand() * 100,
      glyph: GLYPHS[Math.floor(rand() * GLYPHS.length)],
      delay: -rand() * 14,
      duration: 11 + rand() * 12,
      size: big ? 40 + rand() * 56 : 14 + rand() * 26,
      opacity: 0.18 + rand() * 0.55,
      drift: (rand() - 0.5) * 70,
      color: rand() < 0.5 ? "a" : "b",
    };
  });
}

export default function Backdrop({ accent = "#22e4ff", danger = false, intensity = 1, lightweight = false }: Props) {
  const col = danger ? "#ff2d55" : accent;
  const left = useMemo(() => makeStream(11, lightweight ? 5 : 18), [lightweight]);
  const center = useMemo(() => makeStream(29, lightweight ? 7 : 22), [lightweight]);
  const right = useMemo(() => makeStream(57, lightweight ? 5 : 18), [lightweight]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* deep gradient */}
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{
          background: danger
            ? "radial-gradient(ellipse 80% 60% at 50% 110%, rgba(255,45,85,0.22), transparent 60%), radial-gradient(ellipse 70% 50% at 50% -10%, rgba(120,0,60,0.35), transparent 60%), #08020a"
            : "radial-gradient(ellipse 80% 60% at 50% 110%, rgba(34,228,255,0.16), transparent 60%), radial-gradient(ellipse 70% 50% at 50% -10%, rgba(90,20,150,0.32), transparent 60%), #03060d",
        }}
      />

      {/* rotating conic glow */}
      {!lightweight && (
        <div
          className="orbit absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2 opacity-[0.18]"
          style={{
            background: `conic-gradient(from 0deg, transparent 0deg, ${col}55 40deg, transparent 90deg, transparent 180deg, ${col}33 220deg, transparent 280deg)`,
          }}
        />
      )}

      {/* ascending math symbols - main stream (cyan) */}
      <div className="absolute inset-0" style={{ opacity: 0.85 * intensity }}>
        {center.map((s) => (
          <span
            key={s.id}
            className="glyph-rise"
            style={
              {
                left: `${s.x}%`,
                fontSize: `${s.size}px`,
                color: s.color === "a" ? "#22e4ff" : "#d4f6ff",
                textShadow: `0 0 12px ${s.color === "a" ? "#22e4ff" : "#ffffff"}, 0 0 30px ${col}55`,
                animationDuration: `${s.duration}s`,
                animationDelay: `${s.delay}s`,
                ["--drift" as string]: `${s.drift}px`,
                ["--op" as string]: s.opacity,
              } as React.CSSProperties
            }
          >
            {s.glyph}
          </span>
        ))}
      </div>

      {/* secondary stream (magenta, slower) */}
      <div className="absolute inset-0" style={{ opacity: 0.7 * intensity }}>
        {right.map((s) => (
          <span
            key={s.id}
            className="glyph-rise-mag"
            style={
              {
                left: `${s.x}%`,
                fontSize: `${s.size * 0.9}px`,
                color: s.color === "a" ? "#ff2bd1" : "#a366ff",
                textShadow: `0 0 10px ${s.color === "a" ? "#ff2bd1" : "#a366ff"}, 0 0 28px ${col}55`,
                animationDuration: `${s.duration + 6}s`,
                animationDelay: `${s.delay - 3}s`,
                ["--drift" as string]: `${s.drift}px`,
                ["--op" as string]: s.opacity * 0.9,
              } as React.CSSProperties
            }
          >
            {s.glyph}
          </span>
        ))}
      </div>

      {/* third stream (lime/accent, sparse) */}
      <div className="absolute inset-0" style={{ opacity: 0.55 * intensity }}>
        {left.map((s) => (
          <span
            key={s.id}
            className="glyph-rise-dim"
            style={
              {
                left: `${s.x}%`,
                fontSize: `${s.size * 0.7}px`,
                color: danger ? "#ff8095" : "#3ef2a1",
                textShadow: `0 0 10px currentColor`,
                animationDuration: `${s.duration + 2}s`,
                animationDelay: `${s.delay - 5}s`,
                ["--drift" as string]: `${s.drift * 0.6}px`,
                ["--op" as string]: s.opacity * 0.7,
              } as React.CSSProperties
            }
          >
            {s.glyph}
          </span>
        ))}
      </div>

      {/* perspective grid floor */}
      <div
        className="cyber-grid-floor absolute inset-x-0 bottom-0 h-[42vh]"
        style={{ opacity: 0.55, filter: danger ? "hue-rotate(150deg)" : "none" }}
      />
      <div className="cyber-grid absolute inset-0" style={{ opacity: 0.5 * intensity }} />
      <div
        className="absolute inset-x-0 bottom-[42vh] h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${col}, transparent)`, boxShadow: `0 0 24px ${col}` }}
      />

      {/* sweeping scan line */}
      {!lightweight && (
        <div
          className="sweep-line absolute inset-x-0 top-0 h-24"
          style={{ background: `linear-gradient(to bottom, transparent, ${col}22, transparent)` }}
        />
      )}

      {/* side rails */}
      <div className="absolute inset-y-0 left-0 w-16 opacity-40" style={{ background: `linear-gradient(90deg, ${col}22, transparent)` }} />
      <div className="absolute inset-y-0 right-0 w-16 opacity-40" style={{ background: `linear-gradient(-90deg, ${col}22, transparent)` }} />

      {!lightweight && <div className="scanlines absolute inset-0" />}
      <div className="vignette absolute inset-0" />
      {danger && <div className="danger-pulse absolute inset-0" />}
    </div>
  );
}
