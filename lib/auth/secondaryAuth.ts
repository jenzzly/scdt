// lib/auth/secondaryAuth.ts
//
// A named secondary Firebase App + Auth instance so an admin can create
// another email/password account (or trigger a password reset for it)
// without replacing the primary session.
//
// ─────────────────────────────────────────────────────────────────────
// PERSISTENCE — READ THIS BEFORE CHANGING
// ─────────────────────────────────────────────────────────────────────
//
// On web, `getAuth(app)` defaults to `browserLocalPersistence`, which
// uses localStorage. When the admin is already signed in on the primary
// instance and we spin up a second one, both instances try to own
// overlapping storage keys and the browser refuses the write — which
// Firebase reports as:
//
//   auth/network-request-failed
//
// That code is misleading: the network is fine (the primary app can
// reach identitytoolkit.googleapis.com). The failure is in the storage
// layer of the second Auth instance.
//
// The fix is to force `inMemoryPersistence` on the secondary instance
// BEFORE the first call. The secondary session only needs to live for
// the duration of a single createUser / sendReset call, so keeping it
// entirely out of localStorage costs nothing and eliminates the
// storage-layer conflict.
//
// Do NOT remove the setPersistence call below — doing so reintroduces
// the network-request-failed bug on web.
// ─────────────────────────────────────────────────────────────────────
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  setPersistence,
  inMemoryPersistence,
  type Auth,
} from "firebase/auth";
import { firebaseConfig } from "../firebase";

const SECONDARY_APP_NAME = "scdt-secondary";

let secondaryAuth: Auth | null = null;
let persistenceReady: Promise<void> | null = null;

/**
 * Returns the secondary Auth instance, initialising it on first call
 * and (on web) forcing in-memory persistence so it can coexist with
 * the primary instance without a storage-layer clash.
 *
 * Idempotent — subsequent calls return the same instance.
 */
export function getSecondaryAuth(): Auth {
  if (secondaryAuth) return secondaryAuth;

  const existing = getApps().find((a) => a.name === SECONDARY_APP_NAME);
  const secondaryApp =
    existing ?? initializeApp(firebaseConfig, SECONDARY_APP_NAME);

  secondaryAuth = getAuth(secondaryApp);

  // setPersistence returns a Promise. We remember it and await it in
  // the call sites below, so the very first call waits for the
  // persistence layer to be ready before issuing an auth request.
  //
  // If the browser refuses (private mode, third-party storage
  // restrictions), we swallow the error — inMemoryPersistence has no
  // external requirements, so the only way this can fail is if the
  // SDK version doesn't export it. In that case we still want the
  // create call to attempt, and let whatever error it produces
  // surface naturally.
  persistenceReady = setPersistence(
    secondaryAuth,
    inMemoryPersistence,
  ).catch((e) => {
    console.warn(
      "[secondaryAuth] setPersistence(inMemory) failed — proceeding:",
      e,
    );
  });

  return secondaryAuth;
}

async function withPersistenceReady<T>(fn: () => Promise<T>): Promise<T> {
  if (persistenceReady) {
    await persistenceReady;
  }
  return fn();
}

/**
 * Retry helper — the secondary auth can produce a genuinely transient
 * `auth/network-request-failed` on the very first call after a cold
 * start. One retry with a short delay clears that case without masking
 * a real failure.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code !== "auth/network-request-failed") throw e;
    console.warn(
      `[secondaryAuth] ${label}: network-request-failed, retrying once…`,
    );
    await new Promise((r) => setTimeout(r, 800));
    return await fn();
  }
}

export async function createUserWithSecondaryAuth(
  email: string,
  password: string,
): Promise<{ uid: string; email: string }> {
  const secondary = getSecondaryAuth();
  const trimmed = email.trim();

  return withPersistenceReady(async () => {
    try {
      const cred = await withRetry(
        () =>
          createUserWithEmailAndPassword(secondary, trimmed, password),
        "createUser",
      );
      return {
        uid: cred.user.uid,
        email: cred.user.email || trimmed,
      };
    } finally {
      // The secondary session exists only to run this one call. Sign
      // it out so a subsequent admin action in the same tab starts
      // clean. Ignored on failure — the primary session must survive.
      try {
        await firebaseSignOut(secondary);
      } catch {
        /* swallow */
      }
    }
  });
}

export async function sendPasswordResetWithSecondaryAuth(
  email: string,
): Promise<void> {
  const secondary = getSecondaryAuth();
  const trimmed = email.trim();

  await withPersistenceReady(async () => {
    await withRetry(
      () => sendPasswordResetEmail(secondary, trimmed),
      "sendReset",
    );
  });
}
