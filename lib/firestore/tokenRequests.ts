// lib/firestore/tokenRequests.ts
//
// Stubs for the removed token-based login flow. See utils/authTokens.ts
// for the replacement. Kept on disk so app/group-settings.tsx's dead
// Token Requests section still compiles.
import { onSnapshot } from "./core";

/**
 * No-op listener for the removed pendingTokenRequests collection.
 * Returns an unsubscribe function so callers that wire it into a
 * useEffect cleanup don't crash. Logs once per call so a re-enabled
 * flow is immediately visible in the console.
 */
export function subscribePendingTokenRequests(
  _groupId: string,
  _onData: (requests: any[]) => void,
  _onError?: (err: unknown) => void,
): () => void {
  console.warn(
    "[tokenRequests] subscribePendingTokenRequests is a stub — " +
      "the token flow is disabled. This listener does nothing.",
  );
  // Silence the unused import warning by referencing onSnapshot
  // in a dead branch. No Firestore call actually runs.
  if (false as boolean) {
    onSnapshot;
  }
  return () => {};
}

/**
 * No-op updater. Throws so a re-enabled flow fails loudly instead
 * of silently discarding a status transition.
 */
export async function updateTokenRequest(
  _id: string,
  _data: any,
): Promise<void> {
  throw new Error(
    "Token requests are disabled. Use admin-initiated account " +
      "creation instead.",
  );
}
