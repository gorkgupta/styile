-- Styile — coins: a prepaid balance a client buys at a salon and spends on bills at that same salon.
--
-- * 1 coin = ₹1. Coins are sold by one salon and can only be spent there (closed-system prepaid).
-- * Selling coins is an advance, not a sale: it never creates a GST invoice (the app shows a "Coins receipt").
--   GST is charged on the bill when the coins are used — coins are just a payment method ('wallet') on a
--   normal invoice. Salons should confirm this treatment with their CA.
-- * Every change to a balance goes through the functions below and leaves a row in coin_transactions
--   (an append-only ledger). customers.coin_balance is a cached running total that only they may write.
-- * No expiry in this version.

-- ---------------------------------------------------------------------------
-- Settings: coins on/off and the salon's coin packs (pay ₹X, get Y coins)
-- ---------------------------------------------------------------------------
create or replace function public.valid_coin_packs(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 8 and not exists (
    select 1 from jsonb_array_elements(p) e
     where case
             when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'pay') = 'number' and jsonb_typeof(e -> 'coins') = 'number' then
               (e ->> 'pay')::numeric <= 0 or (e ->> 'pay')::numeric > 1000000
               or (e ->> 'pay')::numeric <> round((e ->> 'pay')::numeric)
               or (e ->> 'coins')::numeric < (e ->> 'pay')::numeric
               or (e ->> 'coins')::numeric > 2 * (e ->> 'pay')::numeric
               or (e ->> 'coins')::numeric <> round((e ->> 'coins')::numeric)
             else true
           end
  );
$$;

alter table public.salons
  add column coins_enabled boolean not null default true,
  add column coin_packs jsonb not null default '[{"pay":2000,"coins":2100},{"pay":5000,"coins":5500},{"pay":10000,"coins":11500}]'::jsonb;
alter table public.salons
  add constraint salons_coin_packs_valid check (public.valid_coin_packs(coin_packs));

-- ---------------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------------
alter table public.customers
  add column coin_balance numeric(12,2) not null default 0 check (coin_balance >= 0);

-- Staff can edit client details, but a balance only moves with a ledger row (load_coins, adjust_coins, billing).
create or replace function public.guard_customer_coins() returns trigger
language plpgsql as $$
begin
  if public.is_trusted_writer() then return new; end if;
  if (tg_op = 'INSERT' and new.coin_balance <> 0)
     or (tg_op = 'UPDATE' and new.coin_balance is distinct from old.coin_balance) then
    raise exception 'Coin balances change only by selling coins, paying a bill with coins or an owner adjustment';
  end if;
  return new;
end $$;
create trigger customers_coins_guard before insert or update on public.customers
  for each row execute function public.guard_customer_coins();

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
create table public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  -- no cascade: a client with coin history can't be deleted (the balance is money the salon owes them)
  customer_id uuid not null references public.customers (id),
  kind text not null check (kind in ('load', 'bonus', 'spend', 'refund', 'adjust')),
  coins numeric(12,2) not null check (coins <> 0),            -- signed: + adds to the balance, - takes away
  balance_after numeric(12,2) not null check (balance_after >= 0),
  amount_paid numeric(12,2) check (amount_paid is null or amount_paid > 0), -- money received, for loads
  method public.pay_method,                                    -- how it was paid, for loads
  reference text,
  invoice_id uuid references public.invoices (id) on delete set null, -- the bill, for spend/refund
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind in ('load', 'bonus', 'refund') and coins > 0) or (kind = 'spend' and coins < 0) or kind = 'adjust'),
  check (kind <> 'load' or (amount_paid is not null and method is not null))
);
create index on public.coin_transactions (salon_id, created_at);
create index on public.coin_transactions (customer_id, created_at desc);
create index on public.coin_transactions (invoice_id) where invoice_id is not null;

alter table public.coin_transactions enable row level security;
revoke all on public.coin_transactions from anon;

-- Front desk and above see the salon's ledger; a client sees their own rows. Nobody writes directly:
-- there are no insert/update/delete policies, so every row comes from the functions below.
create policy coin_tx_staff_read on public.coin_transactions for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}'));
create policy coin_tx_customer_read on public.coin_transactions for select
  using (customer_id in (select public.my_customer_ids()));

create trigger coin_tx_same_salon before insert or update on public.coin_transactions
  for each row execute function public.check_same_salon('customer_id', 'customers', 'invoice_id', 'invoices');

-- ₹1,24,500 / ₹1,250.50 — Indian digit grouping for error messages.
create or replace function public.fmt_inr(p numeric) returns text
language plpgsql immutable as $$
declare v numeric := round(abs(coalesce(p, 0)), 2); v_int text; v_out text; v_dec text;
begin
  v_int := trunc(v)::text;
  v_dec := case when v = trunc(v) then '' else '.' || lpad(round((v - trunc(v)) * 100)::text, 2, '0') end;
  if length(v_int) > 3 then
    v_out := right(v_int, 3);
    v_int := left(v_int, length(v_int) - 3);
    while length(v_int) > 2 loop
      v_out := right(v_int, 2) || ',' || v_out;
      v_int := left(v_int, length(v_int) - 2);
    end loop;
    v_out := v_int || ',' || v_out;
  else
    v_out := v_int;
  end if;
  return case when coalesce(p, 0) < 0 then '-' else '' end || '₹' || v_out || v_dec;
end $$;

-- Internal: move a client's balance and write the ledger row. Locks the client row so concurrent bills and
-- loads can't race. Not callable by app users (execute revoked below); load_coins, adjust_coins and the
-- billing functions check roles first.
create or replace function public.coin_post(
  p_salon uuid, p_customer uuid, p_kind text, p_coins numeric,
  p_amount_paid numeric default null, p_method public.pay_method default null, p_reference text default null,
  p_invoice uuid default null, p_note text default null
) returns public.coin_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_balance numeric; v_new numeric; v_row public.coin_transactions; v_prev text;
begin
  select coin_balance into v_balance from public.customers where id = p_customer and salon_id = p_salon for update;
  if not found then raise exception 'Client not found'; end if;
  v_new := v_balance + p_coins;
  if v_new < 0 then
    if p_kind = 'spend' then raise exception 'Not enough coins: balance %', public.fmt_inr(v_balance); end if;
    raise exception 'That would take the balance below zero (balance % coins)', public.fmt_inr(v_balance);
  end if;
  if v_new > 100000000 then raise exception 'Coin balance is too large'; end if;

  v_prev := coalesce(current_setting('styile.internal', true), '');
  perform set_config('styile.internal', 'on', true);
  update public.customers set coin_balance = v_new where id = p_customer;
  perform set_config('styile.internal', v_prev, true);

  insert into public.coin_transactions (salon_id, customer_id, kind, coins, balance_after, amount_paid, method, reference, invoice_id, note, created_by)
  values (p_salon, p_customer, p_kind, p_coins, v_new, p_amount_paid, p_method, nullif(trim(p_reference), ''), p_invoice,
          nullif(trim(p_note), ''), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Internal: pay part of a bill with the client's coins.
create or replace function public.coin_spend(p_salon uuid, p_customer uuid, p_invoice uuid, p_amount numeric)
returns public.coin_transactions
language plpgsql security definer set search_path = public as $$
begin
  if p_customer is null then raise exception 'Choose the client to pay with their coins'; end if;
  -- (NaN compares greater than every number, so the upper bound also rejects NaN.)
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Invalid coins amount'; end if;
  return public.coin_post(p_salon, p_customer, 'spend', -round(p_amount, 2), p_invoice => p_invoice);
end $$;

revoke execute on function public.coin_post(uuid, uuid, text, numeric, numeric, public.pay_method, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.coin_spend(uuid, uuid, uuid, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Selling coins at the desk (cash / UPI / card). Not a tax invoice: an advance against future bills.
-- p_coins defaults to p_pay. More coins than paid (a bonus) must match one of the salon's packs, unless an
-- owner or manager is selling. Returns the new balance and the ledger rows.
-- ---------------------------------------------------------------------------
create or replace function public.load_coins(
  p_salon uuid, p_customer uuid, p_pay numeric, p_coins numeric default null,
  p_method public.pay_method default 'cash', p_reference text default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_salon public.salons; v_coins numeric; v_pay numeric; v_load public.coin_transactions; v_bonus public.coin_transactions;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then raise exception 'You do not have permission to sell coins'; end if;
  select * into v_salon from public.salons where id = p_salon;
  if not v_salon.coins_enabled then raise exception 'Coins are turned off for this salon. Turn them on in Settings.'; end if;
  perform 1 from public.customers where id = p_customer and salon_id = p_salon for update;
  if not found then raise exception 'Client not found'; end if;

  -- (NaN compares greater than every number, so the upper bounds also reject NaN and Infinity.)
  if p_pay is null or p_pay <= 0 or p_pay > 1000000 then raise exception 'Enter an amount between ₹1 and ₹10,00,000'; end if;
  v_pay := round(p_pay, 2);
  v_coins := round(coalesce(p_coins, v_pay), 2);
  if v_coins > 2000000 or v_coins > 2 * v_pay then raise exception 'The bonus can’t be more than the amount paid'; end if;
  if v_coins < v_pay then raise exception 'Coins can’t be less than the amount paid (1 coin = ₹1)'; end if;
  if p_method is null or p_method = 'wallet' then raise exception 'Pick how the client paid: cash, UPI or card'; end if;
  if v_coins > v_pay
     and not public.has_role(p_salon, '{owner,manager}')
     and not exists (select 1 from jsonb_array_elements(v_salon.coin_packs) e
                      where (e ->> 'pay')::numeric = v_pay and (e ->> 'coins')::numeric = v_coins) then
    raise exception 'Only an owner or manager can give a custom bonus. Pick a coin pack or sell without a bonus.';
  end if;

  v_load := public.coin_post(p_salon, p_customer, 'load', v_pay, v_pay, p_method, left(p_reference, 120), null, left(p_note, 300));
  if v_coins > v_pay then
    v_bonus := public.coin_post(p_salon, p_customer, 'bonus', v_coins - v_pay,
      p_note => case when exists (select 1 from jsonb_array_elements(v_salon.coin_packs) e
                                   where (e ->> 'pay')::numeric = v_pay and (e ->> 'coins')::numeric = v_coins)
                     then 'Pack bonus' else 'Extra bonus' end);
  end if;

  return jsonb_build_object(
    'balance', coalesce(v_bonus.balance_after, v_load.balance_after),
    'pay', v_pay, 'coins', v_coins, 'bonus', v_coins - v_pay,
    'transactions', to_jsonb(array_remove(array[to_jsonb(v_load), case when v_bonus.id is not null then to_jsonb(v_bonus) end], null)));
end $$;

-- Owner corrections (e.g. a mistaken sale, goodwill coins). A note is required; never below zero.
create or replace function public.adjust_coins(p_salon uuid, p_customer uuid, p_coins numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_row public.coin_transactions;
begin
  if not public.has_role(p_salon, '{owner}') then raise exception 'Only the salon owner can adjust coin balances'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Add a note saying why the balance is being adjusted'; end if;
  if p_coins is null or p_coins = 0 or abs(p_coins) > 1000000 then raise exception 'Enter the coins to add or remove (up to 10,00,000)'; end if;
  v_row := public.coin_post(p_salon, p_customer, 'adjust', round(p_coins, 2), p_note => left(p_note, 300));
  return jsonb_build_object('balance', v_row.balance_after, 'transaction', to_jsonb(v_row));
end $$;

-- ---------------------------------------------------------------------------
-- Billing with coins: create_invoice / add_payment / void_invoice from 0003, plus coins.
-- A payment with method 'wallet' ("Coins") is taken from the bill's client's balance and linked to the bill.
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

  perform set_config('styile.internal', 'on', true);
  update public.salons set next_invoice_no = next_invoice_no + 1 where id = p_salon returning * into v_salon;
  v_no := v_salon.invoice_prefix || '-' || lpad((v_salon.next_invoice_no - 1)::text, 5, '0');

  insert into public.invoices (salon_id, branch_id, invoice_no, customer_id, appointment_id, prices_include_tax,
                               subtotal, discount_total, taxable_total, cgst, sgst, round_off, total, paid_total, status, notes, created_by)
  values (p_salon, (select id from public.branches where salon_id = p_salon and is_default), v_no, v_customer, v_appt,
          v_salon.prices_include_tax, 0, 0, 0, 0, 0, 0, 0, 0, 'unpaid', p_data ->> 'notes', auth.uid())
  returning * into v_inv;

  for v_item in select * from jsonb_array_elements(p_data -> 'items') loop
    v_sort := v_sort + 1;
    v_qty := coalesce((v_item ->> 'qty')::numeric, 1);
    v_price := (v_item ->> 'unit_price')::numeric;
    v_disc := coalesce((v_item ->> 'discount')::numeric, 0);
    v_rate := coalesce((v_item ->> 'gst_rate')::numeric, v_salon.default_gst_rate);
    -- (NaN compares greater than every number, so the upper bounds also reject NaN and Infinity.)
    if v_qty <= 0 or v_qty > 10000 or v_price is null or v_price < 0 or v_price > 10000000 or v_disc < 0 or v_disc > 10000000 then
      raise exception 'Invalid line item';
    end if;
    if v_rate < 0 or v_rate > 28 then raise exception 'GST rate must be between 0 and 28%%'; end if;
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

    insert into public.invoice_items (invoice_id, salon_id, kind, service_id, staff_id, name, qty, unit_price, discount, gst_rate, taxable, tax, line_total, sort)
    values (v_inv.id, p_salon, coalesce(v_item ->> 'kind', 'custom'), nullif(v_item ->> 'service_id', '')::uuid,
            nullif(v_item ->> 'staff_id', '')::uuid, v_item ->> 'name', v_qty, v_price, v_disc, v_rate, v_taxable, v_tax, v_line, v_sort);

    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
    v_disc_total := v_disc_total + v_disc;
    v_taxable_total := v_taxable_total + v_taxable;
    v_tax_total := v_tax_total + v_tax;
    v_lines := v_lines + v_line;
  end loop;

  v_total := round(v_lines, 0);
  v_cgst := round(v_tax_total / 2, 2);

  if jsonb_typeof(p_data -> 'payments') = 'array' then
    for v_pay in select * from jsonb_array_elements(p_data -> 'payments') loop
      if coalesce((v_pay ->> 'amount')::numeric, 0) > 0 then
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
    status = case when v_paid >= v_total then 'paid'::public.invoice_status when v_paid > 0 then 'partial' else 'unpaid' end
  where id = v_inv.id returning * into v_inv;

  if v_appt is not null then
    update public.appointments set status = 'completed', invoice_id = v_inv.id
     where id = v_appt and salon_id = p_salon;
  end if;

  if v_customer is not null then
    update public.customers set
      visit_count = visit_count + 1,
      total_spent = total_spent + v_total,
      last_visit_at = now()
    where id = v_customer;
  end if;

  return v_inv;
end $$;

-- Record a later payment against an unpaid / partly paid bill
create or replace function public.add_payment(p_invoice uuid, p_method public.pay_method, p_amount numeric, p_reference text default null)
returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v public.invoices;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager,receptionist}') then raise exception 'Bill not found'; end if;
  if v.status = 'void' then raise exception 'This bill was cancelled'; end if;
  if p_amount <= 0 or v.paid_total + p_amount > v.total then raise exception 'Amount is more than what is due'; end if;
  insert into public.payments (invoice_id, salon_id, method, amount, reference, created_by)
  values (v.id, v.salon_id, p_method, p_amount, p_reference, auth.uid());
  if p_method = 'wallet' then
    perform public.coin_spend(v.salon_id, v.customer_id, v.id, p_amount);
  end if;
  update public.invoices set paid_total = paid_total + p_amount,
         status = case when paid_total + p_amount >= total then 'paid'::public.invoice_status else 'partial' end
   where id = v.id returning * into v;
  return v;
end $$;

-- Cancel a bill (owner/manager). The number stays used, as GST rules require. Coins paid on it go back.
create or replace function public.void_invoice(p_invoice uuid, p_reason text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v public.invoices; r record;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager}') then raise exception 'Only an owner or manager can cancel bills'; end if;
  if v.status = 'void' then return v; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for cancelling the bill'; end if;
  update public.invoices set status = 'void', voided_at = now(), void_reason = p_reason where id = v.id returning * into v;
  if v.customer_id is not null then
    update public.customers set total_spent = greatest(total_spent - v.total, 0), visit_count = greatest(visit_count - 1, 0)
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
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Reports: everything from 0003 plus coins sold / bonus given / used in the range, and the balance owed now.
-- ---------------------------------------------------------------------------
create or replace function public.salon_report(p_salon uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v jsonb;
begin
  if not public.has_role(p_salon, '{owner,manager}') then raise exception 'Reports are available to owners and managers'; end if;
  select timezone into v_tz from public.salons where id = p_salon;

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
  )
  select jsonb_build_object(
    'revenue', coalesce((select sum(total) from inv), 0),
    'collected', coalesce((select sum(paid_total) from inv), 0),
    'tax', coalesce((select sum(cgst + sgst + igst) from inv), 0),
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
    'coins_outstanding', coalesce((select sum(coin_balance) from public.customers where salon_id = p_salon), 0)
  ) into v;
  return v;
end $$;

grant execute on function public.load_coins, public.adjust_coins to authenticated;
