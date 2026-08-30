/* ============================================================
   数速バトル - Cyber Audio Engine (pure Web Audio, no assets)
   ============================================================ */

type Mode = "title" | "battle" | "danger" | "result";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let comp: DynamicsCompressorNode | null = null;

let schedId: number | null = null;
let step = 0;
let nextTime = 0;
let mode: Mode = "title";
let musicOn = false;
let musicMuted = false;
let sfxMuted = false;

const LOOKAHEAD = 0.1; // sec
const TICK = 25; // ms
const MASTER_GAIN = 0.9;
const MUSIC_GAIN = 0.55;
const SFX_GAIN = 0.85;

function bpm() {
  return mode === "danger" ? 152 : mode === "title" ? 118 : 136;
}

export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;

  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 8;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;

  musicBus = ctx.createGain();
  musicBus.gain.value = musicMuted ? 0.0001 : MUSIC_GAIN;
  sfxBus = ctx.createGain();
  sfxBus.gain.value = sfxMuted ? 0.0001 : SFX_GAIN;

  musicBus.connect(comp);
  sfxBus.connect(comp);
  comp.connect(master);
  master.connect(ctx.destination);

  // noise buffer
  const len = ctx.sampleRate * 2;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

  return ctx;
}

export function setMusicMuted(m: boolean) {
  musicMuted = m;
  if (m) stopMusic(0.18);
  else if (musicBus && ctx) musicBus.gain.setTargetAtTime(MUSIC_GAIN, ctx.currentTime, 0.08);
}

export function isMusicMuted() {
  return musicMuted;
}

export function setSfxMuted(m: boolean) {
  sfxMuted = m;
  if (sfxBus && ctx) sfxBus.gain.setTargetAtTime(m ? 0.0001 : SFX_GAIN, ctx.currentTime, 0.04);
}

export function isSfxMuted() {
  return sfxMuted;
}

// Backward-compatible aliases. The UI now controls BGM and SFX separately.
export function setMuted(m: boolean) {
  setSfxMuted(m);
}
export function isMuted() {
  return isSfxMuted();
}

function noise(dur: number, gain: number, type: BiquadFilterType, freq: number, when = 0, q = 1) {
  if (!ctx || !noiseBuf || !sfxBus) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(opts: {
  freq: number;
  dur: number;
  gain?: number;
  type?: OscillatorType;
  when?: number;
  glideTo?: number;
  bus?: GainNode | null;
  attack?: number;
  filter?: number;
  detune?: number;
}) {
  if (!ctx) return;
  const bus = opts.bus ?? sfxBus;
  if (!bus) return;
  const t = ctx.currentTime + (opts.when ?? 0);
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.detune) osc.detune.value = opts.detune;
  if (opts.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.glideTo), t + opts.dur);
  const g = ctx.createGain();
  const peak = opts.gain ?? 0.2;
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  let node: AudioNode = osc;
  if (opts.filter) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = opts.filter;
    f.Q.value = 6;
    node = osc.connect(f);
  }
  node.connect(g).connect(bus);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

/* ---------------- SFX ---------------- */

export function sfxUI() {
  initAudio();
  tone({ freq: 1180, dur: 0.05, gain: 0.1, type: "square" });
  tone({ freq: 1760, dur: 0.07, gain: 0.06, type: "square", when: 0.03 });
}

export function sfxSelect() {
  initAudio();
  tone({ freq: 420, dur: 0.1, gain: 0.16, type: "sawtooth", glideTo: 900, filter: 2600 });
  noise(0.14, 0.1, "highpass", 2400);
}

export function sfxType() {
  initAudio();
  tone({ freq: 900 + Math.random() * 240, dur: 0.035, gain: 0.07, type: "square" });
}

export function sfxFactorAdd(n: number) {
  initAudio();
  const base = 480 + Math.min(n, 12) * 26;
  tone({ freq: base, dur: 0.09, gain: 0.14, type: "triangle", glideTo: base * 1.6 });
  noise(0.08, 0.06, "highpass", 3200);
}

export function sfxDelete() {
  initAudio();
  tone({ freq: 520, dur: 0.09, gain: 0.12, type: "square", glideTo: 190 });
}

export function sfxCorrect(combo = 1) {
  initAudio();
  const c = Math.min(combo, 8);
  const root = 523.25 * Math.pow(2, (c - 1) / 24);
  [0, 4, 7, 12].forEach((semi, i) => {
    const f = root * Math.pow(2, semi / 12);
    tone({ freq: f, dur: 0.26, gain: 0.15, type: "square", when: i * 0.035 });
    tone({ freq: f * 2, dur: 0.18, gain: 0.05, type: "triangle", when: i * 0.035 });
  });
  tone({ freq: 110, dur: 0.28, gain: 0.3, type: "sine", glideTo: 60 });
  noise(0.3, 0.14, "highpass", 3000);
}

export function sfxError() {
  initAudio();
  tone({ freq: 150, dur: 0.28, gain: 0.24, type: "sawtooth", glideTo: 62, filter: 900 });
  tone({ freq: 96, dur: 0.3, gain: 0.2, type: "square", glideTo: 48 });
  noise(0.2, 0.1, "lowpass", 700);
}

export function sfxWarn() {
  initAudio();
  tone({ freq: 300, dur: 0.14, gain: 0.16, type: "square", glideTo: 200 });
  tone({ freq: 302, dur: 0.14, gain: 0.12, type: "sawtooth", when: 0.14, glideTo: 210 });
}

export function sfxTick(urgent = false) {
  initAudio();
  if (urgent) {
    tone({ freq: 1500, dur: 0.1, gain: 0.2, type: "square" });
    tone({ freq: 760, dur: 0.14, gain: 0.16, type: "sawtooth", glideTo: 600 });
    noise(0.09, 0.09, "highpass", 4000);
  } else {
    tone({ freq: 1050, dur: 0.07, gain: 0.13, type: "square" });
  }
}

export function sfxStart() {
  initAudio();
  [0, 0.16, 0.32].forEach((w, i) => tone({ freq: 440 + i * 110, dur: 0.14, gain: 0.18, type: "square", when: w }));
  tone({ freq: 880, dur: 0.5, gain: 0.22, type: "sawtooth", when: 0.5, glideTo: 1760, filter: 5000 });
  tone({ freq: 55, dur: 0.9, gain: 0.32, type: "sine", when: 0.5, glideTo: 40 });
  noise(0.8, 0.16, "highpass", 1200, 0.42);
}

export function sfxTimeUp() {
  initAudio();
  tone({ freq: 420, dur: 1.5, gain: 0.3, type: "sawtooth", glideTo: 40, filter: 1400 });
  tone({ freq: 210, dur: 1.7, gain: 0.26, type: "square", glideTo: 30 });
  noise(1.6, 0.22, "lowpass", 1600);
}

export function sfxResultHit(i: number) {
  initAudio();
  tone({ freq: 300 + i * 140, dur: 0.16, gain: 0.16, type: "square" });
  noise(0.12, 0.08, "highpass", 2600);
}

export function sfxRank() {
  initAudio();
  [0, 7, 12, 19, 24].forEach((s, i) =>
    tone({ freq: 261.6 * Math.pow(2, s / 12), dur: 0.9, gain: 0.13, type: "sawtooth", when: i * 0.07, filter: 4200 })
  );
  tone({ freq: 65, dur: 1.6, gain: 0.34, type: "sine", glideTo: 42 });
  noise(1.2, 0.16, "highpass", 900);
}

export function sfxCrack(level = 1, singularity = false) {
  initAudio();
  const n = Math.min(level, 6);
  if (singularity) {
    // Gravitational space crack rumble
    tone({ freq: 50 + n * 24, dur: 0.32, gain: 0.35, type: "sawtooth", glideTo: 24, filter: 600 });
    tone({ freq: 1200 - n * 160, dur: 0.22, gain: 0.16, type: "square", glideTo: 220 });
    noise(0.18 + n * 0.05, 0.22 + n * 0.05, "bandpass", 900 + n * 500, 0, 1.4);
  } else {
    // Glass electric crack
    noise(0.15 + n * 0.04, 0.22 + n * 0.04, "highpass", 1600 + n * 450);
    tone({ freq: 95 + n * 18, dur: 0.2, gain: 0.26, type: "sawtooth", glideTo: 38, filter: 900 });
    if (n >= 2) tone({ freq: 440 + n * 110, dur: 0.09, gain: 0.12, type: "square", glideTo: 140 });
  }
}

export function sfxShatter(singularity = false) {
  initAudio();
  if (singularity) {
    // Dimension collapse super-nova explosion
    noise(1.4, 0.45, "lowpass", 1800);
    noise(0.9, 0.32, "bandpass", 3200, 0.04, 0.6);
    tone({ freq: 160, dur: 1.2, gain: 0.45, type: "sawtooth", glideTo: 22, filter: 700 });
    tone({ freq: 880, dur: 0.7, gain: 0.24, type: "square", glideTo: 40 });
    [0, 0.06, 0.14, 0.24, 0.38].forEach((w, i) =>
      tone({ freq: 1200 - i * 180, dur: 0.15, gain: 0.14, type: "sawtooth", when: w, glideTo: 90 })
    );
  } else {
    noise(0.7, 0.42, "highpass", 1000);
    noise(0.8, 0.3, "bandpass", 2600, 0.04, 0.7);
    tone({ freq: 100, dur: 0.9, gain: 0.38, type: "sawtooth", glideTo: 25, filter: 950 });
    tone({ freq: 220, dur: 0.5, gain: 0.22, type: "square", glideTo: 48 });
    [0, 0.07, 0.15, 0.26].forEach((w) => noise(0.2, 0.22, "highpass", 3000 + Math.random() * 2500, w));
  }
}

export function sfxGlitchBurst() {
  initAudio();
  for (let i = 0; i < 16; i++) {
    const f = 110 + Math.random() * 2600;
    tone({
      freq: f,
      dur: 0.04 + Math.random() * 0.09,
      gain: 0.09 + Math.random() * 0.11,
      type: Math.random() > 0.5 ? "square" : "sawtooth",
      when: i * 0.035 + Math.random() * 0.015,
      filter: 5200,
    });
  }
  noise(1.0, 0.25, "highpass", 800);
  tone({ freq: 65, dur: 1.2, gain: 0.34, type: "sine", glideTo: 28 });
}

export function sfxExtremeAppear(singularity = false) {
  initAudio();
  const base = singularity ? 130.81 : 110; // C3 vs A2
  [0, 3, 7, 10, 14, 19, 24].forEach((s, i) =>
    tone({
      freq: base * Math.pow(2, s / 12),
      dur: singularity ? 1.1 : 0.8,
      gain: 0.14,
      type: i % 2 ? "sawtooth" : "square",
      when: i * 0.05,
      filter: singularity ? 5000 : 3800,
    })
  );
  tone({ freq: 42, dur: 1.6, gain: 0.42, type: "sine", glideTo: 24 });
  noise(1.2, 0.2, "lowpass", 900);
}

/* ---------------- MUSIC ---------------- */

const BASS: Record<Mode, number[]> = {
  // semitone offsets from D1, -1 = rest (16 steps)
  title: [0, -1, 0, -1, -1, 0, -1, -1, 3, -1, -1, 0, -1, -1, 5, -1],
  battle: [0, 0, -1, 0, -1, 0, 0, -1, 3, -1, 3, -1, 5, -1, 3, 2],
  danger: [0, 0, 0, -1, 0, 0, -1, 0, 3, 3, -1, 3, 5, 5, 7, 6],
  result: [0, -1, -1, -1, 5, -1, -1, -1, 3, -1, -1, -1, 7, -1, -1, -1],
};

const LEAD: Record<Mode, number[]> = {
  title: [-1, -1, -1, -1, 12, -1, 15, -1, -1, -1, 19, -1, -1, 15, -1, -1],
  battle: [12, -1, 15, 19, -1, 17, -1, 15, 12, -1, 19, -1, 22, -1, 19, 17],
  danger: [24, 22, 19, 22, 24, -1, 26, 24, 22, 19, 17, 19, 22, 24, 26, 27],
  result: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
};

const D1 = 36.71; // Hz

function kick(t: number, g = 0.85) {
  if (!ctx || !musicBus) return;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.13);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(g, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  osc.connect(gain).connect(musicBus);
  osc.start(t);
  osc.stop(t + 0.36);
  // click
  const c = ctx.createOscillator();
  c.type = "square";
  c.frequency.setValueAtTime(900, t);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.12, t);
  cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  c.connect(cg).connect(musicBus);
  c.start(t);
  c.stop(t + 0.05);
}

function snare(t: number) {
  if (!ctx || !noiseBuf || !musicBus) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1900;
  f.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.38, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  src.connect(f).connect(g).connect(musicBus);
  src.start(t);
  src.stop(t + 0.22);
}

function hat(t: number, open: boolean) {
  if (!ctx || !noiseBuf || !musicBus) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 8200;
  const g = ctx.createGain();
  const d = open ? 0.16 : 0.045;
  g.gain.setValueAtTime(open ? 0.14 : 0.1, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  src.connect(f).connect(g).connect(musicBus);
  src.start(t);
  src.stop(t + d + 0.05);
}

function bassNote(t: number, semi: number, dur: number) {
  if (!ctx || !musicBus) return;
  const freq = D1 * Math.pow(2, semi / 12);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(mode === "danger" ? 1500 : 900, t);
  f.frequency.exponentialRampToValueAtTime(220, t + dur);
  f.Q.value = 9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  [0, -8, 8].forEach((det, i) => {
    const o = ctx!.createOscillator();
    o.type = i === 0 ? "sawtooth" : "square";
    o.frequency.value = freq * (i === 2 ? 2 : 1);
    o.detune.value = det;
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.05);
  });
  f.connect(g).connect(musicBus);
}

function leadNote(t: number, semi: number, dur: number, vol: number) {
  if (!ctx || !musicBus) return;
  const freq = D1 * 4 * Math.pow(2, semi / 12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 3800;
  const o = ctx.createOscillator();
  o.type = "square";
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "sawtooth";
  o2.frequency.value = freq;
  o2.detune.value = 11;
  o.connect(f);
  o2.connect(f);
  f.connect(g).connect(musicBus);
  o.start(t);
  o2.start(t);
  o.stop(t + dur + 0.05);
  o2.stop(t + dur + 0.05);
}

function pad(t: number, dur: number) {
  if (!ctx || !musicBus) return;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.075, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 1500;
  [0, 3, 7, 10].forEach((s) => {
    const o = ctx!.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = D1 * 2 * Math.pow(2, s / 12);
    o.detune.value = (Math.random() - 0.5) * 16;
    o.connect(f);
    o.start(t);
    o.stop(t + dur + 0.1);
  });
  f.connect(g).connect(musicBus);
}

function scheduleStep(s: number, t: number) {
  const spb = 60 / bpm();
  const sixteenth = spb / 4;
  const b = BASS[mode];
  const l = LEAD[mode];
  const heavy = mode === "battle" || mode === "danger";

  if (mode === "title") {
    if (s % 4 === 0) kick(t, 0.6);
    if (s % 8 === 4) snare(t);
    if (s % 2 === 0) hat(t, s % 8 === 6);
  } else if (mode === "result") {
    if (s % 8 === 0) kick(t, 0.55);
    if (s === 0) pad(t, spb * 4);
  } else {
    if (s % 4 === 0) kick(t, 0.95);
    else if (s === 10 || (mode === "danger" && s === 7)) kick(t, 0.45);
    if (s === 4 || s === 12) snare(t);
    if (mode === "danger" && s === 14) snare(t);
    hat(t, s % 8 === 6);
  }

  const bn = b[s];
  if (bn >= 0) bassNote(t, bn, sixteenth * (heavy ? 1.6 : 2.2));

  const ln = l[s];
  if (ln >= 0 && mode !== "result") {
    leadNote(t, ln, sixteenth * 1.5, mode === "danger" ? 0.12 : mode === "battle" ? 0.085 : 0.06);
  }

  if (s === 0 && mode !== "result") pad(t, spb * 4);
}

function scheduler() {
  if (!ctx) return;
  const spb = 60 / bpm();
  const sixteenth = spb / 4;
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    scheduleStep(step % 16, nextTime);
    nextTime += sixteenth;
    step++;
  }
}

export function startMusic(m: Mode) {
  initAudio();
  if (!ctx || musicMuted) return;
  mode = m;
  if (musicOn) return;
  musicOn = true;
  step = 0;
  nextTime = ctx.currentTime + 0.08;
  if (musicBus) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(MUSIC_GAIN, ctx.currentTime + 0.6);
  }
  schedId = window.setInterval(scheduler, TICK);
}

export function setMusicMode(m: Mode) {
  if (mode === m) {
    if (!musicOn && !musicMuted) startMusic(m);
    return;
  }
  mode = m;
  if (!musicOn && !musicMuted) startMusic(m);
}

export function pauseMusic(fade = 0.22) {
  if (!ctx || !musicOn) return;
  stopMusic(fade);
}

export function resumeMusic(m: Mode = mode) {
  if (!musicMuted) startMusic(m);
}

export function stopMusic(fade = 0.5) {
  if (!ctx || !musicOn) return;
  const t = ctx.currentTime;
  if (musicBus) {
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(musicBus.gain.value, t);
    musicBus.gain.linearRampToValueAtTime(0.0001, t + fade);
  }
  musicOn = false;
  const id = schedId;
  schedId = null;
  window.setTimeout(() => {
    if (id !== null) window.clearInterval(id);
  }, fade * 1000 + 60);
}
