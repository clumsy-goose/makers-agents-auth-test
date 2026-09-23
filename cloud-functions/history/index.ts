/**
 * History handler — EdgeOne Pages Node Function
 * ==============================================
 *
 * File path cloud-functions/history/index.ts maps to **POST /history**.
 *
 * Reads conversation history from `context.agent.store.getMessages()` and
 * returns it to the frontend for restoring the chat window after a page
 * refresh.
 *
 * Two-pass filtering (mirrors the original agents/history/index.ts):
 *   A. Filter out SDK session intermediate items (function_call,
 *      function_call_output, reasoning, etc.) — only keep "message" items.
 *   B. Group by run_id, keeping only the first user message and the last
 *      assistant message per run, so one round-trip = one Q&A pair.
 *
 * Following the official EdgeOne Pages Node Functions docs:
 *   - export `onRequestPost` for POST handlers
 *   - read JSON body via `await context.request.json()`
 *   - return a `Response` object
 *   https://pages.edgeone.ai/document/node-functions
 */

import { createLogger } from '../_logger';
import { requireAuth, AuthError, unauthorizedResponse } from '../_jwt';

const logger = createLogger('history');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=UTF-8' } as const;

interface MemoryMessage {
  messageId?: string;
  role?: string;
  content?: unknown;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

interface FrontendMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function readJsonBody(context: any): Promise<Record<string, unknown>> {
  try {
    const data = await context.request.json();
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function getConversationId(context: any, body: Record<string, unknown>): string {
  const fromBody = body.conversation_id ?? body.conversationId;
  if (typeof fromBody === 'string' && fromBody.trim()) return fromBody.trim();

  // Backwards-compat: also accept the makers-conversation-id header used by /chat.
  try {
    const headerValue = context?.request?.headers?.get?.('makers-conversation-id');
    if (typeof headerValue === 'string' && headerValue.trim()) return headerValue.trim();
  } catch {
    /* noop */
  }
  return '';
}

// ── Content extraction ──────────────────────────────────────

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;

  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const obj = content as Record<string, unknown>;
    if ('content' in obj) return contentToText(obj.content);
    if ('output' in obj) return contentToText(obj.output);
    if ('text' in obj) return String(obj.text ?? '');
    return '';
  }

  if (Array.isArray(content)) {
    return content
      .filter((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object',
      )
      .map(item => String(item.text ?? item.output_text ?? ''))
      .filter(Boolean)
      .join('\n');
  }

  return String(content);
}

// ── Handler ─────────────────────────────────────────────────

export async function onRequestPost(context: any): Promise<Response> {
  // /history is a Cloud Function, not an Agent route — the platform's
  // `agents.auth` gate does not cover it, so verify the bearer JWT here.
  let auth;
  try {
    auth = requireAuth(context);
  } catch (e) {
    if (e instanceof AuthError) {
      logger.log(`[auth] reject: ${e.reason}`);
      return unauthorizedResponse(e.reason);
    }
    throw e;
  }
  logger.log(`[auth] ok: user=${auth.username} (${auth.sub})`);

  const requestStartTime = Date.now();
  logger.log(`[history] start: ${new Date(requestStartTime).toISOString()}`);

  const body = await readJsonBody(context);
  const conversationId = getConversationId(context, body);
  const store = context.agent?.store ?? null;

  logger.log('conversationId:', conversationId || '-');

  if (!store || !conversationId) {
    logger.log(
      `[history] end: ${new Date().toISOString()}, total: ${Date.now() - requestStartTime}ms (no store or conversationId)`,
    );
    return jsonResponse({ conversation_id: conversationId, messages: [] });
  }

  try {
    const storeStartTime = Date.now();
    logger.log(`[history] store.getMessages start: ${new Date(storeStartTime).toISOString()}`);

    const history: MemoryMessage[] = await store.getMessages({
      conversationId,
      limit: 100,
      order: 'asc',
    });

    const storeEndTime = Date.now();
    logger.log(
      `[history] store.getMessages end: ${new Date(storeEndTime).toISOString()}, duration: ${storeEndTime - storeStartTime}ms (records: ${history.length})`,
    );

    // Single-pass: filter SDK intermediate items + group by run_id
    const messages: FrontendMessage[] = [];
    const groups = new Map<
      string,
      { user: FrontendMessage | null; assistant: FrontendMessage | null; order: number }
    >();

    for (const item of history) {
      const role = item.role;
      if (role !== 'user' && role !== 'assistant') continue;

      const meta = item.metadata ?? {};
      if (meta.agent_sdk_session) {
        const itemType = meta.item_type as string | null | undefined;
        if (itemType != null && itemType !== 'message') continue;
      }

      const content = contentToText(item.content);
      if (!content) continue;

      const msg: FrontendMessage = {
        id: item.messageId ?? `${role}-${item.createdAt ?? 0}`,
        role,
        content,
        timestamp: item.createdAt ?? 0,
      };

      const runId = meta.run_id as string | undefined;
      if (!runId) {
        messages.push(msg);
        continue;
      }

      if (!groups.has(runId)) {
        groups.set(runId, { user: null, assistant: null, order: groups.size });
      }

      const group = groups.get(runId)!;
      if (role === 'user' && group.user === null) {
        group.user = msg;
      } else if (role === 'assistant') {
        group.assistant = msg;
      }
    }

    const sorted = [...groups.values()].sort((a, b) => a.order - b.order);
    for (const group of sorted) {
      if (group.user) messages.push(group.user);
      if (group.assistant) messages.push(group.assistant);
    }

    logger.log(
      `[history] end: ${new Date().toISOString()}, total: ${Date.now() - requestStartTime}ms (returned ${messages.length} messages)`,
    );

    return jsonResponse({ conversation_id: conversationId, messages });
  } catch (e) {
    logger.error('failed to get messages:', e);
    logger.log(`[history] end: ${new Date().toISOString()}, total: ${Date.now() - requestStartTime}ms (error)`);
    return jsonResponse({ conversation_id: conversationId, messages: [] });
  }
}
