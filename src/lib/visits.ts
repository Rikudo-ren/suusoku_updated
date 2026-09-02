import { onValue, ref, runTransaction, type Unsubscribe } from "firebase/database";
import { db, ensureAuthUid } from "./firebase";

const VISITS_PATH = "siteStats/visits";

/**
 * Call once per page load (in App's mount effect). Intentionally NOT
 * deduplicated per device/uid/session -- this is a classic "累計アクセス数"
 * hit counter, so the same person opening or reloading the site five times
 * should tick the total up by five, not by one.
 *
 * Writing requires anonymous auth (see firebase-database-rules.json), so we
 * piggyback on the same `ensureAuthUid()` used for player identity. This is
 * best-effort: if auth or the transaction fails (offline, rules mismatch,
 * etc.) we just silently skip counting that visit rather than throwing.
 */
export async function recordVisit(): Promise<void> {
  try {
    await ensureAuthUid();
    await runTransaction(ref(db, VISITS_PATH), (current) => (typeof current === "number" ? current + 1 : 1));
  } catch {
    /* best effort -- a missed count is fine, a crashed title screen is not */
  }
}

/**
 * Live subscribe to the current total (for display, e.g. on the title
 * screen). Fires immediately with the cached/current value, then again
 * whenever the total changes -- including the moment this tab's own
 * `recordVisit()` call above lands.
 */
export function subscribeVisitCount(cb: (count: number | null) => void): Unsubscribe {
  return onValue(
    ref(db, VISITS_PATH),
    (snap) => cb(typeof snap.val() === "number" ? (snap.val() as number) : null),
    () => cb(null),
  );
}
