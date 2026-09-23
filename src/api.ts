/**
 * Backend API (EdgeOne Makers)
 *
 * Route mapping (file → route):
 *   agents/chat/index.ts                → POST /chat     Main chat endpoint
 *   agents/stop/index.ts                → POST /stop     Abort the active agent run
 *   cloud-functions/history/index.ts    → POST /history  Get conversation history
 *   cloud-functions/auth/login          → POST /auth/login
 *   cloud-functions/auth/register       → POST /auth/register
 *   cloud-functions/auth/user           → GET  /auth/user
 *   cloud-functions/auth/logout         → POST /auth/logout
 *
 * Protected routes (/chat, /stop are Agent routes behind the platform's
 * `agents.auth` gate; /history, /auth/user verify the same token in the
 * Cloud Function) all expect `Authorization: Bearer <jwt>` — see authHeaders().
 *
 * This file defines all API paths and request wrappers.
 */

import type { Message } from './types';

export const API = {
  chat: '/chat',
  chatStop: '/stop',
  history: '/history',
  authLogin: '/auth/login',
  authRegister: '/auth/register',
  authUser: '/auth/user',
  authLogout: '/auth/logout',
} as const;

// ── Auth helpers ──────────────────────────────────────────────

export interface AuthUser {
  id: string;
  username: string;
}

/**
 * Token storage
 * -------------
 * The platform auth gate (edgeone.json → agents.auth) only reads the
 * `Authorization: Bearer <jwt>` header — it never looks at cookies — so the
 * token has to be reachable from JS. It is kept in localStorage and attached
 * to every protected call. (Trade-off vs. the previous HttpOnly cookie: an XSS
 * on this origin could read the token, so keep dependencies tight and never
 * render untrusted HTML.)
 */
const TOKEN_KEY = 'makers.auth.token';

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token: string | null = readStoredToken();

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) window.localStorage.setItem(TOKEN_KEY, next);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — keep the in-memory copy only */
  }
}

/** Build request headers with the bearer token attached (when present). */
export function authHeaders(init: Record<string, string> = {}): Record<string, string> {
  return token ? { ...init, Authorization: `Bearer ${token}` } : { ...init };
}

/** Thrown on 401 so UI layer can react (typically: open the login modal). */
export class AuthRequiredError extends Error {
  constructor() {
    super('auth_required');
    this.name = 'AuthRequiredError';
  }
}

/** Dispatch the global 401 signal — AuthGate listens for this to open the modal. */
function dispatchAuthRequired(): void {
  // A 401 means the token is gone, expired, or failed verification — drop it
  // so we stop replaying a dead credential on every retry.
  setToken(null);
  window.dispatchEvent(new CustomEvent('eo:auth-required'));
}

/** Generic 401 guard — any business request that gets 401 is treated as session-expired (throwing variant for non-streaming callers). */
function check401<T extends Response>(res: T): T {
  if (res.status === 401) {
    dispatchAuthRequired();
    throw new AuthRequiredError();
  }
  return res;
}

/** Persist the token returned by /auth/login or /auth/register. */
function consumeAuthResponse(data: { token?: string; user?: AuthUser }): AuthUser {
  if (data?.token) setToken(data.token);
  return data.user as AuthUser;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(API.authLogin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `login_failed_${res.status}`);
  }
  return consumeAuthResponse(await res.json() as { token?: string; user?: AuthUser });
}

export async function register(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(API.authRegister, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `register_failed_${res.status}`);
  }
  return consumeAuthResponse(await res.json() as { token?: string; user?: AuthUser });
}

/** Probe the current session — returns null on failure so the UI can render the guest state. */
export async function fetchUser(): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const res = await fetch(API.authUser, { headers: authHeaders() });
    if (!res.ok) {
      if (res.status === 401) setToken(null);
      return null;
    }
    const data = await res.json() as { user?: AuthUser };
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** Drop the token locally; /auth/logout is stateless and just acknowledges. */
export async function logout(): Promise<void> {
  const previous = token;
  setToken(null);
  await fetch(API.authLogout, {
    method: 'POST',
    headers: previous ? { Authorization: `Bearer ${previous}` } : {},
  }).catch(() => undefined);
}

// ── Original API ──────────────────────────────────────────────

export interface RawSseEvent {
  eventType: string;
  data: unknown;
  raw: string;
  timestamp: number;
}

export interface StreamCallbacks {
  onTextDelta: (delta: string) => void;
  onToolCalled: (toolName: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
  onRawEvent?: (event: RawSseEvent) => void;
  /**
   * Called when the session has expired (401). Takes precedence over onError;
   * lets the UI clean up its optimistic placeholder bubble instead of
   * surfacing a misleading "request failed" message.
   */
  onAuthRequired?: () => void;
}

/** Get conversation history for restoring the chat window after page refresh. */
export async function fetchConversationHistory(conversationId: string): Promise<Message[]> {
  const startTime = Date.now();
  console.log(`[History] Request start time: ${new Date(startTime).toLocaleString()}`);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(API.history, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ conversation_id: conversationId }),
      });

      // 401 = session expired, handle uniformly.
      if (res.status === 401) {
        check401(res);
      }

      // 409 = Active request on same conversation (React StrictMode double-render), retry shortly
      if (res.status === 409) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (!res.ok) {
        const endTime = Date.now();
        console.log(`[History] Request end time: ${new Date(endTime).toLocaleString()}`);
        console.log(`[History] Total time: ${endTime - startTime}ms`);
        return [];
      }

      const data = await res.json().catch(() => null) as { messages?: Message[] } | null;
      const endTime = Date.now();
      console.log(`[History] Request end time: ${new Date(endTime).toLocaleString()}`);
      console.log(`[History] Total time: ${endTime - startTime}ms`);
      return Array.isArray(data?.messages) ? data.messages : [];
    } catch {
      const endTime = Date.now();
      console.log(`[History] Request end time: ${new Date(endTime).toLocaleString()}`);
      console.log(`[History] Total time: ${endTime - startTime}ms (aborted with error)`);
      return [];
    }
  }

  const endTime = Date.now();
  console.log(`[History] Request end time: ${new Date(endTime).toLocaleString()}`);
  console.log(`[History] Total time: ${endTime - startTime}ms (retries exhausted)`);
  return [];
}

/**
 * Stream POST /chat via SSE
 * Backend pushes events: text_delta / tool_called / done / error
 *
 * Returns an AbortController the caller can use to abort (or pair with /chat/stop for graceful abort).
 */
export function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  conversationId?: string,
): AbortController {
  const ctrl = new AbortController();

  (async () => {
    try {
      const headers = authHeaders({ 'Content-Type': 'application/json' });
      if (conversationId) {
        headers['makers-conversation-id'] = conversationId;
      }

      const res = await fetch(API.chat, {
        method: 'POST',
        headers,
        body: JSON.stringify({ message }),
        signal: ctrl.signal,
      });

      if (res.status === 401) {
        // Session expired: dispatch the global event so AuthGate opens the modal,
        // call onAuthRequired so the caller can clean up its placeholder bubble,
        // then return without invoking onError — we don't want a misleading
        // "request failed" message in the chat for what is really a sign-in prompt.
        dispatchAuthRequired();
        callbacks.onAuthRequired?.();
        return;
      }

      if (!res.ok) {
        callbacks.onError(new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`));
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError(new Error('ReadableStream not supported'));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let doneReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE format: events separated by \n\n
        const parts = buffer.split('\n\n');
        // Last segment may be incomplete — keep in buffer
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          dispatchSseChunk(
            part,
            callbacks,
            () => { doneReceived = true; },
          );
        }
      }

      // Fallback: trigger done only if backend did not send done event
      if (!doneReceived) {
        callbacks.onDone();
      }
    } catch (err) {
      // AbortError does not trigger error callback
      if (err instanceof DOMException && err.name === 'AbortError') return;
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return ctrl;
}

/** Parse a single SSE event and dispatch to the corresponding callback */
function dispatchSseChunk(
  part: string,
  cb: StreamCallbacks,
  markDone: () => void,
): void {
  let eventType = '';
  let data = '';

  for (const line of part.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  if (!eventType || !data) return;

  try {
    const parsed = JSON.parse(data);

    if (cb.onRawEvent) {
      cb.onRawEvent({
        eventType,
        data: parsed,
        raw: data,
        timestamp: Date.now(),
      });
    }

    switch (eventType) {
      case 'text_delta':
        cb.onTextDelta(parsed.delta);
        break;
      case 'tool_called':
        cb.onToolCalled(parsed.tool);
        break;
      case 'error':
        cb.onError(new Error(parsed.message || 'agent returned error'));
        break;
      case 'done':
        markDone();
        cb.onDone();
        break;
    }
  } catch {
    if (cb.onRawEvent) {
      cb.onRawEvent({
        eventType,
        data: null,
        raw: data,
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * Request the backend to abort the currently running agent
 * (POST /stop, handled by agents/stop/index.ts).
 *
 * Note: the stop request header must NOT carry the same conversation_id as chat,
 * otherwise the runtime will overwrite chat's cancel_event with stop's cancel_event,
 * causing abort_active_run to fail. The target conversation_id is passed only via body.
 */
export async function stopAgent(conversationId?: string): Promise<boolean> {
  try {
    const res = await fetch(API.chatStop, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ conversation_id: conversationId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
