-- Styile — business functions called from the app (supabase.rpc)

-- ---------------------------------------------------------------------------
-- Onboarding: a signed-in user creates their salon and becomes its owner
-- ---------------------------------------------------------------------------
create or replace function public.create_salon(
  p_name text,
  p_slug text,
  p_phone text default null,
  p_city text default null,
  p_owner_name text default null,
  p_seed_menu boolean default true
) returns public.salons
language plpgsql security definer set search_path = public as $$
declare
  v_salon public.salons;
  v_branch uuid;
  v_staff uuid;
  v_cat_hair uuid; v_cat_skin uuid; v_cat_nails uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to create a salon'; end if;

  insert into public.salons (name, slug, phone, city)
  values (trim(p_name), lower(trim(p_slug)), p_phone, p_city)
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
    insert into public.services (salon_id, category_id, name, duration_min, price, gender, sort) values
      (v_salon.id, v_cat_hair, 'Haircut', 45, 600, 'unisex', 1),
      (v_salon.id, v_cat_hair, 'Hair wash & blow-dry', 30, 400, 'unisex', 2),
      (v_salon.id, v_cat_hair, 'Beard trim', 20, 250, 'male', 3),
      (v_salon.id, v_cat_hair, 'Global hair colour', 120, 3500, 'unisex', 4),
      (v_salon.id, v_cat_hair, 'Root touch-up', 60, 1500, 'unisex', 5),
      (v_salon.id, v_cat_hair, 'Keratin treatment', 180, 6500, 'unisex', 6),
      (v_salon.id, v_cat_skin, 'Clean-up', 45, 900, 'unisex', 1),
      (v_salon.id, v_cat_skin, 'Facial', 60, 1800, 'unisex', 2),
      (v_salon.id, v_cat_nails, 'Manicure', 40, 700, 'unisex', 1),
      (v_salon.id, v_cat_nails, 'Pedicure', 50, 900, 'unisex', 2);
  end if;

  return v_salon;
end $$;

-- ---------------------------------------------------------------------------
-- Customer login: link the signed-in phone number to existing client records
-- (a client who booked over WhatsApp or at the desk sees their history on first login)
-- ---------------------------------------------------------------------------
create or replace function public.claim_customer_profiles() returns integer
language plpgsql security definer set search_path = public as $$
declare v_phone text; v_count integer;
begin
  -- Only a phone number Supabase has verified by OTP (an unconfirmed phone sign-up must not take over a client's history).
  select regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') into v_phone
    from auth.users where id = auth.uid() and phone_confirmed_at is not null;
  if v_phone is null or v_phone = '' then return 0; end if;
  perform set_config('styile.internal', 'on', true);
  update public.customers set user_id = auth.uid()
   where phone = v_phone and (user_id is null or user_id = auth.uid());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Walk-in queue: issue the next token number for today
-- ---------------------------------------------------------------------------
create or replace function public.add_walk_in(
  p_salon uuid,
  p_customer uuid,
  p_service_ids uuid[],
  p_staff uuid default null,
  p_notes text default null
) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  v_tz text; v_branch uuid; v_token integer; v_dur integer; v_appt public.appointments;
begin
  if not public.is_member(p_salon) then raise exception 'Not a member of this salon'; end if;
  if not exists (select 1 from public.customers where id = p_customer and salon_id = p_salon) then
    raise exception 'Client not found';
  end if;
  select timezone into v_tz from public.salons where id = p_salon;
  select id into v_branch from public.branches where salon_id = p_salon and is_default;

  perform pg_advisory_xact_lock(hashtext('walkin:' || p_salon::text));
  select coalesce(max(token_no), 0) + 1 into v_token
    from public.appointments
   where salon_id = p_salon and token_no is not null
     and (start_at at time zone v_tz)::date = (now() at time zone v_tz)::date;

  select coalesce(sum(duration_min), 30) into v_dur from public.services
   where id = any (p_service_ids) and salon_id = p_salon;

  -- staff_id on a waiting entry is only the client's preference; waiting entries never block the calendar.
  insert into public.appointments (salon_id, branch_id, customer_id, staff_id, start_at, end_at, status, source, token_no, notes, created_by)
  values (p_salon, v_branch, p_customer, p_staff, now(), now() + make_interval(mins => v_dur), 'waiting', 'walk_in', v_token, p_notes, auth.uid())
  returning * into v_appt;

  insert into public.appointment_services (appointment_id, salon_id, service_id, name, price, duration_min, sort)
  select v_appt.id, p_salon, s.id, s.name, s.price, s.duration_min, u.ord
    from unnest(p_service_ids) with ordinality u(id, ord)
    join public.services s on s.id = u.id and s.salon_id = p_salon;

  return v_appt;
end $$;

-- Start serving a queued walk-in with a stylist (fails cleanly if the stylist is busy).
create or replace function public.start_walk_in(p_appt uuid, p_staff uuid) returns public.appointments
language plpgsql security definer set search_path = public as $$
declare v public.appointments; v_dur interval;
begin
  select * into v from public.appointments where id = p_appt;
  if v.id is null or not public.is_member(v.salon_id) then raise exception 'Queue entry not found'; end if;
  if v.status <> 'waiting' then raise exception 'This client is no longer waiting'; end if;
  v_dur := v.end_at - v.start_at;
  update public.appointments
     set staff_id = p_staff, start_at = now(), end_at = now() + v_dur, status = 'in_service'
   where id = p_appt returning * into v;
  return v;
exception when exclusion_violation then
  raise exception 'That stylist is busy right now. Pick someone else or wait.';
end $$;

-- ---------------------------------------------------------------------------
-- Billing: create a GST invoice. Totals are always computed here, never trusted from the client.
-- p_data = {
--   "customer_id": uuid|null, "appointment_id": uuid|null, "notes": text,
--   "items": [{"kind":"service","service_id":uuid,"staff_id":uuid,"name":text,"qty":1,"unit_price":600,"discount":0,"gst_rate":18}],
--   "payments": [{"method":"upi","amount":708,"reference":"..."}]
-- }
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
  update public.invoices set paid_total = paid_total + p_amount,
         status = case when paid_total + p_amount >= total then 'paid'::public.invoice_status else 'partial' end
   where id = v.id returning * into v;
  return v;
end $$;

-- Cancel a bill (owner/manager). The number stays used, as GST rules require.
create or replace function public.void_invoice(p_invoice uuid, p_reason text) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare v public.invoices;
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
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Reports: one call returns everything the owner dashboard needs for a date range (salon-local dates)
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
                    from (select p.method, sum(p.amount) amt from public.payments p join inv on inv.id = p.invoice_id group by p.method) s)
  ) into v;
  return v;
end $$;

grant execute on function public.create_salon, public.claim_customer_profiles, public.add_walk_in, public.start_walk_in,
  public.create_invoice, public.add_payment, public.void_invoice, public.salon_report to authenticated;
