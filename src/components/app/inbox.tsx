'use client';
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, Badge, Button, Empty, Notice, Segmented, useToast } from '@/components/ui/ui';
import { Icon } from '@/components/ui/icons';
import { Topbar } from './shell';
import { useLiveRefresh } from './live';
import { markRead, replyToConversation, setBotPaused } from '@/actions/inbox';
import { formatPhone } from '@/lib/phone';
import { fmtDateLong, fmtTime, localDate, relativeDay } from '@/lib/time';
import type { WaConversation, WaMessage } from '@/lib/types';

export interface InboxConversation extends WaConversation {
  customer_name: string | null;
  last_body: string | null;
  last_author?: WaMessage['author'] | null;
}

export interface InboxProps {
  salonId: string;
  tz: string;
  nowIso: string;
  waConnected: boolean;
  botEnabled: boolean;
  conversations: InboxConversation[];
  selectedId: string | null;
  messages: WaMessage[];
}

type Filter = 'all' | 'attention' | 'unread';
const WINDOW_MS = 24 * 60 * 60 * 1000;

const nameOf = (c: InboxConversation) => c.customer_name || c.profile_name || formatPhone(c.wa_id);

export function InboxScreen(p: InboxProps) {
  useLiveRefresh(p.salonId, ['wa_messages', 'wa_conversations']);
  const [filter, setFilter] = useState<Filter>('all');
  const selected = p.conversations.find((c) => c.id === p.selectedId) ?? null;
  const attention = p.conversations.filter((c) => c.needs_attention).length;
  const unread = p.conversations.filter((c) => c.unread_count > 0).length;
  const today = localDate(new Date(p.nowIso), p.tz);

  const list = useMemo(() => p.conversations.filter((c) =>
    filter === 'all' ? true : filter === 'attention' ? c.needs_attention : c.unread_count > 0), [p.conversations, filter]);

  return (
    <>
      <div className={selected ? 'hide-mobile' : undefined}>
        <Topbar title="WhatsApp"
          subtitle={attention ? `${attention} chat${attention === 1 ? ' needs' : 's need'} a reply` : p.botEnabled ? 'The assistant is handling chats' : 'Assistant is off — your team replies'} />
      </div>
      <div className="page inbox-page">
        {!p.waConnected && (
          <Notice tone="warn">WhatsApp isn’t connected yet, so clients can’t message you here. <Link href="/app/settings#whatsapp">See how to connect</Link></Notice>
        )}
        <div className={`inbox${selected ? ' has-thread' : ''}`}>
          <aside className="inbox-list" aria-label="Chats">
            <div className="inbox-list-head">
              <Segmented label="Show" value={filter} onChange={setFilter} options={[
                { value: 'all', label: 'All' },
                { value: 'attention', label: <>Needs reply{attention > 0 && <span className="seg-count">{attention}</span>}</> },
                { value: 'unread', label: <>Unread{unread > 0 && <span className="seg-count">{unread}</span>}</> },
              ]} />
            </div>
            {list.length ? (
              <ul className="list">
                {list.map((c) => <Fragment key={c.id}><ConversationItem c={c} active={c.id === p.selectedId} tz={p.tz} today={today} /></Fragment>)}
              </ul>
            ) : (
              <div className="inbox-list-empty small muted">
                {filter === 'all' ? 'No chats yet. When clients message your WhatsApp number, they appear here.' : filter === 'attention' ? 'Nothing needs a reply. The assistant has it covered.' : 'You’re all caught up.'}
              </div>
            )}
          </aside>
          <section className="inbox-thread" aria-label="Conversation">
            {selected ? (
              <Fragment key={selected.id}><Thread c={selected} messages={p.messages} tz={p.tz} nowIso={p.nowIso} today={today} botEnabled={p.botEnabled} /></Fragment>
            ) : (
              <div className="inbox-placeholder">
                <Empty icon="chat" title={p.conversations.length ? 'Pick a chat' : 'No chats yet'}>
                  {p.conversations.length
                    ? 'See what the assistant said, reply yourself, or pause it to take over a conversation.'
                    : 'Share your WhatsApp number with clients — the assistant answers questions and books appointments for you, day and night.'}
                </Empty>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function listTime(iso: string, tz: string, today: string) {
  const d = localDate(new Date(iso), tz);
  return d === today ? fmtTime(iso, tz) : relativeDay(d, today).replace(/^\w{3}, /, '');
}

function ConversationItem({ c, active, tz, today }: { c: InboxConversation; active: boolean; tz: string; today: string }) {
  const name = nameOf(c);
  const prefix = c.last_author === 'staff' ? 'You: ' : c.last_author === 'bot' ? 'Assistant: ' : '';
  return (
    <li className={`conv${active ? ' is-active' : ''}${c.unread_count ? ' is-unread' : ''}`}>
      <Link href={`/app/inbox?c=${c.id}`} aria-current={active ? 'true' : undefined}>
        <Avatar name={name} color={c.needs_attention ? 'var(--marigold-700)' : undefined} />
        <div className="grow">
          <div className="between" style={{ gap: 8 }}>
            <span className="conv-name truncate">{name}</span>
            <span className="tiny muted nowrap num">{listTime(c.last_message_at, tz, today)}</span>
          </div>
          <div className="between" style={{ gap: 8 }}>
            <span className="small muted truncate">{c.last_body ? prefix + c.last_body : 'No messages yet'}</span>
            {c.unread_count > 0 && <span className="unread-count" aria-label={`${c.unread_count} unread`}>{c.unread_count}</span>}
          </div>
          {(c.needs_attention || c.bot_paused) && (
            <div className="row" style={{ gap: 6, marginTop: 4 }}>
              {c.needs_attention && <Badge tone="marigold">Needs reply</Badge>}
              {c.bot_paused && <Badge><Icon name="pause" size={11} />Assistant paused</Badge>}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}

function Thread({ c, messages, tz, nowIso, today, botEnabled }: { c: InboxConversation; messages: WaMessage[]; tz: string; nowIso: string; today: string; botEnabled: boolean }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<WaMessage[]>([]);
  const [sending, startSend] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [paused, setPaused] = useState(c.bot_paused);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const router = useRouter();
  const name = nameOf(c);

  useEffect(() => { setPaused(c.bot_paused); }, [c.bot_paused]);
  // The reply is saved before the action returns, so fresh server data already contains it: drop the optimistic copy.
  useEffect(() => { setSent([]); }, [messages]);
  useEffect(() => {
    if (c.unread_count > 0) markRead(c.id).then((r) => { if (r.ok) router.refresh(); });
  }, [c.id, c.unread_count, router]);

  const all = useMemo(() => [...messages, ...sent], [messages, sent]);
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [all.length]);

  const windowOpen = !!c.last_inbound_at && new Date(nowIso).getTime() - new Date(c.last_inbound_at).getTime() < WINDOW_MS;

  const send = () => {
    const body = text.trim();
    if (!body || sending) return;
    setError(null);
    startSend(async () => {
      const r = await replyToConversation(c.id, body);
      if (!r.ok) { setError(r.error); return; }
      setSent((s) => [...s, { id: `local-${Date.now()}`, conversation_id: c.id, direction: 'out', author: 'staff', kind: 'text', body, payload: null, status: 'sending', created_at: new Date().toISOString() }]);
      setText('');
      box.current?.focus();
      router.refresh();
    });
  };

  const togglePause = () => startToggle(async () => {
    const next = !paused;
    setPaused(next);
    const r = await setBotPaused(c.id, next);
    if (!r.ok) { setPaused(!next); toast(r.error, 'error'); return; }
    toast(r.message ?? (next ? 'Assistant paused' : 'Assistant resumed'));
    router.refresh();
  });

  // Group by local day for date separators.
  const groups: { day: string; items: WaMessage[] }[] = [];
  for (const m of all) {
    const d = localDate(new Date(m.created_at), tz);
    const last = groups[groups.length - 1];
    if (last && last.day === d) last.items.push(m); else groups.push({ day: d, items: [m] });
  }

  return (
    <div className="thread">
      <header className="thread-head">
        <Link href="/app/inbox" className="btn btn-ghost btn-icon btn-sm show-mobile" aria-label="Back to chats"><Icon name="chevronLeft" /></Link>
        <Avatar name={name} />
        <div className="grow">
          <div className="strong truncate">{name}</div>
          <div className="small muted truncate num">
            {formatPhone(c.wa_id)}
            {c.customer_id ? <> · <Link href={`/app/customers/${c.customer_id}`}>Client profile</Link></> : <span className="hide-mobile"> · Not saved as a client yet</span>}
          </div>
        </div>
        {botEnabled && (
          <Button size="sm" variant={paused ? 'primary' : 'secondary'} icon={paused ? 'play' : 'pause'} loading={toggling} onClick={togglePause}
            aria-pressed={paused} title={paused ? 'Let the assistant reply again' : 'Stop the assistant replying in this chat'}>
            <span className="hide-mobile">{paused ? 'Resume assistant' : 'Pause assistant'}</span>
            <span className="show-mobile">{paused ? 'Resume' : 'Pause'}</span>
          </Button>
        )}
      </header>

      {botEnabled && paused && (
        <div className="thread-banner">
          <Icon name="pause" size={15} />
          <span>Assistant paused. While paused, the assistant won’t reply in this chat so your team can take over.{c.needs_attention ? ' The client is waiting for a reply.' : ''}</span>
        </div>
      )}
      {botEnabled && !paused && c.needs_attention && (
        <div className="thread-banner is-attention">
          <Icon name="alert" size={15} />
          <span>The assistant asked for help in this chat. Reply below, or pause it to take over.</span>
        </div>
      )}

      <div className="thread-scroll" ref={scroller}>
        {groups.length === 0 && <p className="small muted" style={{ textAlign: 'center', marginTop: 40 }}>No messages in this chat yet.</p>}
        {groups.map((g) => (
          <div key={g.day} className="thread-day">
            <div className="day-sep"><span>{g.day === today ? 'Today' : relativeDay(g.day, today) === 'Yesterday' ? 'Yesterday' : fmtDateLong(g.day)}</span></div>
            {g.items.map((m) => <Fragment key={m.id}><Bubble m={m} tz={tz} /></Fragment>)}
          </div>
        ))}
      </div>

      <div className="composer">
        {!windowOpen ? (
          <div className="composer-closed">
            <Icon name="clock" size={16} />
            <span>You can reply after the client messages again. WhatsApp only allows free replies within 24 hours of their last message — booking confirmations and reminders still go out as templates.</span>
          </div>
        ) : (
          <>
            {error && <Notice tone="error">{error}</Notice>}
            <form className="composer-row" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <label className="sr-only" htmlFor="reply">Reply to {name}</label>
              <textarea id="reply" ref={box} className="textarea composer-input" rows={1} maxLength={4000} placeholder={`Message ${name.split(' ')[0]}…`} value={text}
                onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
              <Button type="submit" variant="primary" icon="send" loading={sending} disabled={!text.trim()} aria-label="Send">
                <span className="hide-mobile">Send</span>
              </Button>
            </form>
            <div className="tiny muted composer-hint hide-mobile">Enter to send · Shift + Enter for a new line{botEnabled && !paused ? ' · Replying doesn’t pause the assistant' : ''}</div>
          </>
        )}
      </div>
    </div>
  );
}

function payloadChips(m: WaMessage): string[] {
  const p = m.payload as { buttons?: unknown; list?: unknown } | null;
  if (!p || typeof p !== 'object') return [];
  const arr = Array.isArray(p.buttons) ? p.buttons : Array.isArray(p.list) ? p.list : [];
  return arr.filter((x): x is string => typeof x === 'string');
}

const MEDIA_LABEL: Record<string, string> = {
  image: 'Photo', audio: 'Voice note', video: 'Video', document: 'Document', sticker: 'Sticker', location: 'Location', contacts: 'Contact card',
};

function Bubble({ m, tz }: { m: WaMessage; tz: string }) {
  // Internal notes (e.g. "Assistant handed this chat to the team") are never sent to the client.
  if (m.author === 'system' && m.kind === 'note') {
    return <div className="msg-system"><span>{m.body}<time className="num" dateTime={m.created_at}>{fmtTime(m.created_at, tz)}</time></span></div>;
  }
  const mine = m.direction === 'out';
  const who = m.author === 'bot' ? 'Assistant' : m.author === 'staff' ? 'You' : m.author === 'system' ? 'Automatic message' : null;
  const chips = payloadChips(m);
  let body = m.body;
  if (m.kind === 'template' && body) body = body.replace(/^\[[^\]]+\]\s*/, '');
  if (!body) body = MEDIA_LABEL[m.kind] ? `${MEDIA_LABEL[m.kind]} (open WhatsApp on your phone to see it)` : 'Message';
  const tick = m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : m.status === 'sent' ? '✓' : null;

  return (
    <div className={`msg ${mine ? 'msg-out' : 'msg-in'} msg-${m.author}`}>
      <div className="bubble">
        {who && <div className="msg-who">{m.author === 'bot' && <Icon name="bot" size={13} />}{who}{m.kind === 'template' ? ' · template' : ''}</div>}
        {m.kind === 'button' && <span className="msg-tapped">Tapped</span>}
        <div className="msg-body">{body}</div>
        {chips.length > 0 && <div className="msg-chips">{chips.map((t) => <span key={t} className="msg-chip">{t}</span>)}</div>}
        <div className="msg-meta num">
          {fmtTime(m.created_at, tz)}
          {mine && m.status === 'failed' && <span className="msg-failed">Not delivered</span>}
          {mine && m.status === 'sending' && <span>Sending…</span>}
          {mine && tick && <span className={m.status === 'read' ? 'msg-read' : undefined} aria-label={m.status ?? undefined}>{tick}</span>}
        </div>
      </div>
    </div>
  );
}
