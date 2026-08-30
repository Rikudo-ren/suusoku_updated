import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAHAp3vpF2S3uhvdX8_jEoIvZei0jp81tY",
  authDomain: "suusokubattle.firebaseapp.com",
  databaseURL: "https://suusokubattle-default-rtdb.firebaseio.com",
  projectId: "suusokubattle",
  storageBucket: "suusokubattle.firebasestorage.app",
  messagingSenderId: "897573122707",
  appId: "1:897573122707:web:72cea311428d09b570d366",
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

/* ---------------- anonymous identity ----------------
 * Every device/browser gets a stable uid (persisted by the Firebase SDK)
 * so we can safely tie a display name + ranking entries to "one person"
 * without any login screen. Requires the "Anonymous" sign-in provider to
 * be enabled in the Firebase console (Authentication > Sign-in method).
 */
let authReadyPromise: Promise<string> | null = null;

export function ensureAuthUid(): Promise<string> {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = new Promise<string>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user: User | null) => {
        if (user) {
          unsub();
          resolve(user.uid);
        }
      },
      (err) => {
        unsub();
        reject(err);
      },
    );
    if (!auth.currentUser) {
      signInAnonymously(auth).catch((err) => {
        unsub();
        reject(err);
      });
    }
  });
  return authReadyPromise;
}

export function getCurrentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}
