/**
 * Verified identity — Agent Runtime
 * =================================
 *
 * With `edgeone.json → agents.auth` enabled, the platform edge control plane
 * verifies the RS256 JWT before the request ever reaches this runtime:
 *
 *   1. signature + `exp` are checked at the edge (401 on failure — the entry
 *      function is never invoked);
 *   2. `sub` is extracted and written to the **`makers-user-id`** request header;
 *   3. any client-supplied `makers-user-id` header is stripped unconditionally.
 *
 * So the Agent must NOT parse or verify the token itself — it just reads the
 * header. No public key, no secret, no duplicated verification logic here.
 */

/** Header written by the platform edge control plane after a successful verify. */
export const USER_ID_HEADER = 'makers-user-id';

/** Thrown by requireUserId when no verified identity is present. */
export class AuthError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'AuthError';
  }
}

/**
 * Read the verified user id from `context`.
 *
 * Returns null when auth is not enabled (or the request somehow bypassed the
 * gate) — callers decide whether that means "anonymous" or "reject".
 *
 * Synchronous: header access never needs `await`.
 */
export function getVerifiedUserId(context: {
  request?: { headers?: Headers | Record<string, string | undefined> | null } | null;
}): string | null {
  const headers = context?.request?.headers;
  if (!headers) return null;

  let raw: string | null | undefined;
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get(USER_ID_HEADER);
  } else {
    const obj = headers as Record<string, string | undefined>;
    raw = obj[USER_ID_HEADER] ?? obj['Makers-User-Id'];
  }

  const value = raw?.trim();
  return value ? value : null;
}

/**
 * Same as getVerifiedUserId, but throws AuthError instead of returning null.
 * Use in entries that must never run anonymously (/chat, /stop, …).
 */
export function requireUserId(context: {
  request?: { headers?: Headers | Record<string, string | undefined> | null } | null;
}): string {
  const userId = getVerifiedUserId(context);
  if (!userId) throw new AuthError('unauthenticated');
  return userId;
}

/** Standard 401 response — reused by every early-reject entry. */
export function unauthorizedResponse(reason = 'unauthorized'): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
