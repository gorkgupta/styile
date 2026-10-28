-- Styile — the right kind of bill for each salon, and the right GST on it.
--
-- * Since 22 Sep 2025 salon and beauty services (SAC group 99972) are taxed at a mandatory 5% (2.5% CGST + 2.5% SGST)
--   without input tax credit; before that, 18%. service_gst_rate(date) is the one place that knows this.
-- * Retail products are goods: each product line carries its own rate (5% hair oil, shampoo, soap, talc; 18% make-up,
--   skincare, perfume) and optionally its HSN code. Services carry a SAC code (999721 hair, 999722 cosmetic treatments,
--   999723 spa and massage, 999729 other beauty).
-- * Each salon is in one of three GST modes, and every bill snapshots the mode it was issued under:
--     unregistered (turnover under ₹20 lakh)  -> "Bill":           no GST shown or collected, no GSTIN
--     composition  (pays 6% of turnover itself) -> "Bill of Supply": GSTIN + declaration, no GST collected
--     regular                                  -> "Tax Invoice":    GSTIN, SAC/HSN, CGST/SGST per line, place of supply
-- * Place of supply: personal grooming and beauty services are supplied where they are performed (IGST Act s.12(4) /
--   s.13(3)(b) for a client from Bhutan), and counter sales of products are delivered at the salon, so a single-state
--   salon's bills are always intra-state: CGST + SGST, never IGST.
-- This is the app's reading of the rules, not tax advice. Salons should confirm with their CA.

-- ---------------------------------------------------------------------------
-- Rates and states
-- ---------------------------------------------------------------------------
create or replace function public.service_gst_rate(p_on date) returns numeric
language sql immutable as $$
  select case when p_on >= date '2025-09-22' then 5::numeric else 18::numeric end;
$$;

-- GST state codes (first two digits of a GSTIN). Kept in step with INDIAN_STATES in src/lib/gst.ts.
create or replace function public.gst_states() returns table (code text, name text)
language sql immutable as $$
  values ('01', 'Jammu and Kashmir'), ('02', 'Himachal Pradesh'), ('03', 'Punjab'), ('04', 'Chandigarh'), ('05', 'Uttarakhand'),
         ('06', 'Haryana'), ('07', 'Delhi'), ('08', 'Rajasthan'), ('09', 'Uttar Pradesh'), ('10', 'Bihar'), ('11', 'Sikkim'),
         ('12', 'Arunachal Pradesh'), ('13', 'Nagaland'), ('14', 'Manipur'), ('15', 'Mizoram'), ('16', 'Tripura'), ('17', 'Meghalaya'),
         ('18', 'Assam'), ('19', 'West Bengal'), ('20', 'Jharkhand'), ('21', 'Odisha'), ('22', 'Chhattisgarh'), ('23', 'Madhya Pradesh'),
         ('24', 'Gujarat'), ('26', 'Dadra and Nagar Haveli and Daman and Diu'), ('27', 'Maharashtra'), ('29', 'Karnataka'), ('30', 'Goa'),
         ('31', 'Lakshadweep'), ('32', 'Kerala'), ('33', 'Tamil Nadu'), ('34', 'Puducherry'), ('35', 'Andaman and Nicobar Islands'),
         ('36', 'Telangana'), ('37', 'Andhra Pradesh'), ('38', 'Ladakh');
$$;

-- "West Bengal (19)". The GSTIN's state wins (it is where the salon is registered); otherwise the salon's state.
create or replace function public.gst_place_of_supply(p_state text, p_gstin text) returns text
language sql immutable as $$
  select coalesce(
    (select s.name || ' (' || s.code || ')' from public.gst_states() s where s.code = left(p_gstin, 2)),
    (select s.name || ' (' || s.code || ')' from public.gst_states() s
      where lower(s.name) = lower(replace(btrim(p_state), '&', 'and'))),
    nullif(btrim(p_state), ''));
$$;

-- A registered business's GSTIN: 2-digit state, PAN (5 letters, 4 digits, 1 letter), entity no., Z, check character.
create or replace function public.valid_business_gstin(p text) returns boolean
language sql immutable as $$
  select p ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
$$;

-- ---------------------------------------------------------------------------
-- Salons: GST mode (the owner changes it in Settings; not a platform-managed field)
-- ---------------------------------------------------------------------------
alter table public.salons
  add column gst_mode text not null default 'unregistered' check (gst_mode in ('unregistered', 'composition', 'regular'));
update public.salons set gst_mode = 'regular' where gstin is not null;
alter table public.salons
  add constraint salons_gstin_when_registered check (gst_mode = 'unregistered' or gstin is not null);

-- default_gst_rate is no longer used for services (they follow service_gst_rate); kept for old app versions.
alter table public.salons alter column default_gst_rate set default 5;
update public.salons set default_gst_rate = 5 where default_gst_rate = 18;
comment on column public.salons.default_gst_rate is 'Unused since 0007: services follow service_gst_rate(); products carry their own rate.';
comment on column public.salons.gst_mode is
  'unregistered = plain Bill, no GST; composition = Bill of Supply, no GST collected (salon pays 6%); regular = Tax Invoice';

-- ---------------------------------------------------------------------------
-- Services: SAC code, and a GST override that is normally empty (= the statutory service rate)
-- ---------------------------------------------------------------------------
update public.services set gst_rate = null where gst_rate = 18 or gst_rate not in (0, 5, 12, 18, 28);
alter table public.services
  add constraint services_gst_rate_slab check (gst_rate is null or gst_rate in (0, 5, 12, 18, 28)),
  add column sac_code text not null default '999721' check (sac_code in ('999721', '999722', '999723', '999729'));
comment on column public.services.gst_rate is 'null = the statutory rate for salon services on the bill date (service_gst_rate)';

-- Best guess for existing menus from the service name; every code in the group carries the same rate, and owners
-- can correct it under Services.
update public.services set sac_code = case
  when name ~* '(wax|thread|pierc|tattoo|henna|mehendi)' then '999729'
  when name ~* '(massage|body spa|\mspa\M|reflexology)' and name !~* 'hair' then '999723'
  when name ~* '(facial|clean.?up|manicure|pedicure|nail|bleach|d.?tan|make.?up|bridal|skin|peel)' then '999722'
  else '999721' end;

-- ---------------------------------------------------------------------------
-- Bills: what kind of bill it was, under which registration, and for whom
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column gst_mode text,
  add column bill_type text,
  add column seller_gstin text,
  add column place_of_supply text,
  add column client_gstin text,
  add column client_address text,
  add column composition_tax numeric(12,2) not null default 0;

-- Existing bills were all issued with GST lines: those stay tax invoices. Bills without tax follow the salon's mode.
update public.invoices i set
  gst_mode = case when i.cgst + i.sgst + i.igst > 0 then 'regular' else s.gst_mode end
  from public.salons s where s.id = i.salon_id;
update public.invoices i set
  bill_type = case i.gst_mode when 'regular' then 'tax_invoice' when 'composition' then 'bill_of_supply' else 'bill' end,
  seller_gstin = case when i.gst_mode <> 'unregistered' then s.gstin end,
  place_of_supply = case when i.gst_mode = 'regular' then public.gst_place_of_supply(s.state, s.gstin) end
  from public.salons s where s.id = i.salon_id;

alter table public.invoices
  alter column gst_mode set not null,
  alter column bill_type set not null,
  add constraint invoices_gst_mode_valid check (gst_mode in ('unregistered', 'composition', 'regular')),
  add constraint invoices_bill_type_matches check (bill_type = case gst_mode when 'regular' then 'tax_invoice'
                                                                when 'composition' then 'bill_of_supply' else 'bill' end),
  add constraint invoices_client_gstin_valid check (client_gstin is null or public.valid_business_gstin(client_gstin)),
  add constraint invoices_client_address_length check (client_address is null or char_length(client_address) <= 240),
  add constraint invoices_composition_tax_valid check (composition_tax >= 0);

-- SAC (services, 6 digits) or HSN (goods, 4/6/8 digits) for each line. Old bills printed 999721 on every non-product line.
alter table public.invoice_items
  add column code text check (code is null or code ~ '^[0-9]{4}([0-9]{2}){0,2}$');
update public.invoice_items set code = '999721' where kind <> 'product';

-- ---------------------------------------------------------------------------
-- Billing: create_invoice from 0005 (every check and the coins logic unchanged), plus GST modes.
-- p_data = {
--   "customer_id", "appointment_id", "notes",
--   "client_gstin": "19ABCDE1234F1Z5" (optional, regular salons only), "client_address": text (optional),
--   "items": [{"kind":"service","service_id":uuid,"staff_id":uuid,"name":"Haircut","qty":1,"unit_price":600,"discount":0},
--             {"kind":"product","name":"Shampoo","qty":1,"unit_price":450,"gst_rate":5,"code":"3305"}],
--   "payments": [{"method":"upi","amount":708,"reference":"..."}]
-- }
-- Rates: unregistered/composition -> 0 on every line. Regular -> service lines use the service's override or the
-- statutory rate on today's date (a rate sent by the app is ignored); product lines must send 0/5/12/18/28;
-- custom lines may send one, else they are services at the statutory rate.
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

  -- GST mode of this bill (salons_gstin_when_registered guarantees a GSTIN for composition/regular).
  v_bill_type := case v_salon.gst_mode when 'regular' then 'tax_invoice' when 'composition' then 'bill_of_supply' else 'bill' end;
  v_statutory := public.service_gst_rate((now() at time zone v_salon.timezone)::date);
  if v_client_gstin is not null then
    if v_salon.gst_mode <> 'regular' then
      raise exception 'A client GSTIN goes on tax invoices only. Your salon isn''t set up for regular GST.';
    end if;
    if not public.valid_business_gstin(v_client_gstin) then
      raise exception 'Client GSTIN should be 15 characters, like 19ABCDE1234F1Z5';
    end if;
  end if;
  if char_length(v_client_address) > 240 then raise exception 'Keep the client address under 240 characters'; end if;

  insert into public.invoices (salon_id, branch_id, invoice_no, customer_id, appointment_id, prices_include_tax,
                               subtotal, discount_total, taxable_total, cgst, sgst, round_off, total, paid_total, status, notes, created_by,
                               gst_mode, bill_type, seller_gstin, place_of_supply, client_gstin, client_address)
  values (p_salon, (select id from public.branches where salon_id = p_salon and is_default), v_no, v_customer, v_appt,
          v_salon.prices_include_tax, 0, 0, 0, 0, 0, 0, 0, 0, 'unpaid', p_data ->> 'notes', auth.uid(),
          v_salon.gst_mode, v_bill_type,
          case when v_salon.gst_mode <> 'unregistered' then v_salon.gstin end,
          case when v_salon.gst_mode = 'regular' then public.gst_place_of_supply(v_salon.state, v_salon.gstin) end,
          v_client_gstin, v_client_address)
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
    else
      -- Anything else billed at the desk (an add-on, a package) is a salon service unless a rate is given.
      v_rate := coalesce(v_sent_rate, v_statutory);
      if v_sent_rate is null then v_code := case when v_code = any (c_sac) then v_code else '999729' end; end if;
    end if;
    -- Unregistered and composition salons must not collect tax.
    if v_salon.gst_mode <> 'regular' then v_rate := 0; end if;

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

    insert into public.invoice_items (invoice_id, salon_id, kind, service_id, staff_id, name, qty, unit_price, discount, gst_rate, taxable, tax, line_total, sort, code)
    values (v_inv.id, p_salon, v_kind, v_service,
            nullif(v_item ->> 'staff_id', '')::uuid, v_item ->> 'name', v_qty, v_price, v_disc, v_rate, v_taxable, v_tax, v_line, v_sort, v_code);

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
    status = case when v_paid >= v_total then 'paid'::public.invoice_status when v_paid > 0 then 'partial' else 'unpaid' end,
    -- Composition: the salon pays 6% of its turnover itself; an estimate for reports, never shown to the client.
    composition_tax = case when v_salon.gst_mode = 'composition' then round(v_total * 6 / 100, 2) else 0 end
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

-- ---------------------------------------------------------------------------
-- Reports: everything from 0005, with GST only from tax invoices, the composition estimate, and this financial
-- year's turnover (April to March, salon-local) for the ₹20 lakh registration threshold.
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
    'coins_outstanding', coalesce((select sum(coin_balance) from public.customers where salon_id = p_salon), 0)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Onboarding: create_salon from 0003, plus GST status, GSTIN and state. Earlier callers keep working (defaults).
-- ---------------------------------------------------------------------------
drop function public.create_salon(text, text, text, text, text, boolean);
create function public.create_salon(
  p_name text,
  p_slug text,
  p_phone text default null,
  p_city text default null,
  p_owner_name text default null,
  p_seed_menu boolean default true,
  p_gst_mode text default 'unregistered',
  p_gstin text default null,
  p_state text default null
) returns public.salons
language plpgsql security definer set search_path = public as $$
declare
  v_salon public.salons;
  v_branch uuid;
  v_staff uuid;
  v_cat_hair uuid; v_cat_skin uuid; v_cat_nails uuid;
  v_mode text := coalesce(nullif(p_gst_mode, ''), 'unregistered');
  v_gstin text := nullif(upper(regexp_replace(coalesce(p_gstin, ''), '\s', '', 'g')), '');
begin
  if auth.uid() is null then raise exception 'Sign in to create a salon'; end if;
  if v_mode not in ('unregistered', 'composition', 'regular') then raise exception 'Choose whether your salon is GST registered'; end if;
  if v_mode = 'unregistered' then
    v_gstin := null;
  elsif v_gstin is null then
    raise exception 'Enter your GSTIN, or choose “Not registered”';
  elsif v_gstin !~ '^[0-9]{2}[A-Z0-9]{13}$' then
    raise exception 'GSTIN should be 15 characters, like 19ABCDE1234F1Z5';
  end if;

  insert into public.salons (name, slug, phone, city, state, gst_mode, gstin)
  values (trim(p_name), lower(trim(p_slug)), p_phone, p_city, nullif(btrim(p_state), ''), v_mode, v_gstin)
  returning * into v_salon;

  insert into public.branches (salon_id, name, phone, is_default)
  values (v_salon.id, 'Main branch', p_phone, true) returning id into v_branch;

  insert into public.staff (salon_id, branch_id, user_id, name, title, color, sort)
  values (v_salon.id, v_branch, auth.uid(),
          coalesce(nullif(trim(p_owner_name), ''), (select full_name from public.profiles where id = auth.uid()), 'Owner'),
          'Owner', '#0F5257', 0)
  returning id into v_staff;

  insert into public.salon_members (salon_id, user_id, role, staff_id)
  values (v_salon.id, auth.uid(), 'owner', v_staff);

  if p_seed_menu then
    insert into public.service_categories (salon_id, name, sort) values (v_salon.id, 'Hair', 1) returning id into v_cat_hair;
    insert into public.service_categories (salon_id, name, sort) values (v_salon.id, 'Skin', 2) returning id into v_cat_skin;
    insert into public.service_categories (salon_id, name, sort) values (v_salon.id, 'Hands & feet', 3) returning id into v_cat_nails;
    insert into public.services (salon_id, category_id, name, duration_min, price, gender, sort, sac_code) values
      (v_salon.id, v_cat_hair, 'Haircut', 45, 600, 'unisex', 1, '999721'),
      (v_salon.id, v_cat_hair, 'Hair wash & blow-dry', 30, 400, 'unisex', 2, '999721'),
      (v_salon.id, v_cat_hair, 'Beard trim', 20, 250, 'male', 3, '999721'),
      (v_salon.id, v_cat_hair, 'Global hair colour', 120, 3500, 'unisex', 4, '999721'),
      (v_salon.id, v_cat_hair, 'Root touch-up', 60, 1500, 'unisex', 5, '999721'),
      (v_salon.id, v_cat_hair, 'Keratin treatment', 180, 6500, 'unisex', 6, '999721'),
      (v_salon.id, v_cat_skin, 'Clean-up', 45, 900, 'unisex', 1, '999722'),
      (v_salon.id, v_cat_skin, 'Facial', 60, 1800, 'unisex', 2, '999722'),
      (v_salon.id, v_cat_nails, 'Manicure', 40, 700, 'unisex', 1, '999722'),
      (v_salon.id, v_cat_nails, 'Pedicure', 50, 900, 'unisex', 2, '999722');
  end if;

  return v_salon;
end $$;

grant execute on function public.create_salon(text, text, text, text, text, boolean, text, text, text) to authenticated;
