/**
 * Agent handler — EdgeOne Makers
 * ========================================
 *
 * File path agents/chat/index.ts maps to **POST /chat**
 * (EdgeOne Makers routing convention: directory name = route, index = default entry)
 *
 * Files starting with _ (e.g. _tools.ts, _sse.ts) are private modules,
 * not mapped as public routes.
 *
 * context convention:
 *   context.request.body    — object, request body
 *   context.request.signal  — AbortSignal, set when /chat/stop is called
 *   conversation_id — conversation ID
 *   context.runId           — current run ID
 */

import OpenAI from 'openai';
import { run, Agent, OpenAIChatCompletionsModel, type Session } from '@openai/agents';
import { createLogger } from '../_logger';
import { createTools } from '../_tools';
import { sseResponse } from '../_sse';
import { requireUserId, AuthError, unauthorizedResponse } from '../_jwt';

const logger = createLogger('chat');
const DEFAULT_MODEL = '@makers/hy3-preview';

export async function onRequest(context: any) {

  // The platform edge control plane already verified the RS256 JWT and wrote
  // `sub` into the makers-user-id header — just read it (never trust a
  // client-sent value: the edge layer strips it).
  let userId: string;
  try {
    userId = requireUserId(context);
  } catch (e) {
    if (e instanceof AuthError) {
      logger.log(`[auth] reject: ${e.reason}`);
      return unauthorizedResponse(e.reason);
    }
    throw e;
  }
  logger.log(`[auth] ok: user=${userId}`);

  const message = (context.request.body ?? {}).message as string | undefined;
  if (!message) {
    return new Response(
      JSON.stringify({ error: "'message' is required" }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const signal: AbortSignal | undefined = context.request.signal;

  // Use built-in store session adapter for persistence
  const session: Session | undefined =
    context.store && context.conversation_id ? context.store.openaiSession(context.conversation_id) : undefined;

  // Configure the OpenAI-compatible LLM model directly from runtime env.
  const env = (context.env ?? {}) as Record<string, string | undefined>;
  const llmClient = new OpenAI({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseURL: env.AI_GATEWAY_BASE_URL,
  });
  const model = new OpenAIChatCompletionsModel(
    llmClient,
    DEFAULT_MODEL,
  );

  // Create OpenAI Agent
  const agent = new Agent({
    name: 'Assistant',
    instructions:
      'You are an EdgeOne Makers OpenAI Agents SDK (TypeScript) starter example: an out-of-the-box Agent template that helps developers quickly run through and validate platform capabilities.\n' +
      'When introducing yourself, clearly say that you are a demo Agent built with OpenAI Agents SDK on EdgeOne Makers, designed to showcase four things for developers: login auth integration (platform JWT auth at the edge + Cloud Functions issuing RS256 tokens), custom tools, streaming responses, and session memory.\n' +
      'Use the four custom tools when they help you answer the user concretely. Otherwise answer directly and keep the response brief.',
    tools: createTools(),
    model: model,
  });

  // Map an SDK stream event to a business SSE event, or null to skip.
  const toSseEvent = (e: any) => {
    if (e.type === 'raw_model_stream_event' && e.data?.type === 'output_text_delta') {
      const delta = e.data.delta as string;
      logger.log(`[stream] text_delta: ${JSON.stringify(delta)}`);
      return { event: 'text_delta', data: { delta } };
    }
    if (e.type === 'run_item_stream_event' && e.name === 'tool_called') {
      const tool = e.item?.name ?? e.item?.rawItem?.name;
      if (tool) {
        logger.log(`[stream] tool_called: ${tool}`);
        return { event: 'tool_called', data: { tool } };
      }
    }
    return null;
  };

  // Convert SDK stream events into business SSE events.
  return sseResponse(
    async function* () {
      yield {
        event: 'auth_ok',
        data: {
          layer: 'platform',
          userId,
          ts: Date.now(),
        },
      };

      const sessionAgent = new Agent({
        name: agent.name,
        instructions: `${agent.instructions}\n\nCurrently signed-in user id: ${userId}.`,
        tools: agent.tools,
        model: agent.model,
      });

      const result = await run(sessionAgent, message, { stream: true, signal, session });
      for await (const event of result.toStream()) {
        if (signal?.aborted) break;
        const sse = toSseEvent(event);
        if (sse) yield sse;
      }
    },
    { signal, logger },
  );
}
