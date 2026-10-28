// Conversation-flow tests for the WhatsApp assistant with a scripted model and an in-memory salon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEngine, toLlmMessages, buildSystemPrompt, staffLine, type EngineContext, type EngineDeps, type LlmRequest, type LlmResponse, type Block } from '../src/lib/whatsapp/engine';
import { computeSlots } from '../src/lib/availability';
import { zonedToUtc } from '../src/lib/time';
import type { Hours } from '../src/lib/types';

const TZ = 'Asia/Kolkata';
const hours: Hours = { mon: [['10:00', '20:00']], tue: [['10:00', '20:00']], wed: [['10:00', '20:00']], thu: [['10:00', '20:00']], fri: [['10:00', '20:00']], sat: [['10:00', '20:00']], sun: [] };
const NOW = new Date('2026-10-27T05:50:00Z'); // Tue 11:20 IST

function makeSalon() {
  const busy: { id: string; staffId: string; start: Date; end: Date; serviceIds: string[]; cancelled?: boolean }[] = [
    { id: 'ap-1', staffId: 'priya', start: zonedToUtc('2026-10-28', '17:00', TZ), end: zonedToUtc('2026-10-28', '18:00', TZ), serviceIds: ['cut'] },
  ];
  const ctx: EngineContext = {
    salon: { name: 'Glow Studio', address: 'Indiranagar', phone: '919845012345', tz: TZ, hours, instructions: 'Free parking behind the building.', windowDays: 30, bookingUrl: 'https://styile.com/s/glow' },
    services: [
      { id: 'cut', name: 'Haircut', category: 'Hair', duration_min: 45, price: 600, gender: 'unisex', online_bookable: true },
      { id: 'beard', name: 'Beard trim', category: 'Hair', duration_min: 20, price: 250, gender: 'male', online_bookable: true },
    ],
    staff: [{ id: 'priya', name: 'Priya', title: 'Senior stylist' }, { id: 'arjun', name: 'Arjun', title: 'Barber' }],
    customer: { name: 'Rohan', visits: 3 },
    now: NOW,
    history: [],
    pending: null,
  };
  const log: string[] = [];
  const deps: EngineDeps = {
    llm: async () => { throw new Error('no script'); },
    availability: async (q) => computeSlots({
      date: q.date, tz: TZ, now: NOW, intervalMin: 15, leadMin: 60,
      durationMin: q.serviceIds.reduce((a, id) => a + ctx.services.find((s) => s.id === id)!.duration_min, 0),
      branchHours: hours, staff: (q.staffId ? [q.staffId] : ['priya', 'arjun']).map((id) => ({ id, hours: null })),
      busy: busy.filter((b) => !b.cancelled && b.id !== q.excludeAppointmentId).map((b) => ({ staffId: b.staffId, start: b.start, end: b.end })),
    }),
    upcoming: async () => busy.filter((b) => !b.cancelled).map((b) => ({ id: b.id, start_at: b.start.toISOString(), staff: b.staffId === 'priya' ? 'Priya' : 'Arjun', services: ['Haircut'], serviceIds: b.serviceIds, status: 'booked' })),
    book: async (p) => {
      const start = new Date(p.start);
      const end = new Date(start.getTime() + 45 * 60000);
      const staffId = p.staffId ?? 'priya';
      if (busy.some((b) => !b.cancelled && b.staffId === staffId && b.start < end && b.end > start)) throw new Error('That time was just taken. Please pick another slot.');
      busy.push({ id: `ap-${busy.length + 1}`, staffId, start, end, serviceIds: p.serviceIds });
      log.push(`book ${p.start} ${staffId}`);
      return { start: p.start, stylist: staffId === 'priya' ? 'Priya' : 'Arjun', services: p.serviceIds.map((id) => ctx.services.find((s) => s.id === id)!.name) };
    },
    cancel: async (id) => { busy.find((b) => b.id === id)!.cancelled = true; log.push(`cancel ${id}`); },
    reschedule: async (id, start) => { const b = busy.find((x) => x.id === id)!; b.start = new Date(start); b.end = new Date(new Date(start).getTime() + 3600000); log.push(`move ${id}`); return { start, stylist: 'Priya' }; },
    rename: async (n) => { log.push(`rename ${n}`); },
    handoff: async (r) => { log.push(`handoff ${r}`); },
    coins: async () => ({
      balance: 1250,
      recent: [
        { created_at: '2026-10-26T08:00:00Z', kind: 'spend', coins: -400, balance_after: 1250, bill: 'GS-01041' },
        { created_at: '2026-10-20T08:00:00Z', kind: 'bonus', coins: 150, balance_after: 1650, bill: null },
        { created_at: '2026-10-20T08:00:00Z', kind: 'load', coins: 1500, balance_after: 1500, bill: null },
        { created_at: '2026-10-01T08:00:00Z', kind: 'adjust', coins: -100, balance_after: 0, bill: null },
        { created_at: '2026-09-21T08:00:00Z', kind: 'refund', coins: 100, balance_after: 100, bill: 'GS-01002' },
        { created_at: '2026-09-20T08:00:00Z', kind: 'spend', coins: -100, balance_after: 0, bill: 'GS-01002' },
      ],
    }),
    packages: async () => ({
      packages: [
        { name: '6 Facials', expires_on: '2027-04-26', items: [{ name: 'Facial', left: 4, total: 6 }] },
        { name: 'Bridal glow pack', expires_on: '2026-11-05', items: [{ name: 'Clean-up', left: 1, total: 3 }, { name: 'Facial', left: 2, total: 2 }] },
      ],
      membership: { name: 'Glow Card', starts_on: '2026-03-01', ends_on: '2027-02-28', service_discount_pct: 10, product_discount_pct: 5 },
    }),
  };
  return { ctx, deps, busy, log };
}

/** A fake model that plays a fixed script of responses and records what it was sent. */
function script(...responses: Block[][]) {
  const seen: LlmRequest[] = [];
  let i = 0;
  const llm = async (req: LlmRequest): Promise<LlmResponse> => {
    seen.push(JSON.parse(JSON.stringify(req)));
    const content = responses[i++] ?? [{ type: 'text', text: '(end)' }];
    return { stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', content };
  };
  return { llm, seen };
}
const use = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });

test('books only after the client confirms, using live availability', async () => {
  const { ctx, deps, log } = makeSalon();
  const s = script(
    [use('check_availability', { service_ids: ['cut'], date: '2026-10-28', preferred_time: '17:00' })],
    [use('propose_booking', { service_ids: ['cut'], date: '2026-10-28', time: '17:00' })],
  );
  deps.llm = s.llm;
  const r1 = await runEngine(ctx, deps, { text: 'haircut tomorrow around 5?' });
  // availability result reached the model and shows Priya is busy at 5 but Arjun is free
  const toolResult = (s.seen[1].messages.at(-1)!.content as Block[])[0] as { content: string };
  const avail = JSON.parse(toolResult.content);
  const five = avail.options.find((o: { time: string }) => o.time === '17:00');
  assert.deepEqual(five.stylists, ['Arjun']);
  assert.equal(r1.replies[0].type, 'buttons', 'client gets Confirm buttons');
  assert.match((r1.replies[0] as { text: string }).text, /Haircut\* with Arjun\ntomorrow, 5:00 PM/);
  assert.equal(r1.pending?.type, 'book');
  assert.equal(log.length, 0, 'nothing booked before confirmation');

  const r2 = await runEngine({ ...ctx, pending: r1.pending }, deps, { text: 'Confirm', buttonId: 'confirm' });
  assert.deepEqual(r2.actions, ['executed:book']);
  assert.equal(log[0], `book ${zonedToUtc('2026-10-28', '17:00', TZ).toISOString()} arjun`);
  assert.match((r2.replies[0] as { text: string }).text, /^Booked ✅ Haircut with Arjun, tomorrow, 5:00 PM/);
  assert.equal(r2.pending, null);
});

test('typing "haan" confirms, a taken slot fails gracefully', async () => {
  const { ctx, deps, busy } = makeSalon();
  deps.llm = script([use('propose_booking', { service_ids: ['cut'], date: '2026-10-29', time: '12:00', staff_id: 'priya' })]).llm;
  const r1 = await runEngine(ctx, deps, { text: 'Thursday 12 with Priya' });
  assert.equal(r1.pending?.staffId, 'priya');
  // someone else grabs the slot before the client answers
  busy.push({ id: 'x', staffId: 'priya', start: zonedToUtc('2026-10-29', '11:45', TZ), end: zonedToUtc('2026-10-29', '12:30', TZ), serviceIds: ['cut'] });
  const r2 = await runEngine({ ...ctx, pending: r1.pending }, deps, { text: 'haan' });
  assert.deepEqual(r2.actions, ['failed:book']);
  assert.match((r2.replies[0] as { text: string }).text, /just taken/);
  assert.equal(r2.pending, null);
});

test('the model cannot propose a time that is not free', async () => {
  const { ctx, deps } = makeSalon();
  const s = script(
    [use('propose_booking', { service_ids: ['cut'], date: '2026-10-28', time: '17:00', staff_id: 'priya' })],
    [{ type: 'text', text: 'Priya is busy at 5. Arjun is free then, or Priya at 6. Which do you prefer?' }],
  );
  deps.llm = s.llm;
  const r = await runEngine(ctx, deps, { text: 'priya at 5 tomorrow' });
  assert.equal(r.pending, null);
  assert.equal(r.replies[0].type, 'text');
  const res = JSON.parse(((s.seen[1].messages.at(-1)!.content as Block[])[0] as { content: string }).content);
  assert.equal(res.ok, false);
});

test('past dates, unknown services and malformed times are rejected as tool errors', async () => {
  const { ctx, deps } = makeSalon();
  const s = script(
    [use('check_availability', { service_ids: ['massage'], date: '2026-10-28' }, 'a'), use('check_availability', { service_ids: ['cut'], date: '2026-10-20' }, 'b'), use('propose_booking', { service_ids: ['cut'], date: '2026-10-28', time: '5pm' }, 'c')],
    [{ type: 'text', text: 'ok' }],
  );
  deps.llm = s.llm;
  await runEngine(ctx, deps, { text: 'x' });
  const results = s.seen[1].messages.at(-1)!.content as { is_error?: boolean; content: string }[];
  assert.ok(results.every((r) => r.is_error));
  assert.match(results[1].content, /past/);
});

test('closed day suggests the next available date', async () => {
  const { ctx, deps } = makeSalon();
  const s = script([use('check_availability', { service_ids: ['cut'], date: '2026-11-01' })], [{ type: 'text', text: 'We are closed Sunday; Monday works.' }]);
  deps.llm = s.llm;
  await runEngine(ctx, deps, { text: 'sunday?' });
  const res = JSON.parse(((s.seen[1].messages.at(-1)!.content as Block[])[0] as { content: string }).content);
  assert.equal(res.next_available_date, '2026-11-02');
  assert.ok(res.next_options.length > 0);
});

test('cancel flow lists appointments, proposes, then cancels on confirm', async () => {
  const { ctx, deps, log } = makeSalon();
  deps.llm = script([use('list_my_appointments', {})], [use('propose_cancellation', { appointment_id: 'ap-1' })]).llm;
  const r1 = await runEngine(ctx, deps, { text: 'cancel my booking' });
  assert.equal(r1.pending?.type, 'cancel');
  assert.match((r1.replies[0] as { text: string }).text, /Cancel this appointment\?\n\*Haircut\* with Priya\ntomorrow, 5:00 PM/);
  const r2 = await runEngine({ ...ctx, pending: r1.pending }, deps, { text: 'yes' });
  assert.deepEqual(log, ['cancel ap-1']);
  assert.match((r2.replies[0] as { text: string }).text, /cancelled/);
});

test('reschedule ignores the appointment itself when checking free time', async () => {
  const { ctx, deps, log } = makeSalon();
  deps.llm = script([use('propose_reschedule', { appointment_id: 'ap-1', date: '2026-10-28', time: '17:30', staff_id: 'priya' })]).llm;
  const r1 = await runEngine(ctx, deps, { text: 'move it to 5:30' });
  assert.equal(r1.pending?.type, 'reschedule', 'overlapping its own old slot is fine');
  await runEngine({ ...ctx, pending: r1.pending }, deps, { text: '', buttonId: 'confirm' });
  assert.deepEqual(log, ['move ap-1']);
});

test('"change something" clears the proposal without calling the model', async () => {
  const { ctx, deps } = makeSalon();
  deps.llm = async () => { throw new Error('should not be called'); };
  const pending = { type: 'book' as const, serviceIds: ['cut'], start: NOW.toISOString(), staffId: null, summary: 's', expiresAt: new Date(NOW.getTime() + 60000).toISOString() };
  const r = await runEngine({ ...ctx, pending }, deps, { text: 'Change something', buttonId: 'change' });
  assert.equal(r.pending, null);
  assert.match((r.replies[0] as { text: string }).text, /What would you like to change/);
});

test('expired proposals are not executed', async () => {
  const { ctx, deps, log } = makeSalon();
  deps.llm = script([{ type: 'text', text: 'That offer expired — shall I check times again?' }]).llm;
  const pending = { type: 'book' as const, serviceIds: ['cut'], start: NOW.toISOString(), staffId: null, summary: 's', expiresAt: new Date(NOW.getTime() - 1000).toISOString() };
  const r = await runEngine({ ...ctx, pending }, deps, { text: 'yes' });
  assert.equal(log.length, 0);
  assert.equal(r.pending, null);
});

test('handoff pauses and tells the client', async () => {
  const { ctx, deps, log } = makeSalon();
  deps.llm = script([use('handoff_to_staff', { reason: 'Refund request' })], [{ type: 'text', text: 'I’ve passed this to the team — they’ll reply here soon.' }]).llm;
  const r = await runEngine(ctx, deps, { text: 'I want a refund' });
  assert.equal(r.handedOff, true);
  assert.deepEqual(log, ['handoff Refund request']);
});

test('history is shaped for the API and the prompt carries salon facts', () => {
  const msgs = toLlmMessages([{ role: 'assistant', text: 'Hi!' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }, { role: 'assistant', text: 'c' }], 'd');
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(msgs[0].content, 'a\nb');
  const { ctx } = makeSalon();
  const sys = buildSystemPrompt(ctx);
  assert.match(sys[0].text, /cut \| Hair \| Haircut \| 45 min \| ₹600/);
  assert.match(sys[0].text, /Free parking/);
  assert.match(sys[1].text, /Wed, 28 Oct = 2026-10-28 \(tomorrow\): 10:00 AM–8:00 PM/);
  assert.match(sys[1].text, /Sun, 1 Nov = 2026-11-01: closed/);
});

test('the team list in the prompt carries titles and specialties', () => {
  const { ctx } = makeSalon();
  ctx.staff = [
    { id: 'meera', name: 'Meera Iyer', title: 'Colour specialist', specialties: ['balayage', 'global colour'] },
    { id: 'arjun', name: 'Arjun', title: 'Barber' },
    { id: 'sana', name: 'Sana', title: null, specialties: ['gel nails'] },
    { id: 'kiran', name: 'Kiran', title: null, specialties: [] },
  ];
  const sys = buildSystemPrompt(ctx)[0].text;
  assert.match(sys, /- meera \| Meera Iyer \(Colour specialist; balayage, global colour\)\n/);
  assert.match(sys, /- arjun \| Arjun \(Barber\)\n/);
  assert.match(sys, /- sana \| Sana \(gel nails\)\n/);
  assert.match(sys, /- kiran \| Kiran$/m);
  assert.equal(staffLine({ id: 'x', name: 'Priya', title: 'Senior stylist', specialties: ['bobs'] }), 'Priya (Senior stylist; bobs)');
});

test('the prompt offers the client their usual stylist first', () => {
  const { ctx } = makeSalon();
  const withUsual = buildSystemPrompt({ ...ctx, customer: { ...ctx.customer, usualStylist: { id: 'priya', name: 'Priya' } } });
  assert.match(withUsual[1].text, /Their usual stylist: Priya \(staff_id priya\)\. If they don't say who, offer their usual stylist first/);
  // It is per-client, so it lives in the uncached part of the prompt.
  assert.doesNotMatch(withUsual[0].text, /usual stylist: Priya/i);
  assert.doesNotMatch(buildSystemPrompt(ctx)[1].text, /usual stylist/i, 'no usual stylist line for a client without one');
  const gone = buildSystemPrompt({ ...ctx, customer: { ...ctx.customer, usualStylist: { id: 'left-salon', name: 'Ravi' } } });
  assert.doesNotMatch(gone[1].text, /Ravi/, 'a usual stylist who is not on the team is not offered');
});

test('booking with the usual stylist passes their staff_id through to the confirmation', async () => {
  const { ctx, deps, log } = makeSalon();
  const s = script(
    [use('check_availability', { service_ids: ['cut'], date: '2026-10-29', preferred_time: '12:00', staff_id: 'priya' })],
    [use('propose_booking', { service_ids: ['cut'], date: '2026-10-29', time: '12:00', staff_id: 'priya' })],
  );
  deps.llm = s.llm;
  const usualCtx = { ...ctx, customer: { ...ctx.customer, usualStylist: { id: 'priya', name: 'Priya' } } };
  const r1 = await runEngine(usualCtx, deps, { text: 'haircut thursday 12' });
  assert.match(s.seen[0].system[1].text, /usual stylist: Priya/);
  assert.match((r1.replies[0] as { text: string }).text, /Haircut\* with Priya/);
  await runEngine({ ...usualCtx, pending: r1.pending }, deps, { text: 'yes' });
  assert.equal(log[0], `book ${zonedToUtc('2026-10-29', '12:00', TZ).toISOString()} priya`);
});

test('my_coins tells the client their coin balance at this salon', async () => {
  const { ctx, deps, log } = makeSalon();
  const s = script([use('my_coins', {})], [{ type: 'text', text: 'You have 1,250 coins at Glow Studio — worth ₹1,250 on your next bill.' }]);
  deps.llm = s.llm;
  const r = await runEngine(ctx, deps, { text: 'mere kitne coins bache hain?' });
  assert.ok(s.seen[0].tools.some((t) => t.name === 'my_coins'), 'tool offered to the model');
  assert.match(s.seen[0].system[0].text, /call my_coins/);
  const res = JSON.parse(((s.seen[1].messages.at(-1)!.content as Block[])[0] as { content: string }).content);
  assert.equal(res.balance, 1250);
  assert.equal(res.balance_text, '1,250 coins (worth ₹1,250 on bills at Glow Studio)');
  assert.equal(res.recent.length, 5, 'last 5 transactions only');
  assert.deepEqual(res.recent[0], { date: 'Mon, 26 Oct', what: 'Paid a bill', coins: '−400', balance_after: '1,250', bill: 'GS-01041' });
  assert.equal(res.recent[1].coins, '+150');
  assert.equal(r.pending, null);
  assert.equal(r.handedOff, false, 'checking coins is not a hand-off');
  assert.equal(log.length, 0);
  assert.match((r.replies[0] as { text: string }).text, /1,250 coins/);
});

test('my_packages tells the client the sessions left and their membership card', async () => {
  const { ctx, deps, log } = makeSalon();
  const s = script([use('my_packages', {})], [{ type: 'text', text: 'You have 4 facials left in your 6 Facials package — use them by 26 Apr 2027.' }]);
  deps.llm = s.llm;
  const r = await runEngine(ctx, deps, { text: 'how many facials left in my package?' });
  assert.ok(s.seen[0].tools.some((t) => t.name === 'my_packages'), 'tool offered to the model');
  assert.match(s.seen[0].system[0].text, /call my_packages/);
  const res = JSON.parse(((s.seen[1].messages.at(-1)!.content as Block[])[0] as { content: string }).content);
  assert.equal(res.packages.length, 2);
  assert.deepEqual(res.packages[0].sessions_left, ['Facial: 4 of 6 left']);
  assert.equal(res.packages[0].use_by, '26 Apr 2027');
  assert.equal(res.packages[1].use_by, '5 Nov', 'no year for this year');
  assert.equal(res.packages[0].total_left, '4 sessions');
  assert.equal(res.packages[0].ends_soon, undefined, 'no nudge for a package ending months away');
  assert.deepEqual(res.packages[1].sessions_left, ['Clean-up: 1 of 3 left', 'Facial: 2 of 2 left']);
  assert.match(res.packages[1].ends_soon, /^9 days left/, 'a package ending soon is flagged so the assistant can suggest booking');
  assert.deepEqual(res.membership, { name: 'Glow Card', discount: '10% off services · 5% off products', valid_till: '28 Feb 2027' });
  assert.equal(r.handedOff, false, 'checking a package is not a hand-off');
  assert.equal(r.pending, null);
  assert.equal(log.length, 0);
});

test('my_packages with nothing bought says where to buy', async () => {
  const { ctx, deps } = makeSalon();
  deps.packages = async () => ({ packages: [], membership: null });
  const s = script([use('my_packages', {})], [{ type: 'text', text: 'You don’t have a package yet.' }]);
  deps.llm = s.llm;
  await runEngine(ctx, deps, { text: 'koi package hai mera?' });
  const res = JSON.parse(((s.seen[1].messages.at(-1)!.content as Block[])[0] as { content: string }).content);
  assert.deepEqual(res.packages, []);
  assert.equal(res.membership, null);
  assert.match(res.note, /front desk/);
});
