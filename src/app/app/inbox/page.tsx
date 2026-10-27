import { InboxScreen, type InboxConversation } from '@/components/app/inbox';
import { requirePermission } from '@/lib/context';
import type { WaConversation, WaMessage } from '@/lib/types';

export const metadata = { title: 'WhatsApp' };

type ConvRow = WaConversation & { customer: { name: string } | null };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await requirePermission('inbox');
  const { c } = await searchParams;

  const { data: convs } = await ctx.supabase.from('wa_conversations')
    .select('*, customer:customers(name)')
    .eq('salon_id', ctx.salon.id)
    .order('last_message_at', { ascending: false })
    .limit(200);
  const rows = (convs ?? []) as ConvRow[];

  // Latest message per conversation for the list preview (one query, newest first).
  const ids = rows.map((r) => r.id);
  const latest = new Map<string, { body: string | null; author: WaMessage['author'] }>();
  if (ids.length) {
    const { data: recent } = await ctx.supabase.from('wa_messages')
      .select('conversation_id, body, author, kind, created_at')
      .eq('salon_id', ctx.salon.id)
      .in('conversation_id', ids)
      .neq('kind', 'note')
      .order('created_at', { ascending: false })
      .limit(Math.min(ids.length * 4, 800));
    for (const m of (recent ?? []) as { conversation_id: string; body: string | null; author: WaMessage['author'] }[]) {
      if (!latest.has(m.conversation_id)) latest.set(m.conversation_id, { body: m.body?.replace(/^\[[^\]]+\]\s*/, '') ?? null, author: m.author });
    }
  }

  const conversations: InboxConversation[] = rows.map(({ customer, ...r }) => ({
    ...r,
    customer_name: customer?.name ?? null,
    last_body: latest.get(r.id)?.body ?? null,
    last_author: latest.get(r.id)?.author ?? null,
  }));

  const selected = c && conversations.some((x) => x.id === c) ? c : null;
  let messages: WaMessage[] = [];
  if (selected) {
    // Newest 300, shown oldest first.
    const { data } = await ctx.supabase.from('wa_messages').select('*')
      .eq('salon_id', ctx.salon.id).eq('conversation_id', selected)
      .order('created_at', { ascending: false }).limit(300);
    messages = ((data ?? []) as WaMessage[]).reverse();
  }

  return (
    <InboxScreen
      salonId={ctx.salon.id}
      tz={ctx.salon.timezone}
      nowIso={new Date().toISOString()}
      waConnected={!!ctx.salon.wa_phone_number_id}
      botEnabled={ctx.salon.wa_bot_enabled}
      conversations={conversations}
      selectedId={selected}
      messages={messages}
    />
  );
}
