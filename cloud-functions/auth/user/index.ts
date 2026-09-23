/**
 * GET /auth/user — return the currently signed-in user
 * (used by the front end to rehydrate session state after a page refresh).
 *
 * Auth topology:
 *   `/auth/*` are Cloud Functions, NOT Agent routes — the platform's
 *   `agents.auth` gate does not cover them. This function is therefore the
 *   only auth gate on this path and must verify the bearer JWT itself
 *   (RS256, public key = JWT_PUBLIC_KEY).
 */

import { requireAuth, AuthError, unauthorizedResponse } from '../../_jwt';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' } as const;

export async function onRequestGet(context: any): Promise<Response> {
  let payload;
  try {
    payload = requireAuth(context);
  } catch (e) {
    if (e instanceof AuthError) return unauthorizedResponse(e.reason);
    throw e;
  }

  return new Response(
    JSON.stringify({
      ok: true,
      user: { id: payload.sub, username: payload.username },
      exp: payload.exp,
    }),
    { status: 200, headers: JSON_HEADERS },
  );
}

// Some clients refresh the session via POST — accept that too.
export const onRequestPost = onRequestGet;
