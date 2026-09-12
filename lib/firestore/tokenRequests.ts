// lib/firestore/tokenRequests.ts
// Token request management for login tokens

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  pendingTokenRequestsCol,
  stripUndefined,
  fromSnap,
} from "./core";

import type { NewRecord } from "./core";
import type { Timestamp } from "firebase/firestore";

export interface TokenRequest {
  id: string;
  groupId: string;
  email: string;
  status: "pending" | "processed" | "cancelled";
  requestedAt: Date | null;
  processedAt: Date | null;
}

export type NewTokenRequest = NewRecord<TokenRequest>;

function toDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as Timestamp).toDate === "function"
  ) {
    return (value as Timestamp).toDate();
  }

  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function normalizeTokenRequest(
  request: TokenRequest
): TokenRequest {
  return {
    ...request,
    requestedAt: toDate(request.requestedAt),
    processedAt: toDate(request.processedAt),
  };
}

/**
 * Create a token request
 */
export async function createTokenRequest(
  data: NewTokenRequest
): Promise<string> {
  const dRef = data.id
    ? doc(pendingTokenRequestsCol, data.id)
    : doc(pendingTokenRequestsCol);

  const id = dRef.id;

  await setDoc(
    dRef,
    {
      ...stripUndefined(data as any),
      id,
    }
  );

  return id;
}

/**
 * Get all pending token requests for a group
 */
export async function getPendingTokenRequests(
  groupId: string
): Promise<TokenRequest[]> {
  const q = query(
    pendingTokenRequestsCol,
    where("groupId", "==", groupId),
    where("status", "==", "pending"),
    orderBy("requestedAt", "asc")
  );

  const snap = await getDocs(q);

  return snap.docs.map((s) =>
    normalizeTokenRequest(fromSnap<TokenRequest>(s))
  );
}

/**
 * Get a token request by ID
 */
export async function getTokenRequest(
  id: string
): Promise<TokenRequest | null> {
  const snap = await getDoc(
    doc(pendingTokenRequestsCol, id)
  );

  if (!snap.exists()) {
    return null;
  }

  return normalizeTokenRequest(
    fromSnap<TokenRequest>(snap)
  );
}

/**
 * Update token request status
 */
export async function updateTokenRequest(
  id: string,
  data: Partial<TokenRequest>
): Promise<void> {
  await updateDoc(
    doc(pendingTokenRequestsCol, id),
    stripUndefined(data as any)
  );
}

/**
 * Delete a token request
 */
export async function deleteTokenRequest(
  id: string
): Promise<void> {
  await deleteDoc(
    doc(pendingTokenRequestsCol, id)
  );
}

/**
 * Subscribe to pending token requests for a group
 */
export function subscribePendingTokenRequests(
  groupId: string,
  cb: (requests: TokenRequest[]) => void,
  onError?: (error: unknown) => void,
): () => void {
  const q = query(
    pendingTokenRequestsCol,
    where("groupId", "==", groupId),
    where("status", "==", "pending"),
    orderBy("requestedAt", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs.map((s) =>
        normalizeTokenRequest(
          fromSnap<TokenRequest>(s)
        )
      );

      cb(requests);
    },
    onError,
  );
}