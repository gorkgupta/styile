import 'server-only';
import { env } from '@/lib/env';

// Thin client for the WhatsApp Cloud API (graph.facebook.com). One salon = one phone number id.

import { toGraphPayload, type OutgoingMessage } from './cloud-api-payload';
export { toGraphPayload, type OutgoingMessage };

export class WhatsAppError extends Error {
  constructor(message: string, public code?: number, public details?: unknown) { super(message); }
}

/** Sends one message; returns the WhatsApp message id. */
export async function sendWhatsApp(phoneNumberId: string, accessToken: string, to: string, m: OutgoingMessage): Promise<string> {
  if (!accessToken) throw new WhatsAppError('WhatsApp is not connected for this salon (no access token).');
  const res = await fetch(`https://graph.facebook.com/${env.waGraphVersion()}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toGraphPayload(to, m)),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string; code: number } };
  if (!res.ok || !json.messages?.[0]?.id) {
    const code = json.error?.code;
    const msg = code === 131047 ? 'More than 24 hours have passed since the client last messaged, so only a template message can be sent.'
      : code === 131026 ? 'This number can’t receive WhatsApp messages.'
      : json.error?.message ?? `WhatsApp send failed (${res.status})`;
    throw new WhatsAppError(msg, code, json.error);
  }
  return json.messages[0].id;
}

/** Marks an incoming message as read (blue ticks) and shows the typing indicator while the assistant thinks. */
export async function markReadWithTyping(phoneNumberId: string, accessToken: string, messageId: string) {
  if (!accessToken) return;
  await fetch(`https://graph.facebook.com/${env.waGraphVersion()}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
  }).catch(() => {});
}
