/**
 * POST /auth/register — sign up
 * ================================
 *
 * Runtime: Node 20 (cloud-functions/nodejs)
 *
 * Flow:
 *   1. Look up `users` via @neondatabase/serverless tag-template SQL
 *   2. If username already taken → 409
 *   3. bcrypt hash + INSERT + node:crypto signs an RS256 JWT
 *   4. Returns 200 with `{ token, user }` — the client sends it back as
 *      `Authorization: Bearer <jwt>` (platform auth reads that header)
 */

import bcrypt from 'bcryptjs';
import { signJwt, JWT_TTL_SECONDS } from '../../_jwt';
import { findUserByUsername, createUser } from '../../_db';
import { validateUsername, validatePassword } from '../../_validate';

// Balances bcrypt cost against cold-start latency.
const BCRYPT_COST = 10;

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

  const u = validateUsername(body?.username);
  if (!u.ok) return jsonResponse({ error: 'invalid_username', reason: u.reason }, 400);

  const p = validatePassword(body?.password);
  if (!p.ok) return jsonResponse({ error: 'invalid_password', reason: p.reason }, 400);

  const username: string = body.username;
  const password: string = body.password;

  // Uniqueness check — also enforced at the DB level by users_username_lower_uniq
  // (so a concurrent insert race still gets caught).
  try {
    const existing = await findUserByUsername(env, username);
    if (existing) {
      return jsonResponse({ error: 'username_taken' }, 409);
    }
  } catch (e) {
    return jsonResponse({ error: 'db_error', reason: (e as Error).message }, 500);
  }

  let user;
  try {
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    user = await createUser(env, username, hash);
  } catch (e) {
    return jsonResponse({ error: 'register_failed', reason: (e as Error).message }, 500);
  }

  const token = signJwt({ sub: user.id, username: user.username }, privateKey);

  return jsonResponse({
    ok: true,
    token,
    user: { id: user.id, username: user.username },
    expiresIn: JWT_TTL_SECONDS,
  });
}
