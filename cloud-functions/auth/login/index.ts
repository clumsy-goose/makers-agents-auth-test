/**
 * POST /auth/login — sign in
 * =============================
 *
 * Runtime: Node 20 (cloud-functions/nodejs)
 *
 * Signs an RS256 JWT (private key = JWT_PRIVATE_KEY) and returns it in the
 * response body. The client stores it and calls protected routes with
 * `Authorization: Bearer <jwt>` — the platform edge control plane verifies the
 * signature for Agent routes and injects `makers-user-id`; Cloud Functions
 * verify with the matching public key (JWT_PUBLIC_KEY).
 *
 * Failure modes are blurred together: every wrong-username / wrong-password
 * outcome returns the same 401 `invalid_credentials`, never reveals whether
 * the username exists.
 */

import bcrypt from 'bcryptjs';
import { signJwt, JWT_TTL_SECONDS } from '../../_jwt';
import { findUserByUsername } from '../../_db';
import { validateUsername, validatePassword } from '../../_validate';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' } as const;

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export async function onRequestPost(context: any): Promise<Response> {
  const env = (context.env ?? {}) as Record<string, string | undefined>;
  const privateKey = env.JWT_PRIVATE_KEY;
  if (!privateKey) {
    return jsonResponse({ error: 'server_misconfigured', reason: 'JWT_PRIVATE_KEY missing' }, 500);
  }

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse({ error: 'bad_request', reason: 'invalid json' }, 400);
  }

  // Type guard — keep this so SQL never sees a non-string.
  if (typeof body?.username !== 'string' || typeof body?.password !== 'string') {
    return jsonResponse({ error: 'bad_request', reason: 'username and password required' }, 400);
  }
  // Format check — failure also returns invalid_credentials so attackers
  // cannot tell "format invalid" apart from "wrong credentials".
  const u = validateUsername(body.username);
  const p = validatePassword(body.password);
  if (!u.ok || !p.ok) {
    return jsonResponse({ error: 'invalid_credentials' }, 401);
  }

  const { username, password } = body;

  let user;
  try {
    user = await findUserByUsername(env, username);
  } catch (e) {
    return jsonResponse({ error: 'db_error', reason: (e as Error).message }, 500);
  }

  // Run bcrypt even when the user doesn't exist — keeps the response time
  // identical to the "wrong password" path, so attackers can't enumerate
  // usernames via timing.
  const fakeHash = '$2a$10$abcdefghijklmnopqrstuv1234567890123456789012345678901';
  const hash = user?.password_hash ?? fakeHash;
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) {
    return jsonResponse({ error: 'invalid_credentials' }, 401);
  }

  const token = signJwt({ sub: user.id, username: user.username }, privateKey);

  return jsonResponse({
    ok: true,
    token,
    user: { id: user.id, username: user.username },
    expiresIn: JWT_TTL_SECONDS,
  });
}
