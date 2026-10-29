-- Styile — day-end close and an expense log.
--
-- Owners who aren't always at the counter want to know, every evening, that the money adds up:
-- what was billed, what came in by cash / UPI / card (and by whom), what was cancelled or discounted,
-- what was spent from the drawer, and how much cash should be in it. day_summary() works that out for a
-- salon-local business day; close_day() freezes it as a snapshot together with the cash actually counted.
--
-- Money rules used here:
-- * "Received" on a day = payments recorded that day (payments.created_at), on any bill — so a later payment
--   on an older bill counts on the day it came in — plus money taken for coins sold that day.
-- * Paying with coins (method 'wallet') is not money received: the money came in when the coins were sold.
-- * A bill cancelled on a day is treated as handed back on that day: its payments are shown as refunds
--   (coins paid on it go back to the client's balance automatically, see void_invoice()).
-- * Any payment method starting with 'cash' is physical cash in the drawer. 'cash' is rupees; any other
--   'cash_…' method (e.g. 'cash_nu', Bhutanese Ngultrum, pegged 1:1 to the rupee) is counted separately.
--   Methods are always compared as text so this file works whatever values the pay_method enum has.
-- * Cash expected in the drawer = opening cash (what was left in it at the previous close)
--   + cash received − cash handed back on cancelled bills − expenses paid in cash.

-- ---------------------------------------------------------------------------
-- Helpers and indexes
-- ---------------------------------------------------------------------------
-- The salon's current local date (used by RLS and the date checks below).
create or replace function public.salon_today(p_salon uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.salons where id = p_salon), 'Asia/Kolkata'))::date;
$$;
revoke all on function public.salon_today(uuid) from public, anon;
grant execute on function public.salon_today(uuid) to authenticated, service_role;

create index if not exists payments_salon_created_idx on public.payments (salon_id, created_at);
create index if not exists invoices_salon_voided_idx on public.invoices (salon_id, voided_at) where status = 'void';

-- Who cancelled a bill (shown on the day close). Stamped by a trigger so it works whichever function voids.
alter table public.invoices add column if not exists voided_by uuid references auth.users (id) on delete set null;

create or replace function public.stamp_invoice_void() returns trigger
language plpgsql as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    new.voided_by := auth.uid();
    new.voided_at := coalesce(new.voided_at, now());
  elsif new.voided_by is distinct from old.voided_by and not public.is_trusted_writer() then
    new.voided_by := old.voided_by;
  end if;
  return new;
end $$;
create trigger invoices_stamp_void before update on public.invoices
  for each row execute function public.stamp_invoice_void();

-- ---------------------------------------------------------------------------
-- Day closes: one per salon per business day, written only by close_day()
-- ---------------------------------------------------------------------------
create table public.day_closes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  business_date date not null,
  opening_cash numeric(12,2) not null default 0,         -- left in the drawer at the previous close
  opening_cash_nu numeric(12,2) not null default 0,
  counted_cash numeric(12,2) not null check (counted_cash >= 0),                      -- rupees counted
  counted_cash_nu numeric(12,2) check (counted_cash_nu is null or counted_cash_nu >= 0), -- Ngultrum counted
  cash_out numeric(12,2) not null default 0 check (cash_out >= 0 and cash_out <= counted_cash), -- taken out (to the owner / bank)
  cash_out_nu numeric(12,2) check (cash_out_nu is null or (cash_out_nu >= 0 and cash_out_nu <= coalesce(counted_cash_nu, 0))),
  expected_cash numeric(12,2) not null,                  -- snapshot from day_summary()
  expected_cash_nu numeric(12,2) not null default 0,
  difference numeric(12,2) not null,                     -- counted − expected: + excess, − short
  difference_nu numeric(12,2),
  by_method jsonb not null default '{}'::jsonb,
  by_staff jsonb not null default '[]'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,            -- cancelled bills, discounts, expenses, opening, closed_by_name
  notes text check (notes is null or char_length(notes) <= 500),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz not null default now(),
  unique (salon_id, business_date)
);

alter table public.day_closes enable row level security;
revoke all on public.day_closes from anon;
create policy day_closes_read on public.day_closes for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}'));
-- Reopening a day = deleting its close (owner or manager). There are no insert/update policies: the snapshot is
-- computed by the database in close_day(), never sent by the app.
create policy day_closes_reopen on public.day_closes for delete
  using (public.has_role(salon_id, '{owner,manager}'));

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  spent_on date not null,
  category text not null check (category in ('Rent', 'Electricity', 'Products & supplies', 'Staff advance', 'Tea & snacks', 'Repairs', 'Marketing', 'Other')),
  amount numeric(12,2) not null check (amount > 0 and amount <= 10000000),
  paid_from text not null default 'cash' check (paid_from in ('cash', 'upi', 'card', 'bank', 'other')),
  note text check (note is null or char_length(note) <= 300),
  staff_id uuid references public.staff (id) on delete set null, -- who got a staff advance
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (staff_id is null or category = 'Staff advance')
);
create index on public.expenses (salon_id, spent_on);

alter table public.expenses enable row level security;
revoke all on public.expenses from anon;
-- Owner / manager: everything. Front desk: add expenses and see them for today and yesterday (so the evening or
-- next-morning close can be checked). Stylists: nothing.
create policy expenses_manage on public.expenses for all
  using (public.has_role(salon_id, '{owner,manager}')) with check (public.has_role(salon_id, '{owner,manager}'));
create policy expenses_desk_read on public.expenses for select
  using (public.has_role(salon_id, '{receptionist}') and spent_on >= public.salon_today(salon_id) - 1);
create policy expenses_desk_insert on public.expenses for insert
  with check (public.has_role(salon_id, '{receptionist}') and spent_on >= public.salon_today(salon_id) - 1);

create trigger expenses_same_salon before insert or update on public.expenses
  for each row execute function public.check_same_salon('staff_id', 'staff');

-- Who added it can't be forged; dates can't be in the future; a closed day's expenses are frozen until it is reopened.
create or replace function public.guard_expenses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_trusted_writer() then new.created_by := auth.uid(); end if;
    new.created_at := now();
  elsif tg_op = 'UPDATE' then
    if new.salon_id <> old.salon_id or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'Who added an expense and when can''t be changed';
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and exists (select 1 from public.day_closes where salon_id = old.salon_id and business_date = old.spent_on) then
    raise exception 'The day % is closed. Reopen it on the Day close page to change its expenses.', to_char(old.spent_on, 'FMDD Mon YYYY');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.spent_on > public.salon_today(new.salon_id) then
    raise exception 'An expense date can''t be in the future';
  end if;
  if (tg_op = 'INSERT' or new.spent_on <> old.spent_on)
     and exists (select 1 from public.day_closes where salon_id = new.salon_id and business_date = new.spent_on) then
    raise exception 'The day % is closed. Reopen it on the Day close page to add expenses to it.', to_char(new.spent_on, 'FMDD Mon YYYY');
  end if;
  return new;
end $$;
create trigger expenses_guard before insert or update or delete on public.expenses
  for each row execute function public.guard_expenses();

-- ---------------------------------------------------------------------------
-- day_summary: everything that happened on one salon-local day
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
  ), items as (
    select ii.* from public.invoice_items ii join inv on inv.id = ii.invoice_id
  ), exp as (
    select * from public.expenses e where e.salon_id = p_salon and e.spent_on = p_date
  ), methods as (
    select method from pay union select method from loads union select method from refund
  ), by_method as (
    select m.method,
           coalesce((select sum(amount) from pay where pay.method = m.method), 0) as bills,
           coalesce((select sum(amount) from loads where loads.method = m.method), 0) as coins,
           coalesce((select sum(amount) from refund where refund.method = m.method), 0) as refunds
      from methods m
  ), member as (       -- a login's name in this salon: their staff record, else their profile
    select sm.user_id, sm.staff_id, coalesce(st.name, pr.full_name, 'Team member') as name
      from public.salon_members sm
      left join public.staff st on st.id = sm.staff_id
      left join public.profiles pr on pr.id = sm.user_id
     where sm.salon_id = p_salon
  ), takers as (       -- money taken, by the login that recorded it (coins are not money)
    select created_by, method, amount from pay where method <> 'wallet'
    union all
    select created_by, method, amount from loads
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
        'received', coalesce((select sum(amount) from pay where method <> 'wallet'), 0) + coalesce((select sum(amount) from loads), 0),
        'refunds', coalesce((select sum(amount) from refund where method <> 'wallet'), 0),
        'collected', coalesce((select sum(amount) from pay where method <> 'wallet'), 0) + coalesce((select sum(amount) from loads), 0)
                     - coalesce((select sum(amount) from refund where method <> 'wallet'), 0),
        'coins_sold', coalesce((select sum(amount) from loads), 0),
        'coins_bonus', coalesce((select sum(coins) from ctx where kind = 'bonus'), 0),
        'coins_used', coalesce((select -sum(coins) from ctx where kind in ('spend', 'refund')), 0),
        'expenses', coalesce((select sum(amount) from exp), 0),
        'expenses_cash', coalesce((select sum(amount) from exp where paid_from = 'cash'), 0),
        'opening_cash', v_open,
        'cash_in', coalesce((select sum(bills + coins) from by_method where method = 'cash'), 0),
        'cash_refunds', coalesce((select sum(refunds) from by_method where method = 'cash'), 0),
        'expected_cash', v_open
                         + coalesce((select sum(bills + coins - refunds) from by_method where method = 'cash'), 0)
                         - coalesce((select sum(amount) from exp where paid_from = 'cash'), 0),
        'opening_cash_nu', v_open_nu,
        'cash_in_nu', coalesce((select sum(bills + coins) from by_method where method like 'cash\_%'), 0),
        'cash_refunds_nu', coalesce((select sum(refunds) from by_method where method like 'cash\_%'), 0),
        'expected_cash_nu', v_open_nu + coalesce((select sum(bills + coins - refunds) from by_method where method like 'cash\_%'), 0)
      )),
    'by_method', (select coalesce(jsonb_object_agg(method, jsonb_build_object(
                     'bills', bills, 'coins', coins, 'refunds', refunds, 'net', bills + coins - refunds)), '{}'::jsonb)
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
                     'total', d.total, 'billed_by', bb.name, 'customer', c.name, 'created_at', d.created_at)
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

-- ---------------------------------------------------------------------------
-- close_day: freeze the day's summary with the cash counted. One close per day; reopen = delete (owner/manager).
-- ---------------------------------------------------------------------------
create or replace function public.close_day(
  p_salon uuid, p_date date, p_counted_cash numeric, p_counted_cash_nu numeric default null, p_notes text default null,
  p_cash_out numeric default 0, p_cash_out_nu numeric default null
) returns public.day_closes
language plpgsql security definer set search_path = public as $$
declare
  v_sum jsonb; v_t jsonb; v_row public.day_closes; v_expected numeric; v_expected_nu numeric; v_name text;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then
    raise exception 'Only the owner, a manager or the front desk can close the day';
  end if;
  if p_date is null then raise exception 'Pick the day to close'; end if;
  if p_date > public.salon_today(p_salon) then raise exception 'You can''t close a day that hasn''t happened yet'; end if;
  -- (NaN compares greater than every number, so the upper bounds also reject NaN.)
  if p_counted_cash is null or p_counted_cash < 0 or p_counted_cash > 100000000 then
    raise exception 'Enter the rupee cash you counted in the drawer';
  end if;
  if p_counted_cash_nu is not null and (p_counted_cash_nu < 0 or p_counted_cash_nu > 100000000) then
    raise exception 'Enter the Ngultrum you counted, or leave it empty';
  end if;
  if p_cash_out is null or p_cash_out < 0 or p_cash_out > p_counted_cash then
    raise exception 'Cash taken out can''t be more than the cash counted';
  end if;
  if p_cash_out_nu is not null and (p_cash_out_nu < 0 or p_cash_out_nu > coalesce(p_counted_cash_nu, 0)) then
    raise exception 'Ngultrum taken out can''t be more than the Ngultrum counted';
  end if;

  perform pg_advisory_xact_lock(hashtext('dayclose:' || p_salon::text || ':' || p_date::text));
  if exists (select 1 from public.day_closes where salon_id = p_salon and business_date = p_date) then
    raise exception 'This day is already closed. An owner or manager can reopen it to close it again.';
  end if;

  v_sum := public.day_summary(p_salon, p_date);
  v_t := v_sum -> 'totals';
  v_expected := (v_t ->> 'expected_cash')::numeric;
  v_expected_nu := (v_t ->> 'expected_cash_nu')::numeric;
  if p_counted_cash_nu is null and v_expected_nu <> 0 then
    raise exception 'Count the Ngultrum cash too: Nu % expected', trim(to_char(v_expected_nu, 'FM999999999990.00'));
  end if;
  select coalesce(st.name, pr.full_name) into v_name
    from public.salon_members sm
    left join public.staff st on st.id = sm.staff_id
    left join public.profiles pr on pr.id = sm.user_id
   where sm.salon_id = p_salon and sm.user_id = auth.uid();

  insert into public.day_closes (salon_id, business_date, opening_cash, opening_cash_nu, counted_cash, counted_cash_nu,
                                 cash_out, cash_out_nu, expected_cash, expected_cash_nu, difference, difference_nu,
                                 by_method, by_staff, totals, details, notes, closed_by)
  values (p_salon, p_date, (v_t ->> 'opening_cash')::numeric, (v_t ->> 'opening_cash_nu')::numeric,
          round(p_counted_cash, 2), round(p_counted_cash_nu, 2), round(p_cash_out, 2), round(p_cash_out_nu, 2),
          v_expected, v_expected_nu,
          round(p_counted_cash, 2) - v_expected,
          case when p_counted_cash_nu is null then null else round(p_counted_cash_nu, 2) - v_expected_nu end,
          v_sum -> 'by_method', v_sum -> 'by_staff', v_t,
          (v_sum - 'totals' - 'by_method' - 'by_staff') || jsonb_build_object('closed_by_name', v_name),
          nullif(left(trim(p_notes), 500), ''), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Reports: expenses in a date range (for "profit after expenses")
-- ---------------------------------------------------------------------------
create or replace function public.expense_report(p_salon uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.has_role(p_salon, '{owner,manager}') then raise exception 'Reports are available to owners and managers'; end if;
  with e as (select * from public.expenses where salon_id = p_salon and spent_on between p_from and p_to)
  select jsonb_build_object(
    'total', coalesce((select sum(amount) from e), 0),
    'count', (select count(*) from e),
    'staff_advances', coalesce((select sum(amount) from e where category = 'Staff advance'), 0),
    'by_category', (select coalesce(jsonb_object_agg(category, amt), '{}'::jsonb)
                      from (select category, sum(amount) as amt from e group by 1) s),
    'by_paid_from', (select coalesce(jsonb_object_agg(paid_from, amt), '{}'::jsonb)
                       from (select paid_from, sum(amount) as amt from e group by 1) s)
  ) into v;
  return v;
end $$;

revoke all on function public.day_summary(uuid, date) from public, anon;
revoke all on function public.close_day(uuid, date, numeric, numeric, text, numeric, numeric) from public, anon;
revoke all on function public.expense_report(uuid, date, date) from public, anon;
grant execute on function public.day_summary(uuid, date), public.close_day(uuid, date, numeric, numeric, text, numeric, numeric),
  public.expense_report(uuid, date, date) to authenticated;
