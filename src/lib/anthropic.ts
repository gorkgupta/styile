import 'server-only';
import { env } from './env';
import type { LlmRequest, LlmResponse } from './whatsapp/engine';

/** Minimal Claude Messages API client (fetch-based so it runs on Cloudflare Workers). */
export async function callClaude(req: LlmRequest): Promise<LlmResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.anthropicKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.anthropicModel(),
      max_tokens: 700,
      temperature: 0.3,
      system: req.system,
      messages: req.messages,
      tools: req.tools,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as LlmResponse;
  return { stop_reason: json.stop_reason, content: json.content ?? [] };
}
