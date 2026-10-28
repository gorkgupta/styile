-- Styile — service packages ("6 facials for ₹9,000") and membership cards ("Glow Card: 10% off services for a year").
--
-- Packages
-- * A salon puts packages on its menu (service_packages + service_package_items: which services, how many sessions).
-- * sell_package() sells one to a client: the money is recorded with a *package receipt* (PK-00001), not a tax
--   invoice. The client's copy (client_packages + client_package_items) is a snapshot: name, price paid, sessions,
--   expiry, and each session's value — the price paid shared across the sessions by menu price (to the rupee), so a
--   ₹9,000 pack of six ₹1,800 facials values each facial at ₹1,500.
-- * Using a session is a normal bill line with "client_package_id": create_invoice() checks the package is this
--   client's, active, not expired and has a session of that service left, takes one off, prices the line at the
--   session's value and pays it with method 'package'. GST is charged on that bill (regular salons: on the session's
--   value), because the service is supplied then. Salons that add GST on top of prices collect that GST at the visit.
--   Cancelling the bill gives the session back.
-- * day_summary: 'package' payments are not money received that day (like coins); package sales are, by method.
--
-- Membership cards
-- * membership_plans: fee, validity, discount on services and on products (0–50%).
-- * sell_membership() bills the card fee as a normal line ("Membership card", SAC 999729, the service rate for
--   regular salons) through create_invoice() — the card itself is a supply of a service — and starts the membership.
--   A client who is already a member renews: the new card starts the day after the current one ends.
-- * create_invoice() gives an active member their discount on service and product lines automatically, worked out
--   here (never sent by the app) and shown on the line as "Member 10%". Cancelling the card's bill cancels the card.
--
-- This is the app's reading of the GST rules, not tax advice. Salons should confirm the treatment with their CA:
-- some CAs treat money taken for a package of specific services as an advance on which GST is due when received.

-- ---------------------------------------------------------------------------
-- Receipt numbers for money that isn't a bill (package receipts now, advance receipts later): PK-00001, …
-- ---------------------------------------------------------------------------
create table public.receipt_counters (
  salon_id uuid not null references public.salons (id) on delete cascade,
  kind text not null,
  last_no integer not null default 0,
  primary key (salon_id, kind)
);
alter table public.receipt_counters enable row level security; -- no policies: only the functions below use it
revoke all on public.receipt_counters from anon, authenticated;

create or replace function public.next_receipt_no(p_salon uuid, p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.receipt_counters (salon_id, kind, last_no) values (p_salon, p_kind, 1)
  on conflict (salon_id, kind) do update set last_no = public.receipt_counters.last_no + 1
  returning last_no into v;
  return p_prefix || '-' || lpad(v::text, 5, '0');
end $$;
revoke execute on function public.next_receipt_no(uuid, text, text) from public, anon, authenticated;

-- Payment methods that are not money received at the time of the bill: coins and package sessions
-- (the money came in when they were sold). Compared as text so it works whatever the enum holds.
create or replace function public.is_prepaid_method(p text) returns boolean
language sql immutable as $$
  select coalesce(p in ('wallet', 'package'), false);
$$;

-- ---------------------------------------------------------------------------
-- The salon's menu: packages and membership plans
-- ---------------------------------------------------------------------------
create table public.service_packages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 60),
  description text check (description is null or char_length(description) <= 300),
  price numeric(10,2) not null check (price > 0 and price <= 1000000),
  validity_days integer not null default 180 check (validity_days between 7 and 1095),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.service_packages (salon_id);

create table public.service_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.service_packages (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete restrict, -- services are archived, never deleted
  sessions integer not null check (sessions between 1 and 100),
  sort integer not null default 0,
  unique (package_id, service_id)
);
create index on public.service_package_items (package_id);

create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 40),
  description text check (description is null or char_length(description) <= 300),
  fee numeric(10,2) not null check (fee > 0 and fee <= 100000),
  validity_days integer not null default 365 check (validity_days between 30 and 1095),
  service_discount_pct numeric(5,2) not null default 10 check (service_discount_pct between 0 and 50),
  product_discount_pct numeric(5,2) not null default 0 check (product_discount_pct between 0 and 50),
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  check (service_discount_pct > 0 or product_discount_pct > 0)
);
create index on public.membership_plans (salon_id);

-- ---------------------------------------------------------------------------
-- What clients bought (written only by the functions below)
-- ---------------------------------------------------------------------------
create table public.client_packages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  -- no cascade: a client holding a package can't be deleted (the salon owes them the sessions)
  customer_id uuid not null references public.customers (id),
  package_id uuid references public.service_packages (id) on delete set null,
  name text not null,
  price numeric(10,2) not null check (price > 0),
  validity_days integer not null,
  purchased_at timestamptz not null default now(),
  expires_on date not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'cancelled')),
  -- The sale: a package receipt, not a tax invoice
  receipt_no text not null,
  amount_paid numeric(10,2) not null check (amount_paid > 0),
  method public.pay_method not null check (not public.is_prepaid_method(method::text)),
  reference text check (reference is null or char_length(reference) <= 120),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  -- Cancelled by an owner or manager, with any money handed back
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancel_reason text,
  refund_amount numeric(10,2) check (refund_amount is null or (refund_amount > 0 and refund_amount <= amount_paid)),
  refund_method public.pay_method check (refund_method is null or not public.is_prepaid_method(refund_method::text)),
  unique (salon_id, receipt_no),
  check ((status = 'cancelled') = (cancelled_at is not null)),
  check ((refund_amount is null) = (refund_method is null))
);
create index on public.client_packages (salon_id, purchased_at);
create index on public.client_packages (customer_id);

create table public.client_package_items (
  id uuid primary key default gen_random_uuid(),
  client_package_id uuid not null references public.client_packages (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  name text not null,
  sessions_total integer not null check (sessions_total between 1 and 100),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  unit_value numeric(10,2) not null check (unit_value >= 0), -- what one session is worth on a bill
  sort integer not null default 0,
  check (sessions_used <= sessions_total)
);
create index on public.client_package_items (client_package_id);

create table public.client_memberships (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  customer_id uuid not null references public.customers (id),
  plan_id uuid references public.membership_plans (id) on delete set null,
  name text not null,
  fee numeric(10,2) not null,
  service_discount_pct numeric(5,2) not null check (service_discount_pct between 0 and 50),
  product_discount_pct numeric(5,2) not null check (product_discount_pct between 0 and 50),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  invoice_id uuid references public.invoices (id) on delete set null, -- the bill for the card fee
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text,
  check (ends_on >= starts_on)
);
create index on public.client_memberships (salon_id, created_at);
create index on public.client_memberships (customer_id, ends_on);

-- ---------------------------------------------------------------------------
-- Bills: package lines, membership card lines, member discounts
-- ---------------------------------------------------------------------------
alter table public.invoice_items drop constraint invoice_items_kind_check;
alter table public.invoice_items
  add constraint invoice_items_kind_check check (kind in ('service', 'product', 'custom', 'membership')),
  add column client_package_id uuid references public.client_packages (id) on delete set null,
  add column client_package_item_id uuid references public.client_package_items (id) on delete set null,
  add column member_discount numeric(10,2) not null default 0 check (member_discount >= 0),
  add column discount_note text check (discount_note is null or char_length(discount_note) <= 40),
  add constraint invoice_items_member_discount_within check (member_discount <= discount);
create index on public.invoice_items (client_package_item_id) where client_package_item_id is not null;

alter table public.invoices
  add column client_membership_id uuid references public.client_memberships (id) on delete set null;

-- Same-salon checks now cover the new references.
drop trigger invoice_items_same_salon on public.invoice_items;
create trigger invoice_items_same_salon before insert or update on public.invoice_items
  for each row execute function public.check_same_salon('invoice_id', 'invoices', 'service_id', 'services', 'staff_id', 'staff',
                                                        'client_package_id', 'client_packages', 'client_package_item_id', 'client_package_items');
drop trigger invoices_same_salon on public.invoices;
create trigger invoices_same_salon before insert or update on public.invoices
  for each row execute function public.check_same_salon('branch_id', 'branches', 'customer_id', 'customers', 'appointment_id', 'appointments',
                                                        'client_membership_id', 'client_memberships');
create trigger service_packages_same_salon before insert or update on public.service_package_items
  for each row execute function public.check_same_salon('package_id', 'service_packages', 'service_id', 'services');
create trigger client_packages_same_salon before insert or update on public.client_packages
  for each row execute function public.check_same_salon('customer_id', 'customers', 'package_id', 'service_packages');
create trigger client_package_items_same_salon before insert or update on public.client_package_items
  for each row execute function public.check_same_salon('client_package_id', 'client_packages', 'service_id', 'services');
create trigger client_memberships_same_salon before insert or update on public.client_memberships
  for each row execute function public.check_same_salon('customer_id', 'customers', 'plan_id', 'membership_plans', 'invoice_id', 'invoices');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.service_packages enable row level security;
alter table public.service_package_items enable row level security;
alter table public.membership_plans enable row level security;
alter table public.client_packages enable row level security;
alter table public.client_package_items enable row level security;
alter table public.client_memberships enable row level security;
revoke all on public.service_packages, public.service_package_items, public.membership_plans,
  public.client_packages, public.client_package_items, public.client_memberships from anon;

-- The menu: the whole team reads it, owners and managers change it (like services).
do $$
declare t text;
begin
  foreach t in array array['service_packages', 'service_package_items', 'membership_plans'] loop
    execute format('create policy %1$s_read on public.%1$s for select using (public.is_member(salon_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.has_role(salon_id, ''{owner,manager}'')) with check (public.has_role(salon_id, ''{owner,manager}''))', t);
  end loop;
end $$;

-- What clients hold: the team reads it (a stylist can see sessions left), the client reads their own.
-- Nobody writes directly: there are no insert/update/delete policies, so sessions and status only change through
-- sell_package, cancel_client_package, sell_membership and the billing functions.
create policy client_packages_staff_read on public.client_packages for select using (public.is_member(salon_id));
create policy client_packages_customer_read on public.client_packages for select using (customer_id in (select public.my_customer_ids()));
create policy client_package_items_staff_read on public.client_package_items for select using (public.is_member(salon_id));
create policy client_package_items_customer_read on public.client_package_items for select
  using (client_package_id in (select id from public.client_packages where customer_id in (select public.my_customer_ids())));
create policy client_memberships_staff_read on public.client_memberships for select using (public.is_member(salon_id));
create policy client_memberships_customer_read on public.client_memberships for select using (customer_id in (select public.my_customer_ids()));

-- ---------------------------------------------------------------------------
-- Packages: save to the menu (owner/manager), sell (front desk), cancel (owner/manager)
-- p_data = {"name", "description", "price", "validity_days", "active", "items": [{"service_id", "sessions"}]}
-- ---------------------------------------------------------------------------
create or replace function public.save_service_package(p_salon uuid, p_package uuid, p_data jsonb) returns public.service_packages
language plpgsql security definer set search_path = public as $$
declare
  v public.service_packages; v_item jsonb; v_sessions numeric; v_service uuid; v_sort integer := 0; v_seen uuid[] := '{}';
begin
  if not public.has_role(p_salon, '{owner,manager}') then raise exception 'Only the owner or a manager can change packages'; end if;
  if jsonb_typeof(p_data -> 'items') <> 'array' or jsonb_array_length(p_data -> 'items') = 0 then
    raise exception 'Add at least one service to the package';
  end if;
  if jsonb_array_length(p_data -> 'items') > 12 then raise exception 'Keep a package to 12 services or fewer'; end if;

  if p_package is null then
    insert into public.service_packages (salon_id, name, description, price, validity_days, active, sort)
    values (p_salon, btrim(p_data ->> 'name'), nullif(btrim(p_data ->> 'description'), ''), (p_data ->> 'price')::numeric,
            coalesce((p_data ->> 'validity_days')::integer, 180), coalesce((p_data ->> 'active')::boolean, true),
            coalesce((select max(sort) + 1 from public.service_packages where salon_id = p_salon), 1))
    returning * into v;
  else
    update public.service_packages set name = btrim(p_data ->> 'name'), description = nullif(btrim(p_data ->> 'description'), ''),
           price = (p_data ->> 'price')::numeric, validity_days = coalesce((p_data ->> 'validity_days')::integer, validity_days),
           active = coalesce((p_data ->> 'active')::boolean, active)
     where id = p_package and salon_id = p_salon returning * into v;
    if v.id is null then raise exception 'Package not found. Refresh and try again.'; end if;
    delete from public.service_package_items where package_id = v.id;
  end if;

  for v_item in select * from jsonb_array_elements(p_data -> 'items') loop
    v_sort := v_sort + 1;
    v_service := nullif(v_item ->> 'service_id', '')::uuid;
    v_sessions := (v_item ->> 'sessions')::numeric;
    if v_service is null then raise exception 'Choose a service for each row'; end if;
    if v_service = any (v_seen) then raise exception 'A service is in the package twice. Add its sessions together instead.'; end if;
    v_seen := v_seen || v_service;
    if v_sessions is null or v_sessions <> trunc(v_sessions) or v_sessions < 1 or v_sessions > 100 then
      raise exception 'Sessions should be a whole number from 1 to 100';
    end if;
    insert into public.service_package_items (package_id, salon_id, service_id, sessions, sort)
    values (v.id, p_salon, v_service, v_sessions::integer, v_sort);
  end loop;
  return v;
end $$;

create or replace function public.sell_package(
  p_salon uuid, p_customer uuid, p_package uuid, p_method public.pay_method,
  p_reference text default null, p_note text default null
) returns public.client_packages
language plpgsql security definer set search_path = public as $$
declare
  v_pkg public.service_packages; v_row public.client_packages; v_today date;
  v_menu numeric; v_rows integer; v_sessions integer; v_inactive text; r record; v_sort integer := 0;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then raise exception 'You do not have permission to sell packages'; end if;
  perform 1 from public.customers where id = p_customer and salon_id = p_salon for update;
  if not found then raise exception 'Client not found'; end if;
  select * into v_pkg from public.service_packages where id = p_package and salon_id = p_salon;
  if v_pkg.id is null then raise exception 'That package isn''t on your menu. Refresh and try again.'; end if;
  if not v_pkg.active then raise exception '“%” is no longer sold. Turn it back on under Packages & memberships.', v_pkg.name; end if;
  -- Coins can't buy a package (prepaid for prepaid would muddle what the salon owes): money only.
  if p_method is null or public.is_prepaid_method(p_method::text) then
    raise exception 'Take the package money by cash, UPI or card. Coins can''t be used to buy a package.';
  end if;

  select count(*), sum(s.price * i.sessions), sum(i.sessions), min(s.name) filter (where not s.active)
    into v_rows, v_menu, v_sessions, v_inactive
    from public.service_package_items i join public.services s on s.id = i.service_id
   where i.package_id = v_pkg.id;
  if coalesce(v_rows, 0) = 0 then raise exception 'Add at least one service to “%” before selling it', v_pkg.name; end if;
  if v_inactive is not null then raise exception '“%” is no longer on your menu. Edit the package first.', v_inactive; end if;

  v_today := public.salon_today(p_salon);
  insert into public.client_packages (salon_id, customer_id, package_id, name, price, validity_days, expires_on, receipt_no,
                                      amount_paid, method, reference, note, created_by)
  values (p_salon, p_customer, v_pkg.id, v_pkg.name, v_pkg.price, v_pkg.validity_days, v_today + v_pkg.validity_days,
          public.next_receipt_no(p_salon, 'package', 'PK'), v_pkg.price, p_method,
          nullif(left(btrim(p_reference), 120), ''), nullif(left(btrim(p_note), 300), ''), auth.uid())
  returning * into v_row;

  -- Each session's value: the price paid shared across the sessions by menu price, to the rupee (so bills that
  -- use a session have no paise; the values can add up to a rupee or two more or less than the price).
  for r in select i.service_id, i.sessions, s.name, s.price from public.service_package_items i
             join public.services s on s.id = i.service_id where i.package_id = v_pkg.id order by i.sort, s.name loop
    v_sort := v_sort + 1;
    insert into public.client_package_items (client_package_id, salon_id, service_id, name, sessions_total, unit_value, sort)
    values (v_row.id, p_salon, r.service_id, r.name, r.sessions,
            case when v_menu > 0 then round(v_pkg.price * r.price / v_menu, 0) else round(v_pkg.price / v_sessions, 0) end, v_sort);
  end loop;
  return v_row;
end $$;

-- Owner or manager cancels a package (sold by mistake, client moving away). Sessions already used stay on their
-- bills. Money handed back, if any, is recorded and shows on that day's close. No automatic refunds.
create or replace function public.cancel_client_package(
  p_package uuid, p_reason text, p_refund numeric default null, p_refund_method public.pay_method default null
) returns public.client_packages
language plpgsql security definer set search_path = public as $$
declare v public.client_packages;
begin
  select * into v from public.client_packages where id = p_package for update;
  if v.id is null or not public.has_role(v.salon_id, '{owner,manager}') then raise exception 'Only an owner or manager can cancel a package'; end if;
  if v.status = 'cancelled' then raise exception 'This package is already cancelled'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for cancelling the package'; end if;
  if p_refund is not null and (p_refund <= 0 or p_refund > v.amount_paid) then
    raise exception 'Money handed back can be up to %', public.fmt_inr(v.amount_paid);
  end if;
  if p_refund is not null and (p_refund_method is null or public.is_prepaid_method(p_refund_method::text)) then
    raise exception 'Say how the money was handed back: cash, UPI or card';
  end if;
  update public.client_packages set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancel_reason = left(btrim(p_reason), 300), refund_amount = round(p_refund, 2),
         refund_method = case when p_refund is null then null else p_refund_method end
   where id = v.id returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Billing: create_invoice from 0007 (every check, the coins logic and GST modes unchanged), plus:
-- * a service line may carry "client_package_id": the session is taken from that package and paid with 'package';
-- * an active member's discount is applied on service and product lines (worked out here, never sent by the app);
-- * 'membership' lines (the card fee) come only from sell_membership().
-- Payments with method 'package' are added here from package lines; the app can't send them.
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

-- Record a later payment against an unpaid / partly paid bill (0005, plus: package sessions can't be added later).
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

-- Cancel a bill (owner/manager). The number stays used, as GST rules require. Coins paid on it go back (0005);
-- package sessions on it go back to the package; a membership card sold on it is cancelled.
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
  -- A membership card sold on this bill ends with it.
  update public.client_memberships set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Bill ' || v.invoice_no || ' cancelled'
   where invoice_id = v.id and status <> 'cancelled';
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Membership cards: sell (front desk). The fee is billed through create_invoice so the salon's GST mode applies.
-- p_payments: as on a bill, e.g. [{"method":"upi","amount":299,"reference":"…"}] — the full fee must be taken.
-- Returns {"membership": …, "invoice": …}.
-- ---------------------------------------------------------------------------
create or replace function public.sell_membership(p_salon uuid, p_customer uuid, p_plan uuid, p_payments jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan public.membership_plans; v_today date; v_start date; v_end date; v_current date; v_inv public.invoices;
  v_mem public.client_memberships; v_prev text;
begin
  if not public.has_role(p_salon, '{owner,manager,receptionist}') then raise exception 'You do not have permission to sell membership cards'; end if;
  perform 1 from public.customers where id = p_customer and salon_id = p_salon for update;
  if not found then raise exception 'Client not found'; end if;
  select * into v_plan from public.membership_plans where id = p_plan and salon_id = p_salon;
  if v_plan.id is null then raise exception 'That membership card isn''t on your menu. Refresh and try again.'; end if;
  if not v_plan.active then raise exception '“%” is no longer sold. Turn it back on under Packages & memberships.', v_plan.name; end if;

  v_today := public.salon_today(p_salon);
  -- Already a member: the new card starts when the current one ends (a renewal).
  select max(ends_on) into v_current from public.client_memberships
   where salon_id = p_salon and customer_id = p_customer and status = 'active' and ends_on >= v_today;
  v_start := coalesce(v_current + 1, v_today);
  v_end := v_start + v_plan.validity_days - 1;

  v_prev := coalesce(current_setting('styile.membership_sale', true), '');
  perform set_config('styile.membership_sale', 'on', true);
  v_inv := public.create_invoice(p_salon, jsonb_build_object(
    'customer_id', p_customer,
    'notes', 'Membership card ' || v_plan.name || ', valid ' || to_char(v_start, 'FMDD Mon YYYY') || ' to ' || to_char(v_end, 'FMDD Mon YYYY'),
    'items', jsonb_build_array(jsonb_build_object('kind', 'membership', 'name', 'Membership card · ' || v_plan.name, 'qty', 1, 'unit_price', v_plan.fee)),
    'payments', coalesce(p_payments, '[]'::jsonb)));
  perform set_config('styile.membership_sale', v_prev, true);
  if v_inv.paid_total < v_inv.total then
    raise exception 'Take the full card fee (%) to start the membership', public.fmt_inr(v_inv.total);
  end if;

  insert into public.client_memberships (salon_id, customer_id, plan_id, name, fee, service_discount_pct, product_discount_pct,
                                         starts_on, ends_on, invoice_id, created_by)
  values (p_salon, p_customer, v_plan.id, v_plan.name, v_inv.total, v_plan.service_discount_pct, v_plan.product_discount_pct,
          v_start, v_end, v_inv.id, auth.uid())
  returning * into v_mem;
  return jsonb_build_object('membership', to_jsonb(v_mem), 'invoice', to_jsonb(v_inv));
end $$;

-- ---------------------------------------------------------------------------
-- Reports: everything from 0007, plus packages and memberships.
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
                        where salon_id = p_salon and status = 'active' and starts_on <= v_today and ends_on >= v_today)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- day_summary from 0009, plus packages:
-- * money taken for packages sold on the day is money received, by method (like coins sold);
-- * money handed back on packages cancelled that day counts as handed back;
-- * paying a bill with a package session (method 'package') is not money received, like coins.
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
  ), items as (
    select ii.* from public.invoice_items ii join inv on inv.id = ii.invoice_id
  ), exp as (
    select * from public.expenses e where e.salon_id = p_salon and e.spent_on = p_date
  ), methods as (
    select method from pay union select method from loads union select method from refund
    union select method from pkg union select method from pkg_refund
  ), by_method as (
    select m.method,
           coalesce((select sum(amount) from pay where pay.method = m.method), 0) as bills,
           coalesce((select sum(amount) from loads where loads.method = m.method), 0) as coins,
           coalesce((select sum(amount) from pkg where pkg.method = m.method), 0) as packages,
           coalesce((select sum(amount) from refund where refund.method = m.method), 0)
             + coalesce((select sum(amount) from pkg_refund where pkg_refund.method = m.method), 0) as refunds
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
                    + coalesce((select sum(amount) from loads), 0) + coalesce((select sum(amount) from pkg), 0),
        'refunds', coalesce((select sum(amount) from refund where not public.is_prepaid_method(method)), 0)
                   + coalesce((select sum(amount) from pkg_refund), 0),
        'collected', coalesce((select sum(amount) from pay where not public.is_prepaid_method(method)), 0)
                     + coalesce((select sum(amount) from loads), 0) + coalesce((select sum(amount) from pkg), 0)
                     - coalesce((select sum(amount) from refund where not public.is_prepaid_method(method)), 0)
                     - coalesce((select sum(amount) from pkg_refund), 0),
        'coins_sold', coalesce((select sum(amount) from loads), 0),
        'coins_bonus', coalesce((select sum(coins) from ctx where kind = 'bonus'), 0),
        'coins_used', coalesce((select -sum(coins) from ctx where kind in ('spend', 'refund')), 0),
        'packages_sold', coalesce((select sum(amount) from pkg), 0),
        'packages_sold_count', (select count(*) from pkg),
        'package_refunds', coalesce((select sum(amount) from pkg_refund), 0),
        'package_used', coalesce((select sum(amount) from pay where method = 'package'), 0)
                        - coalesce((select sum(amount) from refund where method = 'package'), 0),
        'expenses', coalesce((select sum(amount) from exp), 0),
        'expenses_cash', coalesce((select sum(amount) from exp where paid_from = 'cash'), 0),
        'opening_cash', v_open,
        'cash_in', coalesce((select sum(bills + coins + packages) from by_method where method = 'cash'), 0),
        'cash_refunds', coalesce((select sum(refunds) from by_method where method = 'cash'), 0),
        'expected_cash', v_open
                         + coalesce((select sum(bills + coins + packages - refunds) from by_method where method = 'cash'), 0)
                         - coalesce((select sum(amount) from exp where paid_from = 'cash'), 0),
        'opening_cash_nu', v_open_nu,
        'cash_in_nu', coalesce((select sum(bills + coins + packages) from by_method where method like 'cash\_%'), 0),
        'cash_refunds_nu', coalesce((select sum(refunds) from by_method where method like 'cash\_%'), 0),
        'expected_cash_nu', v_open_nu + coalesce((select sum(bills + coins + packages - refunds) from by_method where method like 'cash\_%'), 0)
      )),
    'by_method', (select coalesce(jsonb_object_agg(method, jsonb_build_object(
                     'bills', bills, 'coins', coins, 'packages', packages, 'refunds', refunds,
                     'net', bills + coins + packages - refunds)), '{}'::jsonb)
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

revoke all on function public.save_service_package(uuid, uuid, jsonb), public.sell_package(uuid, uuid, uuid, public.pay_method, text, text),
  public.cancel_client_package(uuid, text, numeric, public.pay_method), public.sell_membership(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_service_package(uuid, uuid, jsonb), public.sell_package(uuid, uuid, uuid, public.pay_method, text, text),
  public.cancel_client_package(uuid, text, numeric, public.pay_method), public.sell_membership(uuid, uuid, uuid, jsonb) to authenticated;
