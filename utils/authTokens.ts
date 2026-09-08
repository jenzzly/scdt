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