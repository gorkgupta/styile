\set ON_ERROR_STOP on
\set QUIET on
-- Test helpers (superuser)
create schema t;
grant usage on schema t to public;
create function t.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'ok  %', label;
end $$;
create function t.fails(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok  % (blocked: %)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (statement was allowed)', label;
end $$;
grant execute on all functions in schema t to public;

-- Users
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'asha@glow.in', '{"full_name":"Asha Rao"}'),
  ('00000000-0000-0000-0000-00000000000b', 'vik@trim.in', '{"full_name":"Vikram"}'),
  ('00000000-0000-0000-0000-00000000000c', 'meera@glow.in', '{"full_name":"Meera"}');
insert into auth.users (id, phone, phone_confirmed_at) values ('00000000-0000-0000-0000-00000000000d', '919811112222', now());
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ad', 'you@styile.com');
-- Started a phone sign-up with Rohan's number but never entered the code
insert into auth.users (id, phone) values ('00000000-0000-0000-0000-00000000000e', '919811112222');
update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-0000000000ad';
select t.ok((select count(*) from public.profiles) = 6, 'profiles created by signup trigger');

-- ===== Owner A creates a salon =====
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
select (public.create_salon('Glow Studio', 'glow-studio', '919800000001', 'Bengaluru', 'Asha Rao')).id as salon_a \gset
select t.ok((select count(*) from public.services where salon_id = :'salon_a') = 10, 'starter menu seeded');
select t.ok(public.my_role(:'salon_a') = 'owner', 'creator is owner');
select id as branch_a from public.branches where salon_id = :'salon_a' \gset
insert into public.staff (salon_id, branch_id, name, title, color, commission_pct)
  values (:'salon_a', :'branch_a', 'Priya', 'Senior stylist', '#7A4BD6', 10) returning id as priya \gset
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'Rohan Mehta', '919811112222') returning id as rohan \gset
select id as haircut from public.services where salon_id = :'salon_a' and name = 'Haircut' \gset

-- Owner cannot touch platform-managed fields
select t.fails(format('update public.salons set plan = %L where id = %L', 'pro', :'salon_a'), 'owner cannot change own plan');
select t.fails(format('update public.profiles set is_platform_admin = true where id = %L', '00000000-0000-0000-0000-00000000000a'), 'user cannot make self platform admin');
update public.salons set gstin = '29ABCDE1234F1Z5', address = '12 MG Road' where id = :'salon_a';
select t.ok((select gstin from public.salons where id = :'salon_a') = '29ABCDE1234F1Z5', 'owner can edit salon profile');
select t.fails(format('update public.salons set timezone = %L where id = %L', 'Mars/Olympus', :'salon_a'), 'salon time zone must be a real zone');
select t.fails(format('update public.salons set brand_color = %L where id = %L', 'red;}body{display:none', :'salon_a'), 'brand colour must be a hex colour');
select t.fails(format('update public.profiles set email = %L where id = %L', 'vik@trim.in', '00000000-0000-0000-0000-00000000000a'), 'user cannot change profile email (invite lookup)');
select t.fails(format('insert into public.customers (salon_id, name, phone, user_id) values (%L, %L, %L, %L)', :'salon_a', 'Linked', '919800000077', '00000000-0000-0000-0000-00000000000a'), 'staff cannot link a client record to a login');

-- ===== Appointments: no double booking =====
insert into public.appointments (salon_id, branch_id, customer_id, staff_id, start_at, end_at, status, source)
  values (:'salon_a', :'branch_a', :'rohan', :'priya', '2026-11-02 11:00+05:30', '2026-11-02 11:45+05:30', 'booked', 'staff')
  returning id as appt1 \gset
select t.fails(format($q$insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at) values (%L, %L, %L, '2026-11-02 11:30+05:30', '2026-11-02 12:00+05:30')$q$, :'salon_a', :'rohan', :'priya'),
  'overlapping booking for same stylist rejected');
insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at)
  values (:'salon_a', :'rohan', :'priya', '2026-11-02 11:45+05:30', '2026-11-02 12:15+05:30') returning id as appt2 \gset
select t.ok(true, 'back-to-back booking allowed');
update public.appointments set status = 'cancelled' where id = :'appt2';
insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at)
  values (:'salon_a', :'rohan', :'priya', '2026-11-02 11:50+05:30', '2026-11-02 12:10+05:30');
select t.ok(true, 'cancelled slot can be rebooked');

-- ===== Billing: GST inclusive pricing =====
select * from public.create_invoice(:'salon_a', jsonb_build_object(
  'customer_id', :'rohan', 'appointment_id', :'appt1',
  'items', jsonb_build_array(
     jsonb_build_object('kind','service','service_id',:'haircut','staff_id',:'priya','name','Haircut','qty',1,'unit_price',600,'discount',0,'gst_rate',18),
     jsonb_build_object('kind','custom','name','Hair serum','qty',2,'unit_price',349.50,'discount',50,'gst_rate',18)),
  'payments', jsonb_build_array(jsonb_build_object('method','upi','amount',1000), jsonb_build_object('method','cash','amount',249))
)) \gset inv_
\echo invoice :inv_invoice_no total :inv_total taxable :inv_taxable_total cgst :inv_cgst sgst :inv_sgst
select t.ok(:'inv_invoice_no' = 'INV-00001', 'invoice numbered INV-00001');
-- lines: 600 incl -> taxable 508.47 tax 91.53 ; 699-50=649 incl -> taxable 550.00 tax 99.00 ; total 1249
select t.ok(:inv_total = 1249 and :inv_taxable_total = 1058.47 and :inv_cgst + :inv_sgst = 190.53, 'GST split computed (1249 = 1058.47 + 190.53)');
select t.ok(:inv_cgst = 95.27 and :inv_sgst = 95.26, 'CGST/SGST halves');
select t.ok(:'inv_status' = 'paid', 'split payment marks bill paid');
select t.ok((select status from public.appointments where id = :'appt1') = 'completed', 'appointment completed by checkout');
select t.ok((select visit_count = 1 and total_spent = 1249 from public.customers where id = :'rohan'), 'client visit stats updated');
select (public.create_invoice(:'salon_a', '{"items":[{"kind":"custom","name":"Head massage","qty":1,"unit_price":300}]}'::jsonb)).invoice_no as inv2 \gset
select t.ok(:'inv2' = 'INV-00002', 'numbers are sequential');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"custom","name":"x","qty":1,"unit_price":100}],"payments":[{"method":"cash","amount":500}]}'::jsonb)$q$, :'salon_a'), 'overpayment rejected');
select t.fails(format($q$select public.create_invoice(%L, jsonb_build_object('appointment_id', %L, 'items', '[{"kind":"custom","name":"x","qty":1,"unit_price":100}]'::jsonb))$q$, :'salon_a', :'appt1'), 'appointment cannot be billed twice');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"custom","name":"x","qty":"NaN","unit_price":100}]}'::jsonb)$q$, :'salon_a'), 'NaN quantity rejected');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"custom","name":"x","qty":1,"unit_price":100,"gst_rate":-100}]}'::jsonb)$q$, :'salon_a'), 'invalid GST rate rejected');
select t.fails(format($q$insert into public.invoices (salon_id, invoice_no, prices_include_tax, subtotal, discount_total, taxable_total, cgst, sgst, total, status) values (%L, 'FAKE', true, 0,0,0,0,0,1,'paid')$q$, :'salon_a'), 'invoices cannot be inserted directly');

-- ===== Walk-in queue =====
select (public.add_walk_in(:'salon_a', :'rohan', array[:'haircut']::uuid[])).token_no as tok1 \gset
select (public.add_walk_in(:'salon_a', :'rohan', array[:'haircut']::uuid[], :'priya')).id as walk2 \gset
select t.ok(:tok1 = 1 and (select token_no from public.appointments where id = :'walk2') = 2, 'walk-in tokens 1, 2');
select (public.start_walk_in(:'walk2', :'priya')).status as wstatus \gset
select t.ok(:'wstatus' = 'in_service', 'walk-in started with stylist');

-- ===== Reports =====
select public.salon_report(:'salon_a', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) as rep \gset
select t.ok((:'rep'::jsonb ->> 'revenue')::numeric = 1549, 'report revenue for today');
select t.ok((:'rep'::jsonb -> 'by_staff' -> 0 ->> 'name') = 'Priya', 'report revenue by stylist');

-- ===== Team: add a stylist login (Meera) =====
insert into public.staff (salon_id, branch_id, user_id, name) values (:'salon_a', :'branch_a', '00000000-0000-0000-0000-00000000000c', 'Meera') returning id as meera_staff \gset
insert into public.salon_members (salon_id, user_id, role, staff_id) values (:'salon_a', '00000000-0000-0000-0000-00000000000c', 'stylist', :'meera_staff');

-- ===== Owner B (another salon) sees nothing of salon A =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select (public.create_salon('Trim House', 'trim-house', null, 'Pune', 'Vikram', false)).id as salon_b \gset
select t.ok((select count(*) from public.customers where salon_id = :'salon_a') = 0, 'other salon cannot read clients');
select t.ok((select count(*) from public.appointments) = 0, 'other salon cannot read appointments');
select t.ok((select count(*) from public.invoices) = 0, 'other salon cannot read bills');
select t.ok((select count(*) from public.salons) = 1, 'other salon sees only itself');
select t.fails(format($q$insert into public.customers (salon_id, name, phone) values (%L, 'Spy', '919999999999')$q$, :'salon_a'), 'cannot write into another salon');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"name":"x","qty":1,"unit_price":1}]}'::jsonb)$q$, :'salon_a'), 'cannot bill in another salon');
select t.fails(format($q$select public.salon_report(%L, '2026-01-01', '2026-12-31')$q$, :'salon_a'), 'cannot read another salon report');
select id as vik_staff from public.staff where salon_id = :'salon_b' \gset
select id as branch_b from public.branches where salon_id = :'salon_b' \gset
insert into public.customers (salon_id, name, phone) values (:'salon_b', 'Kabir', '919822223333') returning id as kabir \gset
insert into public.services (salon_id, name, duration_min, price) values (:'salon_b', 'Fade', 30, 300) returning id as fade \gset
insert into public.appointments (salon_id, branch_id, customer_id, staff_id, start_at, end_at)
  values (:'salon_b', :'branch_b', :'kabir', :'vik_staff', '2026-11-03 11:00+05:30', '2026-11-03 11:30+05:30');
select t.ok(true, 'own salon references allowed');
select t.fails(format($q$insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at) values (%L, %L, %L, '2026-11-02 11:00+05:30', '2026-11-02 11:45+05:30')$q$, :'salon_b', :'kabir', :'priya'),
  'cannot book another salon''s stylist (would block their calendar)');
select t.fails(format($q$insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at) values (%L, %L, %L, '2026-11-04 11:00+05:30', '2026-11-04 11:45+05:30')$q$, :'salon_b', :'rohan', :'vik_staff'),
  'cannot book another salon''s client (would message them)');
select t.fails(format($q$insert into public.appointment_services (appointment_id, salon_id, name, price, duration_min) values (%L, %L, 'x', 1, 30)$q$, :'appt1', :'salon_b'), 'cannot attach services to another salon''s appointment');
select t.fails(format($q$select public.add_walk_in(%L, %L, array[%L]::uuid[], %L)$q$, :'salon_b', :'kabir', :'fade', :'priya'), 'walk-in cannot name another salon''s stylist');
select (public.add_walk_in(:'salon_b', :'kabir', array[:'fade']::uuid[])).id as walk_b \gset
select t.fails(format($q$select public.start_walk_in(%L, %L)$q$, :'walk_b', :'priya'), 'walk-in cannot be started with another salon''s stylist');
select t.fails(format($q$select public.create_invoice(%L, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind','service','name','Fade','qty',1,'unit_price',300,'staff_id',%L))))$q$, :'salon_b', :'priya'), 'bill line cannot credit another salon''s stylist');
select t.fails(format($q$select public.create_invoice(%L, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind','service','name','Haircut','qty',1,'unit_price',300,'service_id',%L))))$q$, :'salon_b', :'haircut'), 'bill line cannot use another salon''s service');
select t.fails(format($q$select public.create_invoice(%L, jsonb_build_object('appointment_id', %L, 'items', '[{"kind":"custom","name":"x","qty":1,"unit_price":1}]'::jsonb))$q$, :'salon_b', :'appt1'), 'bill cannot point at another salon''s appointment');
select t.fails(format($q$insert into public.staff_services (staff_id, service_id, salon_id) values (%L, %L, %L)$q$, :'vik_staff', :'haircut', :'salon_b'), 'skills cannot use another salon''s service');
select t.fails(format($q$update public.salon_members set staff_id = %L where salon_id = %L$q$, :'priya', :'salon_b'), 'membership cannot link another salon''s stylist');
select t.fails('select public.create_salon(''Bad'', ''glow-studio'')', 'slug must be unique');
select t.fails('select public.create_salon(''Bad'', ''Bad Slug!'')', 'slug format enforced');

-- ===== Stylist role =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
select t.ok((select count(*) from public.appointments where salon_id = :'salon_a') > 0, 'stylist sees salon calendar');
select t.ok((select count(*) from public.invoices) = 0, 'stylist cannot see bills');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"name":"x","qty":1,"unit_price":1}]}'::jsonb)$q$, :'salon_a'), 'stylist cannot bill');
select t.fails(format($q$select public.salon_report(%L, '2026-01-01', '2026-12-31')$q$, :'salon_a'), 'stylist cannot see reports');
update public.services set price = 1 where salon_id = :'salon_a';
select t.ok((select min(price) from public.services where salon_id = :'salon_a') > 1, 'stylist cannot change prices');

-- ===== Customer login (phone OTP) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', false);
select t.ok(public.claim_customer_profiles() = 0 and (select count(*) from public.customers) = 0, 'unverified phone cannot claim client records');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', false);
select t.ok((select count(*) from public.customers) = 0, 'unlinked customer sees nothing');
select t.ok(public.claim_customer_profiles() = 1, 'phone login claims client record');
select t.ok((select count(*) from public.appointments) >= 3, 'customer sees own appointments');
select t.ok((select count(*) from public.invoices) = 1, 'customer sees own bill only');
select t.ok((select count(*) from public.payments) = 0, 'customer cannot see payment ledger');
select t.ok((select count(*) from public.services) = 10, 'customer can browse the menu of their salon');
select t.ok((select count(*) from public.staff) = 0, 'customer cannot read staff rows (phones, commission)');
update public.appointments set status = 'cancelled' where id = :'appt1';
select t.ok((select status from public.appointments where id = :'appt1') = 'completed', 'appointment unchanged by customer');

-- ===== WhatsApp inbox =====
reset role;
insert into public.wa_conversations (salon_id, customer_id, wa_id) values (:'salon_a', :'rohan', '919811112222') returning id as conv_a \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
update public.wa_conversations set bot_paused = true, unread_count = 0 where id = :'conv_a';
select t.ok((select bot_paused from public.wa_conversations where id = :'conv_a'), 'front desk can pause the assistant');
select t.fails(format($q$update public.wa_conversations set state = '{"pending":{"type":"cancel","appointmentId":"x"}}' where id = %L$q$, :'conv_a'), 'staff cannot forge the assistant''s pending action');
select t.fails(format($q$update public.wa_conversations set wa_id = '919999999999' where id = %L$q$, :'conv_a'), 'staff cannot re-route a chat to another number');
update public.customers set phone = '919811119999' where id = :'rohan';
select t.ok((select user_id is null from public.customers where id = :'rohan'), 'changing a client''s number unlinks the old login');

-- ===== Platform admin =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ad","role":"authenticated"}', false);
select t.ok((select count(*) from public.salons) = 2, 'platform admin sees all salons');
update public.salons set plan = 'growth', plan_status = 'active' where id = :'salon_a';
select t.ok((select plan from public.salons where id = :'salon_a') = 'growth', 'platform admin can change plan');

-- ===== Anonymous =====
reset role;
set role anon;
select set_config('request.jwt.claims', '{}', false);
select t.fails('select count(*) from public.salons', 'anonymous has no table access');
select t.fails('select public.create_salon(''X'', ''xx-salon'')', 'anonymous cannot create salon');
reset role;
\echo ALL DATABASE TESTS PASSED
