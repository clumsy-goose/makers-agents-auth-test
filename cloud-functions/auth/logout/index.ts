/**
 * POST /auth/logout — stateless sign-out
 *
 * The JWT now lives in browser storage (it must be readable by JS so it can be
 * sent as `Authorization: Bearer <jwt>`), so there is no server-side session
 * and no cookie to clear: the client just drops the token.
 *
 * This endpoint is kept so the frontend has one place to call on sign-out
 * (and so a future token blacklist has an insertion point). It requires no
 * token — an expired or missing one must never block signing out.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' } as const;

export async function onRequestPost(_context: any): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: JSON_HEADERS,
  });
}
