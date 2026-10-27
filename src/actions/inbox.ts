'use server';
import { revalidatePath } from 'next/cache';
import { getSalonContext } from '@/lib/context';
import { can } from '@/lib/permissions';
import { fail, must } from '@/lib/actions';
import { sendStaffReply } from '@/lib/whatsapp/outbox';
import { WhatsAppError } from '@/lib/whatsapp/cloud-api';
import type { ActionResult } from '@/lib/types';

// WhatsApp inbox: the front desk reads what the assistant did and takes over when needed.

const NOT_ALLOWED = 'Your role doesn’t have access to the WhatsApp inbox.';
const MAX_REPLY = 4000; // WhatsApp text limit is 4096

function refresh() { revalidatePath('/app/inbox'); revalidatePath('/app', 'layout'); }

/** Loads the conversation through RLS so a user can only touch chats of their own active salon. */
async function ownConversation(conversationId: string) {
  const ctx = await getSalonContext();
  if (!can(ctx.role, 'inbox')) return { ctx, conv: null, error: NOT_ALLOWED };
  const { data } = await ctx.supabase.from('wa_conversations').select('id, bot_paused, needs_attention')
    .eq('id', conversationId).eq('salon_id', ctx.salon.id).maybeSingle();
  return { ctx, conv: data as { id: string; bot_paused: boolean; needs_attention: boolean } | null, error: data ? null : 'This chat no longer exists. Refresh the inbox.' };
}

export async function replyToConversation(conversationId: string, text: string): Promise<ActionResult> {
  try {
    const body = (text ?? '').trim();
    if (!body) return { ok: false, error: 'Type a message first.' };
    if (body.length > MAX_REPLY) return { ok: false, error: `Messages can be up to ${MAX_REPLY} characters. Split it into two.` };
    const { conv, error } = await ownConversation(conversationId);
    if (!conv) return { ok: false, error: error ?? NOT_ALLOWED };
    await sendStaffReply(conv.id, body);
    refresh();
    return { ok: true };
  } catch (e) {
    if (e instanceof WhatsAppError) return { ok: false, error: e.message };
    return fail(e);
  }
}

/** Pause = a person is handling this chat; the assistant stays quiet. Resuming also clears "needs reply". */
export async function setBotPaused(conversationId: string, paused: boolean): Promise<ActionResult> {
  try {
    const { ctx, conv, error } = await ownConversation(conversationId);
    if (!conv) return { ok: false, error: error ?? NOT_ALLOWED };
    must(await ctx.supabase.from('wa_conversations')
      .update(paused ? { bot_paused: true } : { bot_paused: false, needs_attention: false })
      .eq('id', conv.id).eq('salon_id', ctx.salon.id));
    refresh();
    return { ok: true, message: paused ? 'Assistant paused in this chat. Your team is handling it.' : 'Assistant is replying in this chat again' };
  } catch (e) { return fail(e); }
}

export async function markRead(conversationId: string): Promise<ActionResult> {
  try {
    const { ctx, conv, error } = await ownConversation(conversationId);
    if (!conv) return { ok: false, error: error ?? NOT_ALLOWED };
    must(await ctx.supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', conv.id).eq('salon_id', ctx.salon.id));
    revalidatePath('/app', 'layout');
    return { ok: true };
  } catch (e) { return fail(e); }
}
