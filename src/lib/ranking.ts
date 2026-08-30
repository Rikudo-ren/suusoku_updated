import {
  get,
  onValue,
  orderByChild,
  query,
  ref,
  runTransaction,
  serverTimestamp,
  update,
  type Unsubscribe,
} from "firebase/database";
import { db, ensureAuthUid, getCurrentUid } from "./firebase";
import type { Difficulty, ProblemMode } from "./problems";

export type RankEntry = {
  id: string;
  uid?: string;
  name: string;
  score: number;
  solved: number;
  misses: number;
  maxCombo: number;
  ts: number;
};

export type BoardKey = `${ProblemMode}::${Difficulty}`;

export const boardKey = (mode: ProblemMode, difficulty: Difficulty): BoardKey => `${mode}::${difficulty}`;

const boardPath = (mode: ProblemMode, difficulty: Difficulty) => `rankings/${mode}/${difficulty}`;

/* ---------------- player name (local cache) ---------------- */

const NAME_KEY = "numeric-velocity-name-v1";
const ADJ = ["CYBER", "NEON", "PULSE", "QUANTUM", "GHOST", "VOLT", "NOVA", "ECHO", "FLUX", "APEX"];

function randomGuestName(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${a}-${n}`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Fast, synchronous, local-only cache used for instant UI on first paint.
 * The source of truth once Firebase is reachable is `players/{uid}/name`. */
export function loadPlayerName(): string {
  try {
    const raw = localStorage.getItem(NAME_KEY);
    if (raw && raw.trim()) return raw.trim().slice(0, 12);
  } catch {
    /* ignore */
  }
  const g = randomGuestName();
  try {
    localStorage.setItem(NAME_KEY, g);
  } catch {
    /* ignore */
  }
  return g;
}

function cacheName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export { getCurrentUid, ensureAuthUid };

/* ---------------- claim / rename (server-validated, race-safe) ---------------- */

export type ClaimResult = { ok: true; name: string } | { ok: false; reason: "invalid" | "taken" };

/**
 * Reserve `rawName` for the current device's uid.
 * - Rejects empty names.
 * - Rejects names already reserved by a *different* uid (checked against the
 *   `playerNames` index, then re-validated atomically by the DB rules on write,
 *   so two people racing for the same name can never both win).
 * - On success, updates `players/{uid}/name`, which every ranking board reads
 *   from live -- so all of this player's existing entries display the new name.
 */
export async function claimName(rawName: string): Promise<ClaimResult> {
  const clean = rawName.trim().slice(0, 12);
  if (!clean) return { ok: false, reason: "invalid" };

  const uid = await ensureAuthUid();
  const normalized = normalizeName(clean);

  const myNameSnap = await get(ref(db, `players/${uid}/name`));
  const oldName = typeof myNameSnap.val() === "string" ? (myNameSnap.val() as string) : null;
  const oldNormalized = oldName ? normalizeName(oldName) : null;

  if (oldNormalized !== normalized) {
    const takenSnap = await get(ref(db, `playerNames/${normalized}`));
    const takenBy = takenSnap.val();
    if (takenBy && takenBy !== uid) {
      return { ok: false, reason: "taken" };
    }
  }

  const updates: Record<string, unknown> = {
    [`players/${uid}/name`]: clean,
    [`playerNames/${normalized}`]: uid,
  };
  if (oldNormalized && oldNormalized !== normalized) {
    updates[`playerNames/${oldNormalized}`] = null; // release the old reservation
  }

  try {
    await update(ref(db), updates);
  } catch {
    // Someone else claimed it in the split second between our check and our write.
    return { ok: false, reason: "taken" };
  }

  cacheName(clean);
  return { ok: true, name: clean };
}

/**
 * Call once when the app starts. Signs in anonymously, then either syncs the
 * local name cache to the server's record (if this device already has one) or
 * silently claims a name for the first time (the local cache, falling back to
 * a fresh random guest tag if that happens to collide).
 */
export async function initPlayerIdentity(): Promise<string> {
  const uid = await ensureAuthUid();
  const snap = await get(ref(db, `players/${uid}/name`));
  const existing = typeof snap.val() === "string" ? (snap.val() as string) : null;
  if (existing) {
    cacheName(existing);
    return existing;
  }
  let candidate = loadPlayerName();
  for (let i = 0; i < 5; i++) {
    const res = await claimName(candidate);
    if (res.ok) return res.name;
    candidate = randomGuestName();
  }
  return loadPlayerName();
}

/* ---------------- submit ---------------- */

/**
 * Record a finished run on the mode/difficulty leaderboard.
 *
 * Each player has at most ONE entry per board, keyed by their uid (not a
 * random push id) -- so replaying the same mode/difficulty over and over
 * updates that single entry instead of flooding the board with duplicates.
 * A transaction on that entry only overwrites it when the new score beats
 * the stored one, so the board always reflects each player's personal best.
 */
export async function submitScore(
  mode: ProblemMode,
  difficulty: Difficulty,
  entry: { score: number; solved: number; misses: number; maxCombo: number },
): Promise<void> {
  if (!entry.score || entry.score <= 0) return;
  const uid = await ensureAuthUid();
  const entryRef = ref(db, `${boardPath(mode, difficulty)}/${uid}`);
  const candidate = {
    uid,
    name: loadPlayerName().slice(0, 12) || "GUEST",
    score: Math.max(0, Math.floor(entry.score)),
    solved: Math.max(0, Math.floor(entry.solved)),
    misses: Math.max(0, Math.floor(entry.misses)),
    maxCombo: Math.max(0, Math.floor(entry.maxCombo)),
    ts: serverTimestamp(),
  };
  await runTransaction(entryRef, (current) => {
    if (!current || typeof current.score !== "number" || candidate.score > current.score) {
      return candidate;
    }
    return; // existing best is >= this run -- leave it untouched (abort the write)
  });
}

/* ---------------- shared live name lookup (uid -> current name) ---------------- */

type PlayersMap = Record<string, string>;

let playersCache: PlayersMap = {};
let playersListenerStarted = false;
const playersSubscribers = new Set<(map: PlayersMap) => void>();

function ensurePlayersListener() {
  if (playersListenerStarted) return;
  playersListenerStarted = true;
  onValue(ref(db, "players"), (snap) => {
    const next: PlayersMap = {};
    snap.forEach((c) => {
      const v = c.val();
      if (v && typeof v.name === "string") next[c.key as string] = v.name;
    });
    playersCache = next;
    playersSubscribers.forEach((cb) => cb(playersCache));
  });
}

function subscribePlayerNames(cb: (map: PlayersMap) => void): Unsubscribe {
  ensurePlayersListener();
  playersSubscribers.add(cb);
  cb(playersCache);
  return () => {
    playersSubscribers.delete(cb);
  };
}

/* ---------------- subscribe (real-time) ---------------- */

export function subscribeBoard(
  mode: ProblemMode,
  difficulty: Difficulty,
  top: number,
  cb: (entries: RankEntry[]) => void,
): Unsubscribe {
  const listRef = query(ref(db, boardPath(mode, difficulty)), orderByChild("score"));
  let rawEntries: RankEntry[] = [];

  const emit = () => {
    const resolved = rawEntries.map((e) => ({
      ...e,
      // Live-follow the player's current name if we know their uid; otherwise
      // (legacy entries with no uid) keep showing whatever was recorded.
      name: (e.uid && playersCache[e.uid]) || e.name,
    }));
    resolved.sort((a, b) => b.score - a.score || a.ts - b.ts);
    cb(resolved.slice(0, top));
  };

  const unsubBoard = onValue(
    listRef,
    (snap) => {
      const arr: RankEntry[] = [];
      snap.forEach((c) => {
        const v = c.val() ?? {};
        arr.push({
          id: c.key as string,
          uid: typeof v.uid === "string" ? v.uid : undefined,
          name: typeof v.name === "string" ? v.name : "GUEST",
          score: Number(v.score) || 0,
          solved: Number(v.solved) || 0,
          misses: Number(v.misses) || 0,
          maxCombo: Number(v.maxCombo) || 0,
          ts: typeof v.ts === "number" ? v.ts : 0,
        });
      });
      rawEntries = arr;
      emit();
    },
    () => cb([]),
  );

  const unsubPlayers = subscribePlayerNames(() => emit());

  return () => {
    unsubBoard();
    unsubPlayers();
  };
}
