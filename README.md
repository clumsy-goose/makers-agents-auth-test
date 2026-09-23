# Agents Login Auth Starter

> A streaming chat agent template built with the **OpenAI Agents SDK** on EdgeOne Makers — with end-to-end authentication powered by the **platform auth gate (`agents.auth`)**: the edge control plane verifies the JWT and injects `makers-user-id`, Cloud Functions handle sign-in and RS256 token issuing, and the user store lives in Neon Postgres.

**Framework:** OpenAI Agents SDK · **Category:** Quick Start · **Language:** TypeScript

[![Deploy to EdgeOne Makers](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/makers/new?template=makers-agents-auth&from=within&fromAgent=1&agentLang=typescript)

## Overview

Agent applications typically call models and tools. Without login authentication, anyone can hit the Agent endpoints directly, which leads to:

- **Resource abuse** — anonymous traffic burns through your LLM and tool-call quota.
- **Endpoint bypass** — attackers skip the frontend page and call `/chat`, `/stop` and other endpoints directly.

This template uses the **Makers platform auth gate**: you declare `agents.auth` in `edgeone.json`, the platform's edge control plane verifies the JWT and forwards the verified identity in the `makers-user-id` request header. Your runtime code never parses or validates a token — it just reads that header to get an identity that is already verified and cannot be forged. Sign-in and token issuing stay in Cloud Functions.

### Platform auth vs. the edge-middleware approach

| | Platform auth (current) | Edge middleware (previous) |
| --- | --- | --- |
| Where verification happens | Platform edge control plane — zero code in the project | Your own `middleware.js` (Edge V8 + Web Crypto) |
| Routes covered | **All** Agent routes in the project (incl. `/mcp`) | Paths hand-listed in `middleware.config.matcher` |
| Algorithm | Asymmetric only (`RS256` / `ES256`) | Symmetric `HS256` (shared secret) |
| What the Agent does | Reads `makers-user-id` — **no verification** | Re-verifies the JWT with the shared secret |
| Key distribution | Platform holds public keys only; the private key stays in your issuer | One shared secret duplicated across middleware / cf / agent |
| 401 behaviour | Returned by the control plane; the request never reaches the runtime | Returned by the middleware |
| Forgery protection | Any client-sent `makers-user-id` is stripped unconditionally | Depends on each layer verifying correctly |

## Project Files & Responsibilities

| File / Module               | Responsibility                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `edgeone.json`            | `agents.auth` — turns on platform JWT auth and holds the verification public key(s)               |
| `cloud-functions/auth/*`  | Login, register, logout, current user — verifies credentials and signs RS256 JWTs                 |
| `cloud-functions/history` | Conversation history (a Cloud Function, so it verifies the token itself)                          |
| `agents/chat/index.ts`    | Agent entry — reads `makers-user-id` and streams the LLM response                                 |
| `agents/stop/index.ts`    | Aborts the active run; also requires a verified identity                                          |
| `agents/_jwt.ts`          | Helpers for reading the platform-verified identity (`getVerifiedUserId` / `requireUserId`)        |
| `db/migrations/users.sql` | Neon database schema                                                                               |

## How It Works

### Core flow

```text
Browser
   │
   │  Login / Register
   ▼
cloud-functions/auth/*
   │  Verify credentials
   │  Read / write Neon
   │  Sign an RS256 JWT with JWT_PRIVATE_KEY
   ▼
Browser stores the token (readable by JS so it can build the Authorization header)
   │
   │  Call Agent: Authorization: Bearer <jwt>
   ▼
Platform edge control plane (security boundary — verification only happens here)
   │  Verify signature + exp → 401 on failure
   │  Write sub into the makers-user-id header (client-supplied values are stripped)
   ▼
Agent Runtime
   │  context.request.headers.get('makers-user-id')
   ▼
SSE stream / Agent response
```

### JWT payload

```ts
interface JwtPayload {
  sub: string;       // users.id, UUID v4 — the platform copies this into makers-user-id
  username: string;  // username (business only; the platform ignores it)
  iat: number;       // issued-at, seconds since epoch
  exp: number;       // expires-at, seconds since epoch (checked by the platform)
}
```

`sub` and `exp` are the claims the platform requires; feel free to add business claims, but only `sub` is forwarded.

## Request Flows

### Login / Register

```text
Browser
  │
  │ ① POST /auth/login or /auth/register
  ▼
cloud-functions/auth/*
  │
  │ ② Validate username / password
  │ ③ Read or write the Neon users table
  │ ④ bcrypt verify or hash password_hash
  │ ⑤ Sign an RS256 JWT with JWT_PRIVATE_KEY
  ▼
Browser
  │
  │ ⑥ Response carries { token, user } — the frontend stores the token
  ▼
Signed in
```

Key rules:

- `/auth/*` are Cloud Functions and are **not** covered by the platform gate (which only protects Agent routes), so they must stay public.
- The token is returned in the body, and the frontend attaches it as `Authorization: Bearer <jwt>`.

### Agent call

```text
Browser
  │
  │ ⑦ POST /chat with Authorization: Bearer <jwt>
  ▼
Platform edge control plane
  │
  │ ⑧ Verify with the public key from edgeone.json (RS256)
  │    Failure → 401, the request never reaches the Agent runtime
  │    Success → inject makers-user-id and forward
  ▼
Agent Runtime
  │
  │ ⑨ requireUserId(context) reads the header
  ▼
Browser
  │
  │ ⑩ SSE stream of the Agent response
```

Key rules:

- The Agent does **not** verify anything and holds no key — it trusts the platform-injected header.
- Failed verification is rejected at the edge; business code never sees those requests.

## Platform Auth Configuration

File: `edgeone.json`

```json
{
  "agents": {
    "auth": {
      "type": "jwt",
      "algorithm": "RS256",
      "verificationKeys": [
        "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...（public key, real newlines escaped as \\n）...\n-----END PUBLIC KEY-----"
      ]
    }
  }
}
```

### Field reference

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `type` | string | Yes | - | Always `"jwt"`. Without `agents.auth`, the Agent is public and no identity check happens |
| `algorithm` | string | No | `RS256` | Verification algorithm. **Asymmetric only** (`RS256` / `ES256`); `HS256` fails deployment validation |
| `verificationKeys` | string[] | Yes | - | Public keys (PEM), tried in array order — the first one that verifies passes |

Real newlines inside the PEM must be written as `\n` in JSON. Converting by hand is error-prone, so use:

```bash
# Generate the keypair
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem

# Convert to a single escaped line you can paste into JSON
awk '{printf "%s\\n", $0}' public_key.pem
```

You must **redeploy** the project for config changes to take effect.

> **Caution: changing this config affects live traffic.** Once auth is on, requests without a valid token are rejected with 401 — make sure your clients send tokens before rolling out.

## Cloud Functions — Key Implementation

Directory: `cloud-functions/`

Responsibility: register / login / current user / logout + issuing RS256 tokens.

### File layout

| File                       | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `auth/register/index.ts` | Register a new user, write to Neon, return a token |
| `auth/login/index.ts`    | Verify the password, return a token              |
| `auth/user/index.ts`     | Identify the current user from the bearer token  |
| `auth/logout/index.ts`   | Stateless sign-out (the client drops the token)  |
| `history/index.ts`       | `POST /history` — self-verified chat history     |
| `_jwt.ts`                | RS256 sign / verify + bearer header parsing      |
| `_db.ts`                 | Neon HTTPS client                                |
| `_validate.ts`           | username / password format guards                |

### Signing

```ts
import { createSign } from 'node:crypto';

const signer = createSign('RSA-SHA256');
signer.update(`${headerB64}.${payloadB64}`);
signer.end();
const sig = signer.sign(privateKeyPem, 'base64url');
```

The private key comes from `JWT_PRIVATE_KEY`; the public key (`JWT_PUBLIC_KEY`) is used by the Cloud Functions for self-verification and is the same key configured in `edgeone.json`.

> Cloud Functions are **not** inside the `agents.auth` perimeter — the platform gate only covers Agent routes. So `/auth/user` and `/history` still call `requireAuth(context)` and verify with the public key themselves.

## Agent — Key Implementation

Example file: `agents/chat/index.ts`

Verification already happened upstream, so the Agent needs no key at all:

```ts
import { requireUserId, AuthError, unauthorizedResponse } from '../_jwt';

export async function onRequest(context: any) {
  let userId: string;
  try {
    userId = requireUserId(context); // reads makers-user-id — verified, unforgeable
  } catch (e) {
    if (e instanceof AuthError) {
      return unauthorizedResponse(e.reason);
    }
    throw e;
  }
  // From here on, run the Agent business logic
}
```

`userId` answers "who are you" (guaranteed by the platform). "What may you do" belongs to your own permission system — the platform does not provide it.

## Database — Setup & Schema

Neon is Serverless Postgres. This template stores the user table there and accesses it over HTTPS via `@neondatabase/serverless`. You can swap in any other Postgres-compatible database.

### Setup steps

1. Create a project in the [Neon console](https://console.neon.tech/)
2. Copy the connection string — it looks like:

   ```text
   postgresql://<user>:<password>@<host>/<db>?sslmode=require
   ```
3. Configure `DATABASE_URL`, `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in your EdgeOne Makers project's environment variables. For local development, set the same names in `.env`.

### Table schema

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(64)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq
  ON users (LOWER(username));
```

Notes:

- `id` is generated by Postgres `gen_random_uuid()` and becomes the JWT `sub`
- `password_hash` stores only the bcrypt hash — never the plain password
- The `LOWER(username)` unique index prevents `Alice` and `alice` from registering side by side

## Environment Variables

| Variable                | Required | Description                                                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY`  | Yes      | Model gateway API key. Use your **Makers Models API Key** or any OpenAI-compatible provider key |
| `AI_GATEWAY_BASE_URL` | Yes      | Gateway base URL. For Makers Models, use `https://ai-gateway.edgeone.link/v1`                    |
| `JWT_PRIVATE_KEY`     | Yes      | RS256 private key (PEM) — used only by Cloud Functions to sign tokens; never ship it to clients  |
| `JWT_PUBLIC_KEY`      | Yes      | RS256 public key (PEM) — used by Cloud Functions to verify; the same key goes into `edgeone.json` |
| `DATABASE_URL`        | Yes      | Neon Postgres HTTPS connection string (`postgresql://...?sslmode=require`)                      |

### How to get `AI_GATEWAY_API_KEY`

1. Open the [Makers Console](https://console.tencentcloud.com/edgeone/makers).
2. Sign in and enable Makers.
3. Go to **Makers → Models → API Key** and create a key.
4. Copy it into `AI_GATEWAY_API_KEY` (set `AI_GATEWAY_BASE_URL` to `https://ai-gateway.edgeone.link/v1`).

Built-in models (`@makers/deepseek-v4-flash`, `@makers/hy3-preview`, `@makers/minimax-m2.7`) are free and rate-limited — great for prototyping. For production, bind your own provider key (BYOK) in the console.

### How to generate the keypair

```bash
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
# Env vars cannot hold real newlines — convert to a single \n-escaped line:
awk '{printf "%s\\n", $0}' private_key.pem
awk '{printf "%s\\n", $0}' public_key.pem
```

Keep the private key in the Cloud Functions environment only; put the public key into both `JWT_PUBLIC_KEY` and `edgeone.json → agents.auth.verificationKeys`.

## Local Development

**Prerequisites:** Node.js, npm

```bash
npm install
cp .env.example .env
# fill in JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, DATABASE_URL, AI_GATEWAY_*
edgeone makers dev
```

Open `http://localhost:8080/agent-metrics` for the local observability panel.

> One command starts the full stack — `edgeone makers dev` spawns the Vite dev server as a child process and routes cloud-functions / agents through the same port. Don't run `npm run dev` separately.

## Project Structure

```text
makers-agent-auth/
├── edgeone.json                     # agents.auth — platform JWT auth + verification public key
├── agents/
│   ├── chat/index.ts                # POST /chat — read makers-user-id + LLM stream
│   ├── stop/index.ts                # POST /stop — abort an active run (identity required)
│   ├── _jwt.ts                      # Platform-verified identity helpers (no local verify)
│   ├── _logger.ts
│   ├── _sse.ts                      # SSE response helper
│   └── _tools.ts                    # Custom tools (weather, translate, stats, …)
├── cloud-functions/
│   ├── auth/
│   │   ├── login/index.ts           # POST /auth/login    — bcrypt verify + sign RS256 JWT
│   │   ├── register/index.ts        # POST /auth/register — bcrypt hash + insert + sign JWT
│   │   ├── user/index.ts            # GET  /auth/user     — current user + exp
│   │   └── logout/index.ts          # POST /auth/logout   — stateless sign-out
│   ├── history/index.ts             # POST /history       — self-verified conversation history
│   ├── _jwt.ts                      # node:crypto RS256 sign / verify + bearer parsing
│   ├── _db.ts                       # Neon HTTPS client
│   ├── _validate.ts                 # username / password format guards
│   └── _logger.ts
├── db/migrations/
│   └── users.sql                    # users table schema
├── src/                             # Vite + React frontend
│   ├── auth/
│   │   ├── AuthGate.tsx             # Auth context + on-demand login modal
│   │   ├── UserPill.tsx             # Header user badge + sign-out menu
│   │   └── SignInButton.tsx         # Guest header CTA — opens the login modal
│   ├── components/                  # Chat UI components
│   ├── i18n/                        # zh / en strings
│   └── api.ts                       # Browser → backend wrappers + bearer header + 401 interceptor
├── scripts/
│   └── db-check.mjs                 # Neon connection probe
└── package.json
```

> Files prefixed with `_` are private modules — not exposed as public routes by EdgeOne.

## Integration Steps

To bolt this auth scheme onto your own Agent project, follow this order:

1. Generate an RS256 keypair and put the public key into `edgeone.json → agents.auth.verificationKeys`
2. Create a Neon database and run `db/migrations/users.sql`
3. Configure `DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`
4. Copy `cloud-functions/auth/*`, `cloud-functions/_jwt.ts`, `cloud-functions/_db.ts`, `cloud-functions/_validate.ts`
5. Read `makers-user-id` via `requireUserId(context)` at the top of every Agent entry
6. Have clients call the Agent with `Authorization: Bearer <token>`
7. Redeploy so `agents.auth` takes effect

## Constraints

1. Verification failures (bad signature, expired token, …) are rejected by the **edge control plane** with `401`; the request never reaches the Agent runtime, so business code needs no handling.
2. `algorithm` must be asymmetric — `HS256` fails deployment validation.
3. Platform auth only covers Agent routes; Cloud Functions (e.g. `/history`, `/auth/user`) must verify tokens themselves.
4. Without `agents.auth` the Agent is fully public and `makers-user-id` is always empty (session isolation degrades to a random conversation-id).
5. `agents.auth` changes require a redeploy.
6. Because the token travels in the `Authorization` header, the frontend must be able to read it (this template stores it in `localStorage`). Compared with an HttpOnly cookie this raises XSS exposure — keep dependencies tight and never render untrusted HTML.

## Resources

* [EdgeOne Makers Agents — Documentation](https://pages.edgeone.ai/document/agents)
* [EdgeOne Makers — Quick Start](https://pages.edgeone.ai/document/agents-quickstart)
* [Makers Models](https://pages.edgeone.ai/document/models)

## License

MIT
