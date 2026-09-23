/**
 * JWT (RS256) — Node runtime (cloud-functions)
 * ============================================
 *
 * Topology after migrating to the platform auth scheme:
 *
 *   - Agent routes (`agents/**`) are verified by the **platform edge control
 *     plane** using the public key configured in `edgeone.json → agents.auth`.
 *     Cloud Functions are NOT covered by that gate, so they still verify
 *     tokens themselves — with the **same public key**.
 *   - Cloud Functions are the *issuer*: they hold `JWT_PRIVATE_KEY` and sign
 *     RS256 tokens after a successful login / register.
 *   - The token travels in the `Authorization: Bearer <jwt>` header (the only
 *     place the platform edge layer looks for it), so it must be reachable
 *     from frontend JS — it is no longer an HttpOnly cookie.
 *
 * Why RS256 instead of HS256:
 *   the platform control plane is multi-tenant and only ever stores public
 *   keys; a symmetric secret would let anyone who leaks it mint tokens for
 *   any user. `algorithm` therefore must be an asymmetric one.
 */

import { createSign, createVerify } from 'node:crypto';

const ALG = 'RS256';
const TYP = 'JWT';

export interface JwtPayload {
  sub: string;        // user id (uuid) — written to the `makers-user-id` header by the platform
  username: string;
  iat: number;        // issued-at (seconds)
  exp: number;        // expiry (seconds)
}

// ── base64url helpers ─────────────────────────────────────────

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Env vars cannot hold real newlines, so PEM keys are stored with `\n`
 * escapes. Accept both forms (escaped single-line and raw multi-line).
 */
export function normalizePem(pem: string | undefined | null): string | null {
  if (!pem) return null;
  const trimmed = pem.trim().replace(/^"|"$/g, '').trim();
  if (!trimmed) return null;
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed;
}

// ── public API ────────────────────────────────────────────────

/**
 * JWT TTL — single source of truth, shared by login / register.
 * 3 days: a compromise between short-TTL safety and not logging users out
 * too often.
 */
export const JWT_TTL_SECONDS = 3 * 24 * 60 * 60;

/**
 * Sign a JWT with the RS256 private key. iat / exp are injected automatically.
 *
 * @param payload at minimum `{ sub, username }`
 * @param privateKeyPem PEM private key (`JWT_PRIVATE_KEY`)
 * @param ttlSec  expiry in seconds; defaults to JWT_TTL_SECONDS (3 days)
 */
export function signJwt(
  payload: { sub: string; username: string },
  privateKeyPem: string,
  ttlSec = JWT_TTL_SECONDS,
): string {
  const key = normalizePem(privateKeyPem);
  if (!key) throw new Error('JWT_PRIVATE_KEY is required');
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = {
    sub: payload.sub,
    username: payload.username,
    iat: now,
    exp: now + ttlSec,
  };
  const headerB64 = b64urlEncode(JSON.stringify({ alg: ALG, typ: TYP }));
  const payloadB64 = b64urlEncode(JSON.stringify(full));

  const signer = createSign('RSA-SHA256');
  signer.update(`${headerB64}.${payloadB64}`);
  signer.end();
  const sig = signer.sign(key, 'base64url');

  return `${headerB64}.${payloadB64}.${sig}`;
}

/**
 * Verify a JWT against one or more RS256 public keys (array = key rotation).
 * Throws on any failure — callers decide whether to 401 / redirect.
 */
export function verifyJwt(token: string, publicKeyPem: string | string[]): JwtPayload {
  const keys = (Array.isArray(publicKeyPem) ? publicKeyPem : [publicKeyPem])
    .map(normalizePem)
    .filter((k): k is string => !!k);
  if (keys.length === 0) throw new Error('JWT_PUBLIC_KEY is required');
  if (typeof token !== 'string' || !token) throw new Error('token missing');

  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [headerB64, payloadB64, sigB64] = parts;

  // 1) Header alg (defends against alg=none / algorithm confusion).
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
  } catch {
    throw new Error('header not json');
  }
  if (header.alg !== ALG) throw new Error(`unsupported alg: ${header.alg}`);

  // 2) Signature — try every configured public key (rotation friendly).
  const signed = `${headerB64}.${payloadB64}`;
  const ok = keys.some((key) => {
    try {
      const verifier = createVerify('RSA-SHA256');
      verifier.update(signed);
      verifier.end();
      return verifier.verify(key, sigB64, 'base64url');
    } catch {
      return false;
    }
  });
  if (!ok) throw new Error('signature mismatch');

  // 3) Payload.
  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new Error('payload not json');
  }

  // 4) Expiry.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new Error('token expired');
  }
  return payload;
}

// ── Bearer token extraction ──────────────────────────────────

/**
 * Read `Authorization: Bearer <jwt>` from either:
 *   - a Headers instance (cloud-functions)
 *   - a plain object (Agent runtime / tests)
 */
export function readBearer(
  headers: Headers | Record<string, string | undefined> | undefined | null,
): string | null {
  if (!headers) return null;
  let raw: string | null | undefined;
  if (typeof (headers as Headers).get === 'function') {
    raw = (headers as Headers).get('authorization') ?? (headers as Headers).get('Authorization');
  } else {
    const obj = headers as Record<string, string | undefined>;
    raw = obj['authorization'] ?? obj['Authorization'];
  }
  if (!raw) return null;

  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

// ── High-level helpers ───────────────────────────────────────

/** Thrown by requireAuth on any verification failure. */
export class AuthError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'AuthError';
  }
}

/**
 * Extract & verify the bearer JWT from `context`. Throws AuthError on failure;
 * the caller decides how to respond (typically: unauthorizedResponse).
 *
 * Expected context shape:
 *   - context.request.headers   (Headers | Record)
 *   - context.env.JWT_PUBLIC_KEY
 */
export function requireAuth(context: {
  request: { headers: Headers | Record<string, string | undefined> };
  env?: Record<string, string | undefined>;
}): JwtPayload {
  const publicKey = normalizePem(context.env?.JWT_PUBLIC_KEY ?? process.env?.JWT_PUBLIC_KEY);
  if (!publicKey) throw new AuthError('JWT_PUBLIC_KEY not configured');

  const token = readBearer(context.request.headers);
  if (!token) throw new AuthError('missing bearer token');

  try {
    return verifyJwt(token, publicKey);
  } catch (e) {
    throw new AuthError((e as Error).message || 'verify failed');
  }
}

/** Standard 401 response — reused by every early-reject entry. */
export function unauthorizedResponse(reason = 'unauthorized'): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
