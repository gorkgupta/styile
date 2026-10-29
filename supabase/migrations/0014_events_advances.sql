-- Styile — bridal and event bookings, with advances.
--
-- Bridal work is the reliably pre-booked, high-value job in small-town parlours (₹3,000–5,000 and up): a trial weeks
-- before, the bride and often her mother, sisters or friends on the day, sometimes at home, and an advance to hold
-- the date.
--
-- * events: one booking for the day — type (bridal, engagement, party make-up, group), when everyone must be ready,
--   at the salon or a home visit (address, travel charge billed as a line), the quote, notes, an optional trial
--   appointment. Each person is an appointment row with event_id and a guest_name ("Bride", "Mother"), possibly
--   with different stylists; the calendar's no-double-booking rule applies as usual.
-- * advance_payments: money taken before the day — amount, method (cash, UPI, card, Nu cash, Bhutan UPI), reference,
--   who received it, an advance receipt number (AR-00001). This is an advance receipt, not a tax invoice. On the
--   final bill the advance is a payment with method 'advance' (never more than what is left of it); cancelling the
--   bill gives it back. Owners and managers can refund an advance (per the salon's own policy — nothing is
--   forfeited automatically); salons.advance_policy is printed on the receipt.
-- * day_summary: an advance is money received on the day it was received (by method); 'advance' payments on bills
--   are not money that day (no double counting), like coins and package sessions.
--
-- GST (the app's reading, not tax advice): for regular-GST salons the receipt says GST is charged on the final bill.
-- Under GST law an advance for services can make GST due when it is received — salons should confirm with their CA.

-- ---------------------------------------------------------------------------
-- Settings: the salon's advance / cancellation policy (shown on the advance receipt)
-- ---------------------------------------------------------------------------
alter table public.salons
  add column advance_policy text check (advance_policy is null or char_length(advance_policy) <= 500);
comment on column public.salons.advance_policy is 'Printed on advance receipts, e.g. "Advances are refundable up to 7 days before the event". No automatic forfeits.';

create or replace function public.is_prepaid_method(p text) returns boolean
language sql immutable as $$
  select coalesce(p in ('wallet', 'package', 'advance'), false);
$$;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  customer_id uuid not null references public.customers (id),
  event_type text not null check (event_type in ('bridal', 'engagement', 'party', 'group', 'other')),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  event_at timestamptz not null,                 -- when everyone must be ready
  location text not null default 'salon' check (location in ('salon', 'home')),
  address text check (address is null or char_length(address) <= 240),
  travel_charge numeric(10,2) not null default 0 check (travel_charge >= 0 and travel_charge <= 100000),
  quoted_price numeric(10,2) check (quoted_price is null or (quoted_price >= 0 and quoted_price <= 10000000)),
  people integer not null default 1 check (people between 1 and 50),
  trial_appointment_id uuid references public.appointments (id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'booked' check (status in ('booked', 'done', 'cancelled')),
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (location = 'salon' or address is not null),
  check (location = 'home' or travel_charge = 0)
);
create index on public.events (salon_id, event_at);
create index on public.events (customer_id);

alter table public.appointments
  add column event_id uuid references public.events (id) on delete set null,
  add column guest_name text check (guest_name is null or char_length(guest_name) <= 60);
create index on public.appointments (event_id) where event_id is not null;

alter table public.invoices
  add column event_id uuid references public.events (id) on delete set null;
create index on public.invoices (event_id) where event_id is not null;

-- ---------------------------------------------------------------------------
-- Advances
-- ---------------------------------------------------------------------------
create table public.advance_payments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  customer_id uuid not null references public.customers (id),     -- no cascade: money the salon holds
  event_id uuid references public.events (id) on delete set null,
  receipt_no text not null,
  amount numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  method public.pay_method not null check (not public.is_prepaid_method(method::text)),
  reference text check (reference is null or char_length(reference) <= 120),
  note text check (note is null or char_length(note) <= 300),
  received_at timestamptz not null default now(),
  received_by uuid references auth.users (id) on delete set null,
  applied_amount numeric(12,2) not null default 0 check (applied_amount >= 0),   -- used on bills that stand
  refunded_at timestamptz,
  refund_amount numeric(12,2) check (refund_amount is null or refund_amount > 0),
  refund_method public.pay_method check (refund_method is null or not public.is_prepaid_method(refund_method::text)),
  refund_reason text,
  refunded_by uuid references auth.users (id) on delete set null,
  unique (salon_id, receipt_no),
  check (applied_amount + coalesce(refund_amount, 0) <= amount),
  check ((refund_amount is null) = (refunded_at is null) and (refund_amount is null) = (refund_method is null))
);
create index on public.advance_payments (salon_id, received_at);
create index on public.advance_payments (customer_id);
create index on public.advance_payments (event_id) where event_id is not null;

alter table public.payments
  add column advance_id uuid references public.advance_payments (id) on delete set null;
create index on public.payments (advance_id) where advance_id is not null;

-- Same-salon checks for the new references.
drop trigger appointments_same_salon on public.appointments;
create trigger appointments_same_salon before insert or update on public.appointments
  for each row execute function public.check_same_salon('branch_id', 'branches', 'customer_id', 'customers', 'staff_id', 'staff', 'invoice_id', 'invoices',
                                                        'event_id', 'events');
drop trigger invoices_same_salon on public.invoices;
create trigger invoices_same_salon before insert or update on public.invoices
  for each row execute function public.check_same_salon('branch_id', 'branches', 'customer_id', 'customers', 'appointment_id', 'appointments',
                                                        'client_membership_id', 'client_memberships', 'event_id', 'events');
drop trigger payments_same_salon on public.payments;
create trigger payments_same_salon before insert or update on public.payments
  for each row execute function public.check_same_salon('invoice_id', 'invoices', 'advance_id', 'advance_payments');
create trigger events_same_salon before insert or update on public.events
  for each row execute function public.check_same_salon('customer_id', 'customers', 'trial_appointment_id', 'appointments');
create trigger advance_payments_same_salon before insert or update on public.advance_payments
  for each row execute function public.check_same_salon('customer_id', 'customers', 'event_id', 'events');

-- An event row can be edited by the front desk (title, time, address, quote, notes), but who it is for and whether
-- it was billed or cancelled change only through the functions below.
create or replace function public.guard_events() returns trigger
language plpgsql as $$
begin
  if public.is_trusted_writer() then return new; end if;
  if new.salon_id <> old.salon_id or new.customer_id <> old.customer_id or new.status is distinct from old.status
     or new.cancelled_at is distinct from old.cancelled_at or new.created_by is distinct from old.created_by
     or new.created_at <> old.created_at then
    raise exception 'Who the event is for and its status change only by checking out or cancelling it';
  end if;
  return new;
end $$;
create trigger events_guard before update on public.events for each row execute function public.guard_events();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.advance_payments enable row level security;
revoke all on public.events, public.advance_payments from anon;

-- Events: the whole team sees them (they are on the calendar); the front desk edits details; the client sees their own.
create policy events_staff_read on public.events for select using (public.is_member(salon_id));
create policy events_desk_update on public.events for update
  using (public.has_role(salon_id, '{owner,manager,receptionist}')) with check (public.has_role(salon_id, '{owner,manager,receptionist}'));
create policy events_customer_read on public.events for select using (customer_id in (select public.my_customer_ids()));
-- Advances are money: front desk and above, and the client's own. Written only by the functions below.
create policy advances_staff_read on public.advance_payments for select using (public.has_role(salon_id, '{owner,manager,receptionist}'));
create policy advances_customer_read on public.advance_payments for select using (customer_id in (select public.my_customer_ids()));

-- ---------------------------------------------------------------------------
-- Advances: record (front desk), refund (owner/manager), apply on a bill (internal)
-- ---------------------------------------------------------------------------
create or replace function public.record_advance(
  p_salon uuid, p_customer uuid, p_event uuid, p_amount numeric, p_method public.pay_method,
  p_reference text default null, p_note text default null
) returns public.advance_payments
language plpgsql security definer set search_path = public as $$
declare v_ev public.events; v_row public.advance_payments;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then raise exception 'You do not have permission to take advances'; end if;
  perform 1 from public.customers where id = p_customer and salon_id = p_salon for update;
  if not found then raise exception 'Client not found'; end if;
  if p_event is not null then
    select * into v_ev from public.events where id = p_event and salon_id = p_salon;
    if v_ev.id is null then raise exception 'Event not found'; end if;
    if v_ev.customer_id <> p_customer then raise exception 'That event is for another client'; end if;
    if v_ev.status = 'cancelled' then raise exception 'This event was cancelled'; end if;
    if v_ev.status = 'done' then raise exception 'This event has been billed. Take the money on its bill instead.'; end if;
  end if;
  -- (NaN compares greater than every number, so the upper bound also rejects NaN.)
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Enter the advance received'; end if;
  if p_method is null or public.is_prepaid_method(p_method::text) then
    raise exception 'Take the advance by cash, UPI or card. Coins can''t be used for an advance.';
  end if;
  insert into public.advance_payments (salon_id, customer_id, event_id, receipt_no, amount, method, reference, note, received_by)
  values (p_salon, p_customer, p_event, public.next_receipt_no(p_salon, 'advance', 'AR'), round(p_amount, 2), p_method,
          nullif(left(btrim(p_reference), 120), ''), nullif(left(btrim(p_note), 300), ''), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.refund_advance(p_advance uuid, p_amount numeric, p_method public.pay_method, p_reason text)
returns public.advance_payments
language plpgsql security definer set search_path = public as $$
declare v public.advance_payments; v_left numeric;
begin
  select * into v from public.advance_payments where id = p_advance for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager}') then raise exception 'Only an owner or manager can refund an advance'; end if;
  if v.refunded_at is not null then raise exception 'This advance was already refunded'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for the refund'; end if;
  v_left := v.amount - v.applied_amount;
  if p_amount is null or p_amount <= 0 or p_amount > v_left then
    raise exception 'Refund up to % (what is left of this advance)', public.fmt_inr(v_left);
  end if;
  if p_method is null or public.is_prepaid_method(p_method::text) then raise exception 'Say how the money was handed back: cash, UPI or card'; end if;
  update public.advance_payments set refunded_at = now(), refund_amount = round(p_amount, 2), refund_method = p_method,
         refund_reason = left(btrim(p_reason), 300), refunded_by = auth.uid()
   where id = v.id returning * into v;
  return v;
end $$;

-- Internal: pay p_amount of a bill from the client's advances (one advance, or the oldest first). Never more than
-- what is left; writes one 'advance' payment per advance used. Returns the amount applied.
create or replace function public.advance_apply(p_salon uuid, p_customer uuid, p_invoice uuid, p_amount numeric, p_advance uuid default null)
returns numeric
language plpgsql security definer set search_path = public as $$
declare r record; v_left numeric; v_take numeric; v_avail numeric;
begin
  if p_customer is null then raise exception 'Choose the client to use their advance'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Invalid advance amount'; end if;
  if p_advance is not null and not exists (select 1 from public.advance_payments where id = p_advance and salon_id = p_salon and customer_id = p_customer) then
    raise exception 'That advance belongs to another client';
  end if;
  v_left := round(p_amount, 2);
  for r in select * from public.advance_payments
            where salon_id = p_salon and customer_id = p_customer and (p_advance is null or id = p_advance)
              and amount - applied_amount - coalesce(refund_amount, 0) > 0
            order by received_at for update loop
    exit when v_left <= 0;
    v_avail := r.amount - r.applied_amount - coalesce(r.refund_amount, 0);
    v_take := least(v_left, v_avail);
    insert into public.payments (invoice_id, salon_id, method, amount, reference, advance_id, created_by)
    values (p_invoice, p_salon, 'advance', v_take, 'Advance ' || r.receipt_no, r.id, auth.uid());
    update public.advance_payments set applied_amount = applied_amount + v_take where id = r.id;
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    if v_left = round(p_amount, 2) then raise exception 'This client has no advance left to use'; end if;
    raise exception 'Only % advance left for this client', public.fmt_inr(round(p_amount, 2) - v_left);
  end if;
  return round(p_amount, 2);
end $$;
revoke execute on function public.advance_apply(uuid, uuid, uuid, numeric, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Events: create (front desk), cancel
-- p_data = {
--   "customer_id", "event_type", "title", "event_at" (ISO), "location": "salon"|"home", "address", "travel_charge",
--   "quoted_price", "notes",
--   "people": [{"name": "Bride", "service_ids": [uuid…], "staff_id": uuid, "start_at": ISO}],
--   "trial": {"start_at": ISO, "staff_id": uuid, "service_ids": [uuid…]} | null,
--   "advance": {"amount": 2000, "method": "upi", "reference": "…"} | null
-- }
-- ---------------------------------------------------------------------------
create or replace function public.create_event(p_salon uuid, p_data jsonb) returns public.events
language plpgsql security definer set search_path = public as $$
declare
  v_ev public.events; v_customer uuid := nullif(p_data ->> 'customer_id', '')::uuid;
  v_person jsonb; v_ids uuid[]; v_start timestamptz; v_staff uuid; v_dur integer; v_appt uuid; v_name text; v_n integer := 0;
  v_branch uuid; v_trial uuid; v_staff_name text; v_location text := coalesce(nullif(p_data ->> 'location', ''), 'salon');
  v_advance jsonb := p_data -> 'advance';
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then raise exception 'You do not have permission to book events'; end if;
  if v_customer is null or not exists (select 1 from public.customers where id = v_customer and salon_id = p_salon) then
    raise exception 'Choose the client';
  end if;
  if jsonb_typeof(p_data -> 'people') <> 'array' or jsonb_array_length(p_data -> 'people') = 0 then
    raise exception 'Add at least one person and their services';
  end if;
  if jsonb_array_length(p_data -> 'people') > 50 then raise exception 'Up to 50 people for one event'; end if;
  if v_location = 'home' and coalesce(btrim(p_data ->> 'address'), '') = '' then raise exception 'Enter the address for the home visit'; end if;
  select id into v_branch from public.branches where salon_id = p_salon and is_default;

  insert into public.events (salon_id, customer_id, event_type, title, event_at, location, address, travel_charge, quoted_price, people, notes, created_by)
  values (p_salon, v_customer, coalesce(p_data ->> 'event_type', 'bridal'), btrim(p_data ->> 'title'), (p_data ->> 'event_at')::timestamptz,
          v_location, case when v_location = 'home' then nullif(btrim(p_data ->> 'address'), '') end,
          case when v_location = 'home' then coalesce((p_data ->> 'travel_charge')::numeric, 0) else 0 end,
          (p_data ->> 'quoted_price')::numeric, jsonb_array_length(p_data -> 'people'), nullif(btrim(p_data ->> 'notes'), ''), auth.uid())
  returning * into v_ev;

  for v_person in select * from jsonb_array_elements(p_data -> 'people') loop
    v_n := v_n + 1;
    v_name := coalesce(nullif(btrim(v_person ->> 'name'), ''), 'Person ' || v_n);
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(v_person -> 'service_ids', '[]'::jsonb)) x;
    if cardinality(v_ids) = 0 then raise exception 'Pick the services for %', v_name; end if;
    if (select count(*) from public.services where id = any (v_ids) and salon_id = p_salon) <> (select count(distinct x) from unnest(v_ids) x) then
      raise exception 'A service for % is not on your menu. Refresh and try again.', v_name;
    end if;
    v_start := coalesce((v_person ->> 'start_at')::timestamptz, v_ev.event_at);
    v_staff := nullif(v_person ->> 'staff_id', '')::uuid;
    select sum(duration_min) into v_dur from public.services where id = any (v_ids) and salon_id = p_salon;
    begin
      insert into public.appointments (salon_id, branch_id, customer_id, staff_id, start_at, end_at, status, source, event_id, guest_name, notes, created_by)
      values (p_salon, v_branch, v_customer, v_staff, v_start, v_start + make_interval(mins => v_dur), 'booked', 'staff', v_ev.id, left(v_name, 60),
              v_ev.title || case when v_location = 'home' then ' · home visit' else '' end, auth.uid())
      returning id into v_appt;
    exception when exclusion_violation then
      select name into v_staff_name from public.staff where id = v_staff;
      raise exception '% is already booked then (for %). Pick another time or stylist.', coalesce(v_staff_name, 'That stylist'), v_name;
    end;
    insert into public.appointment_services (appointment_id, salon_id, service_id, name, price, duration_min, sort)
    select v_appt, p_salon, s.id, s.name, s.price, s.duration_min, u.ord
      from unnest(v_ids) with ordinality u(id, ord) join public.services s on s.id = u.id and s.salon_id = p_salon;
  end loop;

  -- The trial: a normal appointment for the client, weeks before (billed on its own).
  if jsonb_typeof(p_data -> 'trial') = 'object' and nullif(p_data #>> '{trial,start_at}', '') is not null then
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_data #> '{trial,service_ids}', '[]'::jsonb)) x;
    if cardinality(v_ids) = 0 then raise exception 'Pick the service for the trial'; end if;
    v_start := (p_data #>> '{trial,start_at}')::timestamptz;
    if v_start >= v_ev.event_at then raise exception 'The trial should be before the event'; end if;
    v_staff := nullif(p_data #>> '{trial,staff_id}', '')::uuid;
    select sum(duration_min) into v_dur from public.services where id = any (v_ids) and salon_id = p_salon;
    if v_dur is null then raise exception 'The trial service is not on your menu'; end if;
    begin
      insert into public.appointments (salon_id, branch_id, customer_id, staff_id, start_at, end_at, status, source, guest_name, notes, created_by)
      values (p_salon, v_branch, v_customer, v_staff, v_start, v_start + make_interval(mins => v_dur), 'booked', 'staff', 'Trial',
              'Trial for ' || v_ev.title, auth.uid())
      returning id into v_trial;
    exception when exclusion_violation then
      select name into v_staff_name from public.staff where id = v_staff;
      raise exception '% is already booked at the trial time. Pick another time or stylist.', coalesce(v_staff_name, 'That stylist');
    end;
    insert into public.appointment_services (appointment_id, salon_id, service_id, name, price, duration_min, sort)
    select v_trial, p_salon, s.id, s.name, s.price, s.duration_min, u.ord
      from unnest(v_ids) with ordinality u(id, ord) join public.services s on s.id = u.id and s.salon_id = p_salon;
    perform set_config('styile.internal', 'on', true);
    update public.events set trial_appointment_id = v_trial where id = v_ev.id returning * into v_ev;
  end if;

  if jsonb_typeof(v_advance) = 'object' and coalesce((v_advance ->> 'amount')::numeric, 0) > 0 then
    perform public.record_advance(p_salon, v_customer, v_ev.id, (v_advance ->> 'amount')::numeric,
                                  (v_advance ->> 'method')::public.pay_method, v_advance ->> 'reference', null);
  end if;
  return v_ev;
end $$;

-- Cancel an event: its appointments are cancelled. Advances stay with the client until a refund is recorded
-- (per the salon's policy — nothing is forfeited automatically).
create or replace function public.cancel_event(p_event uuid, p_reason text) returns public.events
language plpgsql security definer set search_path = public as $$
declare v public.events;
begin
  select * into v from public.events where id = p_event for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager,receptionist}') then raise exception 'Event not found'; end if;
  if v.status = 'cancelled' then return v; end if;
  if v.status = 'done' then raise exception 'This event has been billed. Cancel its bill first.'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for cancelling the event'; end if;
  update public.appointments set status = 'cancelled', cancelled_reason = 'Event cancelled: ' || left(btrim(p_reason), 200)
   where (event_id = v.id or id = v.trial_appointment_id) and status in ('booked', 'confirmed', 'waiting');
  perform set_config('styile.internal', 'on', true);
  update public.events set status = 'cancelled', cancelled_at = now(), cancel_reason = left(btrim(p_reason), 300)
   where id = v.id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Billing: create_invoice from 0012 (every check, coins, GST modes, packages and member prices unchanged), plus:
-- * "event_id": checking out an event — every person's appointment is completed on this bill, once;
-- * a payment {"method": "advance", "amount", "advance_id"?} is taken from the client's advances (never more than
--   what is left of them).
-- ---------------------------------------------------------------------------
create or replace function public.create_invoice(p_salon uuid, p_data jsonb) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  v_salon public.salons;
  v_inv public.invoices;
  v_item jsonb;
  v_pay jsonb;
  v_qty numeric; v_price numeric; v_disc numeric; v_rate numeric; v_gross numeric; v_taxable numeric; v_tax numeric; v_line numeric;
  v_subtotal numeric := 0; v_disc_total numeric := 0; v_taxable_total numeric := 0; v_tax_total numeric := 0; v_lines numeric := 0;
  v_total numeric; v_paid numeric := 0; v_cgst numeric; v_no text; v_sort integer := 0;
  v_customer uuid := nullif(p_data ->> 'customer_id', '')::uuid;
  v_appt uuid := nullif(p_data ->> 'appointment_id', '')::uuid;
  -- GST
  v_kind text; v_service uuid; v_svc public.services; v_sent_rate numeric; v_code text; v_statutory numeric; v_bill_type text;
  v_client_gstin text := nullif(upper(regexp_replace(coalesce(p_data ->> 'client_gstin', ''), '\s', '', 'g')), '');
  v_client_address text := nullif(btrim(regexp_replace(coalesce(p_data ->> 'client_address', ''), '\s+', ' ', 'g')), '');
  c_sac constant text[] := array['999721', '999722', '999723', '999729'];
  -- Packages and memberships
  v_today date;
  v_member public.client_memberships;
  v_member_used boolean := false;
  v_member_disc numeric; v_pct numeric; v_note text;
  v_cp_id uuid; v_cp public.client_packages; v_cpi public.client_package_items;
  v_pkg_pays jsonb := '[]'::jsonb; v_amt numeric;
  v_visit boolean := false;
  v_card_sale boolean := coalesce(current_setting('styile.membership_sale', true), '') = 'on';
  -- Events and advances
  v_event uuid := nullif(p_data ->> 'event_id', '')::uuid;
  v_ev public.events;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then
    raise exception 'You do not have permission to bill';
  end if;
  if jsonb_typeof(p_data -> 'items') <> 'array' or jsonb_array_length(p_data -> 'items') = 0 then
    raise exception 'Add at least one item to the bill';
  end if;
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and salon_id = p_salon) then
    raise exception 'Client not found';
  end if;
  if v_appt is not null then
    -- Lock the appointment so two checkouts can't both bill it (and double the client's visit stats).
    perform 1 from public.appointments where id = v_appt and salon_id = p_salon for update;
    if not found then raise exception 'Appointment not found'; end if;
    if exists (select 1 from public.invoices where appointment_id = v_appt and status <> 'void') then
      raise exception 'This appointment already has a bill';
    end if;
  end if;
  if v_event is not null then
    -- Lock the event so two checkouts can't both bill it.
    select * into v_ev from public.events where id = v_event and salon_id = p_salon for update;
    if v_ev.id is null then raise exception 'Event not found'; end if;
    if v_customer is distinct from v_ev.customer_id then raise exception 'Bill the event to its client'; end if;
    if v_ev.status = 'cancelled' then raise exception 'This event was cancelled'; end if;
    if exists (select 1 from public.invoices where event_id = v_event and status <> 'void') then
      raise exception 'This event already has a bill';
    end if;
  end if;

  perform set_config('styile.internal', 'on', true);
  update public.salons set next_invoice_no = next_invoice_no + 1 where id = p_salon returning * into v_salon;
  v_no := v_salon.invoice_prefix || '-' || lpad((v_salon.next_invoice_no - 1)::text, 5, '0');

  -- GST mode of this bill (salons_gstin_when_registered guarantees a GSTIN for composition/regular).
  v_bill_type := case v_salon.gst_mode when 'regular' then 'tax_invoice' when 'composition' then 'bill_of_supply' else 'bill' end;
  v_today := (now() at time zone v_salon.timezone)::date;
  v_statutory := public.service_gst_rate(v_today);
  if v_client_gstin is not null then
    if v_salon.gst_mode <> 'regular' then
      raise exception 'A client GSTIN goes on tax invoices only. Your salon isn''t set up for regular GST.';
    end if;
    if not public.valid_business_gstin(v_client_gstin) then
      raise exception 'Client GSTIN should be 15 characters, like 19ABCDE1234F1Z5';
    end if;
  end if;
  if char_length(v_client_address) > 240 then raise exception 'Keep the client address under 240 characters'; end if;

  -- The client's membership card that is valid today, if any (the discount is decided here, not by the app).
  if v_customer is not null then
    select * into v_member from public.client_memberships
     where salon_id = p_salon and customer_id = v_customer and status = 'active' and starts_on <= v_today and ends_on >= v_today
     order by ends_on desc limit 1;
  end if;

  insert into public.invoices (salon_id, branch_id, invoice_no, customer_id, appointment_id, prices_include_tax,
                               subtotal, discount_total, taxable_total, cgst, sgst, round_off, total, paid_total, status, notes, created_by,
                               gst_mode, bill_type, seller_gstin, place_of_supply, client_gstin, client_address, event_id)
  values (p_salon, (select id from public.branches where salon_id = p_salon and is_default), v_no, v_customer, v_appt,
          v_salon.prices_include_tax, 0, 0, 0, 0, 0, 0, 0, 0, 'unpaid', p_data ->> 'notes', auth.uid(),
          v_salon.gst_mode, v_bill_type,
          case when v_salon.gst_mode <> 'unregistered' then v_salon.gstin end,
          case when v_salon.gst_mode = 'regular' then public.gst_place_of_supply(v_salon.state, v_salon.gstin) end,
          v_client_gstin, v_client_address, v_event)
  returning * into v_inv;

  for v_item in select * from jsonb_array_elements(p_data -> 'items') loop
    v_sort := v_sort + 1;
    v_qty := coalesce((v_item ->> 'qty')::numeric, 1);
    v_price := (v_item ->> 'unit_price')::numeric;
    v_disc := coalesce((v_item ->> 'discount')::numeric, 0);
    -- (NaN compares greater than every number, so the upper bounds also reject NaN and Infinity.)
    if v_qty <= 0 or v_qty > 10000 or v_price is null or v_price < 0 or v_price > 10000000 or v_disc < 0 or v_disc > 10000000 then
      raise exception 'Invalid line item';
    end if;

    v_kind := coalesce(v_item ->> 'kind', 'custom');
    v_service := nullif(v_item ->> 'service_id', '')::uuid;
    v_sent_rate := (v_item ->> 'gst_rate')::numeric;
    v_code := nullif(btrim(coalesce(v_item ->> 'code', '')), '');
    v_svc := null;
    v_cp_id := nullif(v_item ->> 'client_package_id', '')::uuid;
    v_cp := null; v_cpi := null; v_member_disc := 0; v_note := null;
    if v_kind not in ('service', 'product', 'custom', 'membership') then raise exception 'Unknown kind of bill line'; end if;
    if v_kind = 'membership' and not v_card_sale then
      raise exception 'Sell membership cards from the client''s profile';
    end if;
    if v_kind <> 'membership' then v_visit := true; end if;
    if v_sent_rate is not null and v_sent_rate not in (0, 5, 12, 18, 28) then
      raise exception 'GST rate must be 0, 5, 12, 18 or 28%%';
    end if;
    if v_code is not null and v_code !~ '^[0-9]{4}([0-9]{2}){0,2}$' then
      raise exception 'HSN/SAC code for “%” should be 4, 6 or 8 digits', v_item ->> 'name';
    end if;

    if v_kind = 'service' then
      -- Never trust a rate sent for a service: the menu's override, else the law on today's date.
      if v_service is not null then
        select * into v_svc from public.services where id = v_service and salon_id = p_salon;
        if not found then raise exception 'That service is not part of this salon. Refresh and try again.'; end if;
      end if;
      v_rate := coalesce(v_svc.gst_rate, v_statutory);
      v_code := coalesce(v_svc.sac_code, case when v_code = any (c_sac) then v_code end, '999721');
    elsif v_kind = 'product' then
      if v_sent_rate is null and v_salon.gst_mode = 'regular' then
        raise exception 'Choose the GST rate for “%”: 5%% for hair care and soaps, 18%% for cosmetics and skincare', v_item ->> 'name';
      end if;
      v_rate := v_sent_rate;
    elsif v_kind = 'membership' then
      -- The card fee is a salon service ("other beauty"), at the service rate.
      v_rate := v_statutory;
      v_code := '999729';
    else
      -- Anything else billed at the desk (an add-on, a package) is a salon service unless a rate is given.
      v_rate := coalesce(v_sent_rate, v_statutory);
      if v_sent_rate is null then v_code := case when v_code = any (c_sac) then v_code else '999729' end; end if;
    end if;
    -- Unregistered and composition salons must not collect tax.
    if v_salon.gst_mode <> 'regular' then v_rate := 0; end if;

    if v_cp_id is not null then
      -- A session from the client's package: priced at the session's value, paid with 'package' below.
      if v_kind <> 'service' or v_service is null then raise exception 'Only a service from your menu can be taken from a package'; end if;
      if v_customer is null then raise exception 'Choose the client to use their package'; end if;
      if v_qty <> trunc(v_qty) then raise exception 'Package sessions are whole numbers'; end if;
      select * into v_cp from public.client_packages where id = v_cp_id and salon_id = p_salon for update;
      if v_cp.id is null then raise exception 'Package not found at this salon'; end if;
      if v_cp.customer_id <> v_customer then raise exception 'That package belongs to another client'; end if;
      if v_cp.status = 'cancelled' then raise exception '“%” was cancelled', v_cp.name; end if;
      if v_cp.status = 'expired' or v_cp.expires_on < v_today then
        raise exception '“%” expired on %', v_cp.name, to_char(v_cp.expires_on, 'FMDD Mon YYYY');
      end if;
      select * into v_cpi from public.client_package_items where client_package_id = v_cp.id and service_id = v_service for update;
      if v_cpi.id is null then raise exception '“%” isn''t part of the package “%”', v_item ->> 'name', v_cp.name; end if;
      if v_cpi.sessions_used >= v_cpi.sessions_total then
        raise exception 'All % sessions in “%” are used', v_cpi.name, v_cp.name;
      end if;
      if v_cpi.sessions_used + v_qty > v_cpi.sessions_total then
        raise exception 'Only % % session% left in “%”', v_cpi.sessions_total - v_cpi.sessions_used, v_cpi.name,
          case when v_cpi.sessions_total - v_cpi.sessions_used = 1 then '' else 's' end, v_cp.name;
      end if;
      update public.client_package_items set sessions_used = sessions_used + v_qty::integer where id = v_cpi.id;
      update public.client_packages set status = 'used'
       where id = v_cp.id and not exists (select 1 from public.client_package_items where client_package_id = v_cp.id and sessions_used < sessions_total);
      v_price := v_cpi.unit_value;
      v_disc := 0;
      v_note := 'Package';
    elsif v_member.id is not null and v_kind in ('service', 'product') then
      v_pct := case v_kind when 'service' then v_member.service_discount_pct else v_member.product_discount_pct end;
      if v_pct > 0 then
        v_member_disc := round(round(v_qty * v_price, 2) * v_pct / 100, 2);
        if v_member_disc > 0 then
          v_disc := v_disc + v_member_disc;
          v_note := 'Member ' || trim_scale(v_pct)::text || '%';
          v_member_used := true;
        end if;
      end if;
    end if;

    v_gross := round(v_qty * v_price, 2);
    if v_disc > v_gross then raise exception 'Discount is larger than the item price'; end if;
    v_gross := v_gross - v_disc;
    if v_salon.prices_include_tax then
      v_taxable := round(v_gross * 100 / (100 + v_rate), 2);
      v_tax := v_gross - v_taxable;
      v_line := v_gross;
    else
      v_taxable := v_gross;
      v_tax := round(v_gross * v_rate / 100, 2);
      v_line := v_gross + v_tax;
    end if;

    insert into public.invoice_items (invoice_id, salon_id, kind, service_id, staff_id, name, qty, unit_price, discount, gst_rate, taxable, tax, line_total, sort, code,
                                      client_package_id, client_package_item_id, member_discount, discount_note)
    values (v_inv.id, p_salon, v_kind, v_service,
            nullif(v_item ->> 'staff_id', '')::uuid, v_item ->> 'name', v_qty, v_price, v_disc, v_rate, v_taxable, v_tax, v_line, v_sort, v_code,
            v_cp.id, v_cpi.id, v_member_disc, v_note);

    -- The session's value (before any GST added on top) is paid from the package.
    if v_cpi.id is not null and v_gross > 0 then
      v_pkg_pays := v_pkg_pays || jsonb_build_object('amount', v_gross, 'reference', v_cp.receipt_no || ' · ' || v_cp.name);
    end if;

    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_disc_total := v_disc_total + v_disc;
    v_taxable_total := v_taxable_total + v_taxable;
    v_tax_total := v_tax_total + v_tax;
    v_lines := v_lines + v_line;
  end loop;

  v_total := round(v_lines, 0);
  v_cgst := round(v_tax_total / 2, 2);

  -- Package sessions first (never more than the bill after rounding), then what the client paid now.
  for v_pay in select * from jsonb_array_elements(v_pkg_pays) loop
    v_amt := least((v_pay ->> 'amount')::numeric, v_total - v_paid);
    if v_amt > 0 then
      insert into public.payments (invoice_id, salon_id, method, amount, reference, created_by)
      values (v_inv.id, p_salon, 'package', v_amt, v_pay ->> 'reference', auth.uid());
      v_paid := v_paid + v_amt;
    end if;
  end loop;

  if jsonb_typeof(p_data -> 'payments') = 'array' then
    for v_pay in select * from jsonb_array_elements(p_data -> 'payments') loop
      if coalesce((v_pay ->> 'amount')::numeric, 0) > 0 then
        if (v_pay ->> 'method') = 'package' then
          raise exception 'Package sessions are paid automatically. Pick “Use package” on the service instead.';
        end if;
        -- Advance: taken from what the bill's client paid earlier (a given advance, or the oldest first).
        if (v_pay ->> 'method') = 'advance' then
          v_paid := v_paid + public.advance_apply(p_salon, v_customer, v_inv.id, (v_pay ->> 'amount')::numeric, nullif(v_pay ->> 'advance_id', '')::uuid);
          continue;
        end if;
        insert into public.payments (invoice_id, salon_id, method, amount, reference, created_by)
        values (v_inv.id, p_salon, (v_pay ->> 'method')::public.pay_method, (v_pay ->> 'amount')::numeric, v_pay ->> 'reference', auth.uid());
        v_paid := v_paid + (v_pay ->> 'amount')::numeric;
        -- Coins: taken from the bill's client (fails with the balance if there aren't enough).
        if (v_pay ->> 'method') = 'wallet' then
          perform public.coin_spend(p_salon, v_customer, v_inv.id, (v_pay ->> 'amount')::numeric);
        end if;
      end if;
    end loop;
  end if;
  if v_paid > v_total then raise exception 'Payments add up to more than the bill total'; end if;

  update public.invoices set
    subtotal = v_subtotal, discount_total = v_disc_total, taxable_total = v_taxable_total,
    cgst = v_cgst, sgst = v_tax_total - v_cgst, round_off = v_total - v_lines, total = v_total, paid_total = v_paid,
    status = case when v_paid >= v_total then 'paid'::public.invoice_status when v_paid > 0 then 'partial' else 'unpaid' end,
    -- Composition: the salon pays 6% of its turnover itself; an estimate for reports, never shown to the client.
    composition_tax = case when v_salon.gst_mode = 'composition' then round(v_total * 6 / 100, 2) else 0 end,
    client_membership_id = case when v_member_used then v_member.id end
  where id = v_inv.id returning * into v_inv;

  if v_appt is not null then
    update public.appointments set status = 'completed', invoice_id = v_inv.id
     where id = v_appt and salon_id = p_salon;
  end if;
  if v_event is not null then
    -- Everyone's appointments for the event are done, on this bill.
    update public.appointments set status = 'completed', invoice_id = v_inv.id
     where event_id = v_event and salon_id = p_salon and status not in ('cancelled', 'no_show');
    perform set_config('styile.internal', 'on', true);
    update public.events set status = 'done' where id = v_event;
  end if;

  if v_customer is not null then
    -- Buying a membership card on its own isn't a visit.
    update public.customers set
      visit_count = visit_count + case when v_visit then 1 else 0 end,
      total_spent = total_spent + v_total,
      last_visit_at = case when v_visit then now() else last_visit_at end
    where id = v_customer;
  end if;

  return v_inv;
end $$;


-- Record a later payment (0012, plus: 'advance' takes it from the bill's client's advances).
create or replace function public.add_payment(p_invoice uuid, p_method public.pay_method, p_amount numeric, p_reference text default null)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager,receptionist}') then raise exception 'Bill not found'; end if;
  if v.status = 'void' then raise exception 'This bill was cancelled'; end if;
  if p_method::text = 'package' then raise exception 'Package sessions are taken when the bill is made. Record cash, UPI or card here.'; end if;
  if p_amount <= 0 or v.paid_total + p_amount > v.total then raise exception 'Amount is more than what is due'; end if;
  if p_method::text = 'advance' then
    -- From the bill's client's advances, oldest first (writes the payment rows itself).
    perform public.advance_apply(v.salon_id, v.customer_id, v.id, p_amount, null);
  else
    insert into public.payments (invoice_id, salon_id, method, amount, reference, created_by)
    values (v.id, v.salon_id, p_method, p_amount, p_reference, auth.uid());
  end if;
  if p_method = 'wallet' then
    perform public.coin_spend(v.salon_id, v.customer_id, v.id, p_amount);
  end if;
  update public.invoices set paid_total = paid_total + p_amount,
         status = case when paid_total + p_amount >= total then 'paid'::public.invoice_status else 'partial' end
   where id = v.id returning * into v;
  return v;
end $$;


-- Cancel a bill (0012, plus: advances used on it can be used again; an event billed on it is open again).
create or replace function public.void_invoice(p_invoice uuid, p_reason text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v public.invoices; r record; v_visit boolean;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager}') then raise exception 'Only an owner or manager can cancel bills'; end if;
  if v.status = 'void' then return v; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling the bill'; end if;
  update public.invoices set status = 'void', voided_at = now(), void_reason = p_reason where id = v.id returning * into v;
  v_visit := exists (select 1 from public.invoice_items where invoice_id = v.id and kind <> 'membership');
  if v.customer_id is not null then
    update public.customers set total_spent = greatest(total_spent - v.total, 0),
           visit_count = greatest(visit_count - case when v_visit then 1 else 0 end, 0)
     where id = v.customer_id;
  end if;
  -- Return coins spent on this bill (net of any earlier refund) to whoever paid with them.
  for r in select customer_id, -sum(coins) as net from public.coin_transactions
            where invoice_id = v.id and kind in ('spend', 'refund') group by customer_id loop
    if r.net > 0 then
      perform public.coin_post(v.salon_id, r.customer_id, 'refund', r.net, p_invoice => v.id,
                               p_note => 'Bill ' || v.invoice_no || ' cancelled');
    end if;
  end loop;
  -- Give package sessions back. A package that was used up is active again (its expiry still applies).
  for r in select client_package_item_id as item, sum(qty)::integer as n from public.invoice_items
            where invoice_id = v.id and client_package_item_id is not null group by 1 loop
    update public.client_package_items set sessions_used = greatest(sessions_used - r.n, 0) where id = r.item;
    update public.client_packages cp set status = 'active'
      from public.client_package_items i where i.id = r.item and cp.id = i.client_package_id and cp.status = 'used';
  end loop;
  -- Advances used on this bill can be used again.
  for r in select advance_id, sum(amount) as amt from public.payments where invoice_id = v.id and advance_id is not null group by 1 loop
    update public.advance_payments set applied_amount = greatest(applied_amount - r.amt, 0) where id = r.advance_id;
  end loop;
  -- An event billed here is open again (to be billed afresh).
  if v.event_id is not null then
    perform set_config('styile.internal', 'on', true);
    update public.events set status = 'booked' where id = v.event_id and status = 'done';
  end if;
  -- A membership card sold on this bill ends with it.
  update public.client_memberships set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Bill ' || v.invoice_no || ' cancelled'
   where invoice_id = v.id and status <> 'cancelled';
  return v;
end $$;


-- ---------------------------------------------------------------------------
-- Reports: everything from 0012, plus advances and events.
-- ---------------------------------------------------------------------------
create or replace function public.salon_report(p_salon uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v jsonb; v_today date; v_fy_from date;
begin
  if not public.has_role(p_salon, '{owner,manager}') then raise exception 'Reports are available to owners and managers'; end if;
  select timezone into v_tz from public.salons where id = p_salon;
  v_today := (now() at time zone v_tz)::date;
  v_fy_from := make_date(extract(year from v_today)::int - case when extract(month from v_today) < 4 then 1 else 0 end, 4, 1);

  with inv as (
    select * from public.invoices
     where salon_id = p_salon and status <> 'void'
       and (created_at at time zone v_tz)::date between p_from and p_to
  ), items as (
    select ii.* from public.invoice_items ii join inv on inv.id = ii.invoice_id
  ), appts as (
    select * from public.appointments
     where salon_id = p_salon and (start_at at time zone v_tz)::date between p_from and p_to
  ), coin_tx as (
    select * from public.coin_transactions
     where salon_id = p_salon and (created_at at time zone v_tz)::date between p_from and p_to
  ), pkg_sold as (
    select * from public.client_packages
     where salon_id = p_salon and (purchased_at at time zone v_tz)::date between p_from and p_to
  ), pkg_open as (     -- sessions clients can still use today
    select i.* from public.client_package_items i join public.client_packages cp on cp.id = i.client_package_id
     where cp.salon_id = p_salon and cp.status = 'active' and cp.expires_on >= v_today
  ), mem_sold as (
    select m.* from public.client_memberships m
     where m.salon_id = p_salon and m.status <> 'cancelled' and (m.created_at at time zone v_tz)::date between p_from and p_to
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(total) from inv), 0),
    'collected', coalesce((select sum(paid_total) from inv), 0),
    'tax', coalesce((select sum(cgst + sgst + igst) from inv where gst_mode = 'regular'), 0),
    'composition_tax', coalesce((select sum(composition_tax) from inv), 0),
    'fy_turnover', coalesce((select sum(taxable_total) from public.invoices
                              where salon_id = p_salon and status <> 'void'
                                and (created_at at time zone v_tz)::date between v_fy_from and v_today), 0),
    'fy_from', v_fy_from,
    'bills', (select count(*) from inv),
    'avg_bill', coalesce((select round(avg(total), 0) from inv), 0),
    'new_clients', (select count(*) from public.customers c where c.salon_id = p_salon
                      and (c.created_at at time zone v_tz)::date between p_from and p_to),
    'appointments', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                       from (select status, count(*) n from appts group by status) s),
    'by_source', (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb)
                    from (select source, count(*) n from appts where status <> 'cancelled' group by source) s),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'revenue', r, 'bills', b) order by d), '[]'::jsonb)
                 from (select (created_at at time zone v_tz)::date d, sum(total) r, count(*) b from inv group by 1) s),
    'by_staff', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', s.staff_id, 'name', st.name, 'color', st.color,
                         'revenue', s.rev, 'services', s.n, 'commission', round(s.rev * st.commission_pct / 100, 2)) order by s.rev desc), '[]'::jsonb)
                   from (select staff_id, sum(taxable) rev, count(*) n from items where staff_id is not null group by staff_id) s
                   join public.staff st on st.id = s.staff_id),
    'by_service', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'revenue', rev, 'count', n) order by rev desc), '[]'::jsonb)
                     from (select name, sum(line_total) rev, sum(qty) n from items group by name order by 2 desc limit 10) s),
    'by_method', (select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb)
                    from (select p.method, sum(p.amount) amt from public.payments p join inv on inv.id = p.invoice_id group by p.method) s),
    -- Coins: money received for coins (an advance, not revenue), bonus coins given, coins used on bills
    -- (net of refunds from cancelled bills), and what all clients hold right now.
    'coins_sold', coalesce((select sum(amount_paid) from coin_tx where kind = 'load'), 0),
    'coins_bonus', coalesce((select sum(coins) from coin_tx where kind = 'bonus'), 0),
    'coins_redeemed', coalesce((select -sum(coins) from coin_tx where kind in ('spend', 'refund')), 0),
    'coins_outstanding', coalesce((select sum(coin_balance) from public.customers where salon_id = p_salon), 0),
    -- Packages: money received for packages sold (an advance, not revenue), sessions used on bills in the range
    -- and their value, and the sessions clients can still use today (what the salon still owes in services).
    'packages_sold', (select count(*) from pkg_sold),
    'packages_sold_amount', coalesce((select sum(amount_paid) from pkg_sold), 0),
    'packages_refunded', coalesce((select sum(refund_amount) from public.client_packages
                                    where salon_id = p_salon and (cancelled_at at time zone v_tz)::date between p_from and p_to), 0),
    'package_sessions_redeemed', coalesce((select sum(qty) from items where client_package_item_id is not null), 0),
    'package_redeemed_value', coalesce((select sum(p.amount) from public.payments p join inv on inv.id = p.invoice_id where p.method::text = 'package'), 0),
    'package_sessions_outstanding', coalesce((select sum(sessions_total - sessions_used) from pkg_open), 0),
    'package_outstanding_value', coalesce((select sum((sessions_total - sessions_used) * unit_value) from pkg_open), 0),
    -- Membership cards sold in the range (their fees are already bills in revenue), discounts members got, members now.
    'memberships_sold', (select count(*) from mem_sold),
    'memberships_amount', coalesce((select sum(fee) from mem_sold), 0),
    'member_discounts', coalesce((select sum(member_discount) from items), 0),
    'active_members', (select count(distinct customer_id) from public.client_memberships
                        where salon_id = p_salon and status = 'active' and starts_on <= v_today and ends_on >= v_today),
    -- Advances: money received in the range (not revenue), used on bills in the range, refunded, and held now.
    'advances_received', coalesce((select sum(amount) from public.advance_payments
                                    where salon_id = p_salon and (received_at at time zone v_tz)::date between p_from and p_to), 0),
    'advances_applied', coalesce((select sum(p.amount) from public.payments p join inv on inv.id = p.invoice_id where p.method::text = 'advance'), 0),
    'advances_refunded', coalesce((select sum(refund_amount) from public.advance_payments
                                    where salon_id = p_salon and (refunded_at at time zone v_tz)::date between p_from and p_to), 0),
    'advances_outstanding', coalesce((select sum(amount - applied_amount - coalesce(refund_amount, 0)) from public.advance_payments where salon_id = p_salon), 0),
    'events_in_range', (select count(*) from public.events
                         where salon_id = p_salon and status <> 'cancelled' and (event_at at time zone v_tz)::date between p_from and p_to),
    'events_upcoming', (select count(*) from public.events where salon_id = p_salon and status = 'booked' and event_at >= now())
  ) into v;
  return v;
end $$;


-- ---------------------------------------------------------------------------
-- day_summary from 0012, plus advances: money received on the day it was received (by method), money handed back
-- on the day refunded; 'advance' payments on bills are not money that day (is_prepaid_method), so nothing is counted twice.
-- ---------------------------------------------------------------------------
create or replace function public.day_summary(p_salon uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text; v_start timestamptz; v_end timestamptz;
  v_prev public.day_closes;
  v_open numeric := 0; v_open_nu numeric := 0;
  v jsonb;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then
    raise exception 'Day close is for the owner, managers and the front desk';
  end if;
  if p_date is null then raise exception 'Pick a date'; end if;
  select timezone into v_tz from public.salons where id = p_salon;
  if v_tz is null then raise exception 'Salon not found'; end if;
  -- The salon-local day as an instant range (correct across time zones and DST).
  v_start := p_date::timestamp at time zone v_tz;
  v_end := (p_date + 1)::timestamp at time zone v_tz;

  select * into v_prev from public.day_closes
   where salon_id = p_salon and business_date < p_date order by business_date desc limit 1;
  if v_prev.id is not null then
    v_open := v_prev.counted_cash - v_prev.cash_out;
    v_open_nu := coalesce(v_prev.counted_cash_nu, 0) - coalesce(v_prev.cash_out_nu, 0);
  end if;

  with inv as (        -- bills raised this day that still stand
    select i.* from public.invoices i
     where i.salon_id = p_salon and i.created_at >= v_start and i.created_at < v_end and i.status <> 'void'
  ), voided as (       -- bills cancelled this day, whenever they were raised
    select i.* from public.invoices i
     where i.salon_id = p_salon and i.status = 'void' and i.voided_at >= v_start and i.voided_at < v_end
  ), pay as (          -- payments recorded this day, on any bill
    select p.method::text as method, p.amount, p.created_by from public.payments p
     where p.salon_id = p_salon and p.created_at >= v_start and p.created_at < v_end
  ), refund as (       -- what had been paid on the bills cancelled this day: handed back
    select p.method::text as method, p.amount from public.payments p join voided on voided.id = p.invoice_id
  ), ctx as (
    select t.* from public.coin_transactions t
     where t.salon_id = p_salon and t.created_at >= v_start and t.created_at < v_end
  ), loads as (        -- money received for coins sold this day
    select t.method::text as method, t.amount_paid as amount, t.created_by from ctx t where t.kind = 'load'
  ), pkg as (          -- money received for packages sold this day
    select cp.method::text as method, cp.amount_paid as amount, cp.created_by from public.client_packages cp
     where cp.salon_id = p_salon and cp.purchased_at >= v_start and cp.purchased_at < v_end
  ), pkg_refund as (   -- money handed back on packages cancelled this day
    select cp.refund_method::text as method, cp.refund_amount as amount from public.client_packages cp
     where cp.salon_id = p_salon and cp.cancelled_at >= v_start and cp.cancelled_at < v_end and cp.refund_amount > 0
  ), adv as (          -- advances received this day (bridal and event bookings)
    select a.method::text as method, a.amount, a.received_by as created_by from public.advance_payments a
     where a.salon_id = p_salon and a.received_at >= v_start and a.received_at < v_end
  ), adv_refund as (   -- advances handed back this day
    select a.refund_method::text as method, a.refund_amount as amount from public.advance_payments a
     where a.salon_id = p_salon and a.refunded_at >= v_start and a.refunded_at < v_end and a.refund_amount > 0
  ), items as (
    select ii.* from public.invoice_items ii join inv on inv.id = ii.invoice_id
  ), exp as (
    select * from public.expenses e where e.salon_id = p_salon and e.spent_on = p_date
  ), methods as (
    select method from pay union select method from loads union select method from refund
    union select method from pkg union select method from pkg_refund
    union select method from adv union select method from adv_refund
  ), by_method as (
    select m.method,
           coalesce((select sum(amount) from pay where pay.method = m.method), 0) as bills,
           coalesce((select sum(amount) from loads where loads.method = m.method), 0) as coins,
           coalesce((select sum(amount) from pkg where pkg.method = m.method), 0) as packages,
           coalesce((select sum(amount) from adv where adv.method = m.method), 0) as advances,
           coalesce((select sum(amount) from refund where refund.method = m.method), 0)
             + coalesce((select sum(amount) from pkg_refund where pkg_refund.method = m.method), 0)
             + coalesce((select sum(amount) from adv_refund where adv_refund.method = m.method), 0) as refunds
      from methods m
  ), member as (       -- a login's name in this salon: their staff record, else their profile
    select sm.user_id, sm.staff_id, coalesce(st.name, pr.full_name, 'Team member') as name
      from public.salon_members sm
      left join public.staff st on st.id = sm.staff_id
      left join public.profiles pr on pr.id = sm.user_id
     where sm.salon_id = p_salon
  ), takers as (       -- money taken, by the login that recorded it (coins and package sessions are not money)
    select created_by, method, amount from pay where not public.is_prepaid_method(method)
    union all
    select created_by, method, amount from loads
    union all
    select created_by, method, amount from pkg
    union all
    select created_by, method, amount from adv
  ), coll as (
    select staff_id, user_id, jsonb_object_agg(method, amt) as by_method, sum(amt) as total from (
      select m.staff_id, case when m.staff_id is null then t.created_by end as user_id, t.method, sum(t.amount) as amt
        from takers t left join public.salon_members m on m.salon_id = p_salon and m.user_id = t.created_by
       group by 1, 2, 3
    ) s group by 1, 2
  ), work as (         -- services and sales (before GST) by the stylist on each bill line
    select staff_id, count(*) filter (where kind = 'service') as services, sum(taxable) as sales
      from items where staff_id is not null group by staff_id
  ), staff_rows as (
    select coalesce(w.staff_id, c.staff_id) as staff_id, c.user_id,
           coalesce(w.services, 0) as services, coalesce(w.sales, 0) as sales,
           coalesce(c.by_method, '{}'::jsonb) as collected_by_method, coalesce(c.total, 0) as collected
      from work w full join coll c on c.staff_id = w.staff_id
  )
  select jsonb_build_object(
    'date', p_date,
    'timezone', v_tz,
    'opening', jsonb_build_object('cash', v_open, 'cash_nu', v_open_nu, 'from_date', v_prev.business_date),
    'totals', (
      select jsonb_build_object(
        'bills', (select count(*) from inv),
        'sales', coalesce((select sum(total) from inv), 0),
        'taxable', coalesce((select sum(taxable_total) from inv), 0),
        'tax', coalesce((select sum(cgst + sgst + igst) from inv), 0),
        'discounts', coalesce((select sum(discount_total) from inv), 0),
        'discounted_bills', (select count(*) from inv where discount_total > 0),
        'due', coalesce((select sum(greatest(total - paid_total, 0)) from inv), 0),
        'voids', (select count(*) from voided),
        'voids_total', coalesce((select sum(total) from voided), 0),
        'received', coalesce((select sum(amount) from pay where not public.is_prepaid_method(method)), 0)
                    + coalesce((select sum(amount) from loads), 0) + coalesce((select sum(amount) from pkg), 0)
                    + coalesce((select sum(amount) from adv), 0),
        'refunds', coalesce((select sum(amount) from refund where not public.is_prepaid_method(method)), 0)
                   + coalesce((select sum(amount) from pkg_refund), 0) + coalesce((select sum(amount) from adv_refund), 0),
        'collected', coalesce((select sum(amount) from pay where not public.is_prepaid_method(method)), 0)
                     + coalesce((select sum(amount) from loads), 0) + coalesce((select sum(amount) from pkg), 0)
                     + coalesce((select sum(amount) from adv), 0)
                     - coalesce((select sum(amount) from refund where not public.is_prepaid_method(method)), 0)
                     - coalesce((select sum(amount) from pkg_refund), 0) - coalesce((select sum(amount) from adv_refund), 0),
        'coins_sold', coalesce((select sum(amount) from loads), 0),
        'coins_bonus', coalesce((select sum(coins) from ctx where kind = 'bonus'), 0),
        'coins_used', coalesce((select -sum(coins) from ctx where kind in ('spend', 'refund')), 0),
        'packages_sold', coalesce((select sum(amount) from pkg), 0),
        'packages_sold_count', (select count(*) from pkg),
        'package_refunds', coalesce((select sum(amount) from pkg_refund), 0),
        'package_used', coalesce((select sum(amount) from pay where method = 'package'), 0)
                        - coalesce((select sum(amount) from refund where method = 'package'), 0),
        'advances_received', coalesce((select sum(amount) from adv), 0),
        'advances_received_count', (select count(*) from adv),
        'advance_refunds', coalesce((select sum(amount) from adv_refund), 0),
        'advance_used', coalesce((select sum(amount) from pay where method = 'advance'), 0)
                        - coalesce((select sum(amount) from refund where method = 'advance'), 0),
        'expenses', coalesce((select sum(amount) from exp), 0),
        'expenses_cash', coalesce((select sum(amount) from exp where paid_from = 'cash'), 0),
        'opening_cash', v_open,
        'cash_in', coalesce((select sum(bills + coins + packages + advances) from by_method where method = 'cash'), 0),
        'cash_refunds', coalesce((select sum(refunds) from by_method where method = 'cash'), 0),
        'expected_cash', v_open
                         + coalesce((select sum(bills + coins + packages + advances - refunds) from by_method where method = 'cash'), 0)
                         - coalesce((select sum(amount) from exp where paid_from = 'cash'), 0),
        'opening_cash_nu', v_open_nu,
        'cash_in_nu', coalesce((select sum(bills + coins + packages + advances) from by_method where method like 'cash\_%'), 0),
        'cash_refunds_nu', coalesce((select sum(refunds) from by_method where method like 'cash\_%'), 0),
        'expected_cash_nu', v_open_nu + coalesce((select sum(bills + coins + packages + advances - refunds) from by_method where method like 'cash\_%'), 0)
      )),
    'by_method', (select coalesce(jsonb_object_agg(method, jsonb_build_object(
                     'bills', bills, 'coins', coins, 'packages', packages, 'advances', advances, 'refunds', refunds,
                     'net', bills + coins + packages + advances - refunds)), '{}'::jsonb)
                    from by_method),
    'by_staff', (select coalesce(jsonb_agg(jsonb_build_object(
                    'staff_id', r.staff_id, 'user_id', r.user_id,
                    'name', coalesce(st.name, mb.name, case when r.staff_id is null and r.user_id is null then 'Not recorded' end, 'Team member'),
                    'color', st.color, 'services', r.services, 'sales', r.sales,
                    'collected', r.collected, 'collected_by_method', r.collected_by_method)
                    order by r.sales desc, r.collected desc), '[]'::jsonb)
                   from staff_rows r
                   left join public.staff st on st.id = r.staff_id and st.salon_id = p_salon
                   left join member mb on mb.user_id = r.user_id),
    'voids', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', v.id, 'invoice_no', v.invoice_no, 'total', v.total, 'paid', v.paid_total,
                 'paid_by_method', (select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb)
                                      from (select p.method::text as method, sum(p.amount) as amt from public.payments p
                                             where p.invoice_id = v.id group by 1) s),
                 'reason', v.void_reason, 'created_at', v.created_at, 'voided_at', v.voided_at,
                 'voided_by', vb.name, 'billed_by', bb.name, 'customer', c.name) order by v.voided_at), '[]'::jsonb)
                from voided v
                left join public.customers c on c.id = v.customer_id
                left join member vb on vb.user_id = v.voided_by
                left join member bb on bb.user_id = v.created_by),
    'discounts', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', d.id, 'invoice_no', d.invoice_no, 'discount', d.discount_total, 'subtotal', d.subtotal,
                     'total', d.total, 'billed_by', bb.name, 'customer', c.name, 'created_at', d.created_at,
                     'member_discount', (select coalesce(sum(member_discount), 0) from public.invoice_items where invoice_id = d.id))
                     order by d.discount_total desc), '[]'::jsonb)
                    from (select * from inv where discount_total > 0 order by discount_total desc limit 50) d
                    left join public.customers c on c.id = d.customer_id
                    left join member bb on bb.user_id = d.created_by),
    'expenses', jsonb_build_object(
      'count', (select count(*) from exp),
      'by_paid_from', (select coalesce(jsonb_object_agg(paid_from, amt), '{}'::jsonb)
                         from (select paid_from, sum(amount) as amt from exp group by 1) s),
      'by_category', (select coalesce(jsonb_object_agg(category, amt), '{}'::jsonb)
                        from (select category, sum(amount) as amt from exp group by 1) s)),
    -- Show the Ngultrum count when the salon has taken Nu cash in the last 90 days or has Nu in the drawer.
    'uses_nu', v_open_nu <> 0 or exists (
      select 1 from public.payments p
       where p.salon_id = p_salon and p.method::text like 'cash\_%'
         and p.created_at >= v_start - interval '90 days' and p.created_at < v_end)
  ) into v;
  return v;
end $$;


revoke all on function public.record_advance(uuid, uuid, uuid, numeric, public.pay_method, text, text),
  public.refund_advance(uuid, numeric, public.pay_method, text), public.create_event(uuid, jsonb), public.cancel_event(uuid, text) from public, anon;
grant execute on function public.record_advance(uuid, uuid, uuid, numeric, public.pay_method, text, text),
  public.refund_advance(uuid, numeric, public.pay_method, text), public.create_event(uuid, jsonb), public.cancel_event(uuid, text) to authenticated;
