// utils/authTokens.ts
// Token-based authentication for members

export interface LoginToken {
  token: string;
  expiry: string;
}

/**
 * Generate a secure login token for a member
 * @returns LoginToken with token and expiry date
 */
export function generateLoginToken(): LoginToken {
  // Generate a random 32-character token
  const token = generateSimpleToken();
  
  // Set expiry to 24 hours from now
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  
  return {
    token,
    expiry: expiry.toISOString(),
  };
}

/**
 * Validate if a login token is still valid
 * @param tokenExpiry ISO string of token expiry date
 * @returns true if token is valid and not expired
 */
export function isTokenValid(tokenExpiry?: string): boolean {
  if (!tokenExpiry) return false;
  
  const expiryDate = new Date(tokenExpiry);
  const now = new Date();
  
  return expiryDate > now;
}

/**
 * Generate a simple random token
 * @returns Random 32-character token
 */
export function generateSimpleToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Request a login token for a member by email
 * This function creates a token request document that can be processed by admins
 * @param groupId The group ID
 * @param email The member's email address
 * @returns Object with success status and message
 */
export async function requestLoginTokenByEmail(
  groupId: string,
  email: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Route through the shared Firestore helper instead of hand-rolling a
    // doc() call here. The previous version called
    // `doc(db, "pendingTokenRequests", doc(db, "pendingTokenRequests").id)`
    // — the *inner* doc(db, "pendingTokenRequests") is a bare collection
    // name (1 path segment), which Firestore rejects with "Document
    // references must have an even number of segments". createTokenRequest
    // (lib/firestore/tokenRequests.ts) already does this correctly via
    // pendingTokenRequestsCol + doc(pendingTokenRequestsCol) for a valid
    // auto-ID document reference, and keeps this write in one place instead
    // of two implementations that can drift apart.
    const { serverTimestamp } = await import('firebase/firestore');
    const { createTokenRequest } = await import('../lib/firestore/tokenRequests');

    await createTokenRequest({
      groupId,
      email: email.toLowerCase(),
      status: "pending",
      requestedAt: serverTimestamp() as any,
      processedAt: null,
    });

    return {
      success: true,
      message: "Token request submitted successfully. Your group administrator will generate and send your login token via email. This may take a few hours depending on admin availability."
    };
  } catch (error) {
    console.error("[requestLoginTokenByEmail] Error:", error);
    return {
      success: false,
      message: "Failed to submit token request. Please try again or contact your administrator."
    };
  }
}