export type Difficulty = "easy" | "normal" | "hard";

export const DIFF_INFO: Record<
  Difficulty,
  { label: string; sub: string; points: number; color: string; accent: string; desc: string }
> = {
  easy: {
    label: "EASY",
    sub: "TRAINING",
    points: 1,
    color: "#3ef2a1",
    accent: "rgba(62,242,161,",
    desc: "2桁中心の基本演算 / 小さな素因数分解",
  },
  normal: {
    label: "NORMAL",
    sub: "COMBAT",
    points: 2,
    color: "#22e4ff",
    accent: "rgba(34,228,255,",
    desc: "3桁演算 / 2桁の掛け算 / 中規模の素因数分解",
  },
  hard: {
    label: "HARD",
    sub: "OVERDRIVE",
    points: 5,
    color: "#ff2bd1",
    accent: "rgba(255,43,209,",
    desc: "4桁演算 / 高難度の割り算 / 大きな素因数分解",
  },
};

export type ProblemKind = "arith" | "muldiv" | "factor";

export type ProblemMode = "arith" | "muldiv" | "factor" | "random";

export const MODE_INFO: Record<ProblemMode, { label: string; sub: string; desc: string; color: string; accent: string }> = {
  arith: {
    label: "加減算",
    sub: "ADD-SUB",
    desc: "足し算・引き算だけを出題",
    color: "#3ef2a1",
    accent: "rgba(62,242,161,",
  },
  muldiv: {
    label: "乗除算",
    sub: "MUL-DIV",
    desc: "掛け算・割り算だけを出題",
    color: "#22e4ff",
    accent: "rgba(34,228,255,",
  },
  factor: {
    label: "素因数分解",
    sub: "FACTORIZE",
    desc: "素因数分解だけを出題",
    color: "#ff2bd1",
    accent: "rgba(255,43,209,",
  },
  random: {
    label: "ランダム",
    sub: "RANDOM",
    desc: "3種類をランダムで出題",
    color: "#ffe45e",
    accent: "rgba(255,228,94,",
  },
};

export const MODE_ORDER: ProblemMode[] = ["random", "arith", "muldiv", "factor"];

export const TITLE_DIFFS: Difficulty[] = ["easy", "normal", "hard"];

const ri = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

let uid = 0;

export function isPrime(n: number): boolean {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
  return true;
}

function primeFactors(n: number): number[] {
  const out: number[] = [];
  let x = n;
  for (let p = 2; p * p <= x; p++) {
    while (x % p === 0) {
      out.push(p);
      x /= p;
    }
  }
  if (x > 1) out.push(x);
  return out;
}

/* ---------------- 足し引き ---------------- */
function genArith(d: Difficulty): Problem {
  let expr = "";
  let answer = 0;
  if (d === "easy") {
    const a = ri(12, 99);
    const b = ri(11, 99);
    if (Math.random() < 0.5) {
      expr = `${a} + ${b}`;
      answer = a + b;
    } else {
      const [hi, lo] = a >= b ? [a, b] : [b, a];
      expr = `${hi} − ${lo}`;
      answer = hi - lo;
    }
  } else if (d === "normal") {
    if (Math.random() < 0.45) {
      const a = ri(101, 899);
      const b = ri(101, 899);
      expr = `${a} + ${b}`;
      answer = a + b;
    } else if (Math.random() < 0.6) {
      const a = ri(300, 999);
      const b = ri(101, a - 10);
      expr = `${a} − ${b}`;
      answer = a - b;
    } else {
      const a = ri(50, 300);
      const b = ri(50, 300);
      const c = ri(20, Math.min(a + b - 1, 250));
      expr = `${a} + ${b} − ${c}`;
      answer = a + b - c;
    }
  } else {
    const r = Math.random();
    if (r < 0.35) {
      const a = ri(1200, 9800);
      const b = ri(1200, 9800);
      expr = `${a} + ${b}`;
      answer = a + b;
    } else if (r < 0.7) {
      const a = ri(3000, 9999);
      const b = ri(1000, a - 100);
      expr = `${a} − ${b}`;
      answer = a - b;
    } else {
      const a = ri(500, 4000);
      const b = ri(500, 4000);
      const c = ri(300, Math.min(a + b - 1, 3500));
      expr = `${a} + ${b} − ${c}`;
      answer = a + b - c;
    }
  }
  return { id: ++uid, kind: "arith", label: "加減算 / ADD-SUB", expr, answer };
}

/* ---------------- かけわり ---------------- */
function genMulDiv(d: Difficulty): Problem {
  let expr = "";
  let answer = 0;
  const mul = Math.random() < 0.5;
  if (d === "easy") {
    const a = ri(3, 9);
    const b = ri(3, 12);
    if (mul) {
      expr = `${a} × ${b}`;
      answer = a * b;
    } else {
      expr = `${a * b} ÷ ${a}`;
      answer = b;
    }
  } else if (d === "normal") {
    const a = ri(11, 29);
    const b = ri(4, 19);
    if (mul) {
      expr = `${a} × ${b}`;
      answer = a * b;
    } else {
      expr = `${a * b} ÷ ${a}`;
      answer = b;
    }
  } else {
    const a = ri(13, 79);
    const b = ri(12, 49);
    if (mul) {
      expr = `${a} × ${b}`;
      answer = a * b;
    } else {
      expr = `${a * b} ÷ ${b}`;
      answer = a;
    }
  }
  return { id: ++uid, kind: "muldiv", label: "乗除算 / MUL-DIV", expr, answer };
}

/* ---------------- 素因数分解 ---------------- */
function genFactor(d: Difficulty): Problem {
  const pool = d === "easy" ? [2, 3, 5, 7] : d === "normal" ? [2, 2, 3, 3, 5, 7, 11, 13] : [2, 2, 3, 3, 5, 7, 11, 13, 17, 19, 23];
  const min = d === "easy" ? 12 : d === "normal" ? 60 : 400;
  const max = d === "easy" ? 96 : d === "normal" ? 600 : 4200;
  const count = d === "easy" ? ri(2, 3) : d === "normal" ? ri(3, 4) : ri(3, 5);

  let target = 1;
  let guard = 0;
  do {
    target = 1;
    for (let i = 0; i < count; i++) target *= pick(pool);
    guard++;
  } while ((target < min || target > max || isPrime(target)) && guard < 200);
  if (target < min || target > max) target = d === "easy" ? 60 : d === "normal" ? 315 : 1260;

  return {
    id: ++uid,
    kind: "factor",
    label: "素因数分解 / FACTORIZE",
    expr: String(target),
    target,
    factors: primeFactors(target),
  };
}

export type Problem =
  | { id: number; kind: "arith" | "muldiv"; label: string; expr: string; answer: number }
  | { id: number; kind: "factor"; label: string; expr: string; target: number; factors: number[] };

export function generateProblem(d: Difficulty, mode: ProblemMode = "random", avoidKind?: ProblemKind): Problem {
  let k: ProblemKind;
  if (mode === "arith") k = "arith";
  else if (mode === "muldiv") k = "muldiv";
  else if (mode === "factor") k = "factor";
  else {
    const kinds: ProblemKind[] = ["arith", "muldiv", "factor"];
    k = pick(kinds);
    if (avoidKind && k === avoidKind && Math.random() < 0.65) k = pick(kinds.filter((x) => x !== avoidKind));
  }
  if (k === "arith") return genArith(d);
  if (k === "muldiv") return genMulDiv(d);
  return genFactor(d);
}
