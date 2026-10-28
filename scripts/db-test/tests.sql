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
create function t.err(sql text) returns text language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    return sqlerrm;
  end;
  return null;
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
select t.ok((select gst_mode from public.salons where id = :'salon_a') = 'unregistered', 'new salon starts as not GST registered');
select t.fails(format('update public.salons set gst_mode = %L where id = %L', 'regular', :'salon_a'), 'regular GST needs a GSTIN');
update public.salons set gstin = '29ABCDE1234F1Z5', gst_mode = 'regular', address = '12 MG Road' where id = :'salon_a';
select t.ok((select gstin from public.salons where id = :'salon_a') = '29ABCDE1234F1Z5', 'owner can edit salon profile');
select t.ok((select gst_mode from public.salons where id = :'salon_a') = 'regular', 'owner can switch the salon to regular GST');
select t.fails(format('update public.salons set gstin = null where id = %L', :'salon_a'), 'GSTIN cannot be removed while registered');
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

-- ===== Billing: GST inclusive pricing (regular salon, 5% on services since 22 Sep 2025) =====
select * from public.create_invoice(:'salon_a', jsonb_build_object(
  'customer_id', :'rohan', 'appointment_id', :'appt1',
  'items', jsonb_build_array(
     jsonb_build_object('kind','service','service_id',:'haircut','staff_id',:'priya','name','Haircut','qty',1,'unit_price',600,'discount',0,'gst_rate',18),
     jsonb_build_object('kind','custom','name','Hair serum','qty',2,'unit_price',349.50,'discount',50,'gst_rate',18)),
  'payments', jsonb_build_array(jsonb_build_object('method','upi','amount',1000), jsonb_build_object('method','cash','amount',249))
)) \gset inv_
\echo invoice :inv_invoice_no total :inv_total taxable :inv_taxable_total cgst :inv_cgst sgst :inv_sgst
select t.ok(:'inv_invoice_no' = 'INV-00001', 'invoice numbered INV-00001');
-- lines: Haircut 600 incl @5% (the 18% sent for a service is ignored) -> taxable 571.43 tax 28.57 ;
--        Hair serum (custom, 18% sent) 699-50=649 incl -> taxable 550.00 tax 99.00 ; total 1249
select t.ok(:inv_total = 1249 and :inv_taxable_total = 1121.43 and :inv_cgst + :inv_sgst = 127.57, 'GST split computed (1249 = 1121.43 + 127.57)');
select t.ok(:inv_cgst = 63.79 and :inv_sgst = 63.78, 'CGST/SGST halves');
select t.ok((select gst_rate = 5 and taxable = 571.43 and tax = 28.57 and code = '999721' from public.invoice_items where invoice_id = :'inv_id' and sort = 1),
  'service line taxed at 5% with its SAC even though the app sent 18%');
select t.ok((select gst_rate = 18 and tax = 99 from public.invoice_items where invoice_id = :'inv_id' and sort = 2), 'custom line keeps the 18% it was given');
select t.ok(:'inv_bill_type' = 'tax_invoice' and :'inv_gst_mode' = 'regular' and :'inv_seller_gstin' = '29ABCDE1234F1Z5'
  and :'inv_place_of_supply' = 'Karnataka (29)' and :inv_composition_tax = 0, 'regular salon issues a tax invoice with GSTIN and place of supply');
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
select t.fails('select public.create_salon(''Admin'', ''admin'')', 'reserved addresses cannot be used');
select t.fails('select public.create_salon(''WWW'', ''www'')', 'www is reserved');

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

-- ===== Stylist profiles (0006): public profile fields =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
update public.staff set photo_url = 'https://abc.supabase.co/storage/v1/object/public/staff-photos/' || :'salon_a' || '/p-1.jpg',
  bio = 'Ten years of precision cuts and soft balayage.', specialties = '{Balayage,"Global colour",Bobs}', years_experience = 10, show_on_booking = false
  where id = :'priya';
select t.ok((select photo_url like 'https://%' and cardinality(specialties) = 3 and years_experience = 10 and not show_on_booking
               from public.staff where id = :'priya'), 'owner can set a stylist''s photo, bio, specialties, experience, visibility');
select t.ok((select show_on_booking and specialties = '{}' and photo_url is null from public.staff where id = :'meera_staff'), 'new profile fields default to shown, no specialties, no photo');
select t.fails(format($q$update public.staff set photo_url = 'http://abc.supabase.co/x.jpg' where id = %L$q$, :'priya'), 'stylist photo must be https');
select t.fails(format($q$update public.staff set photo_url = 'javascript:alert(1)' where id = %L$q$, :'priya'), 'stylist photo cannot be a script URL');
select t.fails(format($q$update public.staff set photo_url = 'https://x.co/a.jpg" onerror="alert(1)' where id = %L$q$, :'priya'), 'stylist photo URL cannot break out of an attribute');
select t.fails(format($q$update public.staff set specialties = '{a,b,c,d,e,f,g,h,i}' where id = %L$q$, :'priya'), 'at most 8 specialties');
select t.fails(format($q$update public.staff set specialties = array[repeat('x', 31)] where id = %L$q$, :'priya'), 'each specialty at most 30 characters');
select t.fails(format($q$update public.staff set specialties = array['  '] where id = %L$q$, :'priya'), 'blank specialty rejected');
select t.fails(format($q$update public.staff set specialties = null where id = %L$q$, :'priya'), 'specialties cannot be null');
select t.fails(format($q$update public.staff set bio = repeat('a', 281) where id = %L$q$, :'priya'), 'bio at most 280 characters');
select t.fails(format($q$update public.staff set years_experience = 61 where id = %L$q$, :'priya'), 'years of experience at most 60');
select t.fails(format($q$update public.staff set years_experience = -1 where id = %L$q$, :'priya'), 'years of experience not negative');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
update public.staff set bio = 'Hacked', show_on_booking = true where id = :'priya';
select t.ok((select bio from public.staff where id = :'priya') = 'Ten years of precision cuts and soft balayage.', 'stylist cannot edit team profiles');

-- ===== Stylist profiles (0006): usual stylist =====
reset role;
update public.staff set show_on_booking = true where id = :'priya';
insert into public.staff (salon_id, branch_id, name) values (:'salon_a', :'branch_a', 'Kiran') returning id as kiran \gset
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'Isha Kapoor', '919800055555') returning id as isha \gset
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'New Client', '919800066666') returning id as newbie \gset
insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at, status) values
  -- Priya twice, Meera twice (Meera more recently): tie goes to the most recent
  (:'salon_a', :'isha', :'priya',       now() - interval '200 days', now() - interval '200 days' + interval '1 hour', 'completed'),
  (:'salon_a', :'isha', :'priya',       now() - interval '100 days', now() - interval '100 days' + interval '1 hour', 'completed'),
  (:'salon_a', :'isha', :'meera_staff', now() - interval '150 days', now() - interval '150 days' + interval '1 hour', 'completed'),
  (:'salon_a', :'isha', :'meera_staff', now() - interval '20 days',  now() - interval '20 days' + interval '1 hour', 'completed'),
  -- Kiran most often, but over a year ago: doesn't count
  (:'salon_a', :'isha', :'kiran',       now() - interval '400 days', now() - interval '400 days' + interval '1 hour', 'completed'),
  (:'salon_a', :'isha', :'kiran',       now() - interval '410 days', now() - interval '410 days' + interval '1 hour', 'completed'),
  (:'salon_a', :'isha', :'kiran',       now() - interval '420 days', now() - interval '420 days' + interval '1 hour', 'completed'),
  -- Not completed visits don't count
  (:'salon_a', :'isha', :'kiran',       now() - interval '10 days',  now() - interval '10 days' + interval '1 hour', 'cancelled'),
  (:'salon_a', :'isha', :'kiran',       now() - interval '11 days',  now() - interval '11 days' + interval '1 hour', 'no_show'),
  (:'salon_a', :'isha', :'kiran',       now() + interval '3 days',   now() + interval '3 days' + interval '1 hour', 'booked');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
select t.ok(public.usual_stylist(:'salon_a', :'isha') = :'meera_staff'::uuid, 'usual stylist: tie on visits goes to the most recent (Meera)');
select t.ok(public.usual_stylist(:'salon_a', :'newbie') is null, 'usual stylist: none for a client without completed visits');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
select t.ok(public.usual_stylist(:'salon_a', :'isha') = :'meera_staff'::uuid, 'any team member (stylist) can look up the usual stylist');
reset role;
insert into public.appointments (salon_id, customer_id, staff_id, start_at, end_at, status)
  values (:'salon_a', :'isha', :'priya', now() - interval '300 days', now() - interval '300 days' + interval '1 hour', 'completed');
select t.ok(public.usual_stylist(:'salon_a', :'isha') = :'priya'::uuid, 'usual stylist: most completed visits in 12 months wins (Priya 3 vs Meera 2)');
update public.staff set active = false where id = :'priya';
select t.ok(public.usual_stylist(:'salon_a', :'isha') = :'meera_staff'::uuid, 'usual stylist skips someone who left the team');
update public.staff set active = true where id = :'priya';
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select t.ok(public.usual_stylist(:'salon_a', :'isha') = :'priya'::uuid, 'server (service role) can look up the usual stylist for the booking page');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select t.fails(format('select public.usual_stylist(%L, %L)', :'salon_a', :'isha'), 'another salon''s member cannot look up this salon''s clients');
select t.fails(format('select public.usual_stylist(%L, %L)', :'salon_a', :'rohan'), 'another salon''s owner cannot probe a client''s stylist');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', false);
select t.fails(format('select public.usual_stylist(%L, %L)', :'salon_a', :'isha'), 'a client cannot look up another client''s stylist');
update public.staff set show_on_booking = false where id = :'priya';
reset role;
select t.ok((select show_on_booking from public.staff where id = :'priya'), 'client cannot change stylist visibility');
set role anon;
select set_config('request.jwt.claims', '{}', false);
select t.fails(format('select public.usual_stylist(%L, %L)', :'salon_a', :'isha'), 'anonymous cannot look up a usual stylist');
reset role;
set role authenticated;

-- ===== Coins (prepaid balance, spent only at the salon that sold them) =====
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000f', 'desk@glow.in');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
insert into public.salon_members (salon_id, user_id, role) values (:'salon_a', '00000000-0000-0000-0000-00000000000f', 'receptionist');
-- Rohan's old number again (his login, user d, is linked to it further down)
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'Rohan M', '919811112222') returning id as coin_client \gset
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'Sneha', '919811113333') returning id as sneha \gset
select t.ok((select coin_balance from public.customers where id = :'coin_client') = 0, 'clients start with no coins');
select t.ok(public.fmt_inr(1234567.5) = '₹12,34,567.50' and public.fmt_inr(999) = '₹999' and public.fmt_inr(6100.00) = '₹6,100', 'amounts in messages use Indian grouping');
select t.ok((select coins_enabled and jsonb_array_length(coin_packs) = 3 from public.salons where id = :'salon_a'), 'coins on with three default packs');
select t.fails(format($q$update public.salons set coin_packs = '[{"pay":1000,"coins":900}]' where id = %L$q$, :'salon_a'), 'pack with fewer coins than paid rejected');
select t.fails(format($q$update public.salons set coin_packs = '[{"pay":0,"coins":100}]' where id = %L$q$, :'salon_a'), 'pack must cost something');
select t.fails(format($q$update public.salons set coin_packs = (select jsonb_agg(jsonb_build_object('pay', g * 1000, 'coins', g * 1100)) from generate_series(1, 9) g) where id = %L$q$, :'salon_a'), 'at most 8 coin packs');
select t.fails(format($q$update public.salons set coin_packs = '[{"pay":"lots","coins":100}]' where id = %L$q$, :'salon_a'), 'pack values must be numbers');

-- Front desk sells coins
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}', false);
select public.load_coins(:'salon_a', :'coin_client', 5000, 5500, 'upi', 'UPI 4411', null) as load1 \gset
select t.ok((:'load1'::jsonb ->> 'balance')::numeric = 5500 and (select coin_balance from public.customers where id = :'coin_client') = 5500, 'receptionist sells the ₹5,000 pack: 5,500 coins');
select t.ok((select count(*) = 2 and sum(coins) = 5500 and sum(amount_paid) = 5000 from public.coin_transactions where customer_id = :'coin_client')
  and exists (select 1 from public.coin_transactions where customer_id = :'coin_client' and kind = 'load' and coins = 5000 and method = 'upi' and reference = 'UPI 4411')
  and exists (select 1 from public.coin_transactions where customer_id = :'coin_client' and kind = 'bonus' and coins = 500 and balance_after = 5500), 'load + bonus rows written to the ledger');
select t.fails(format($q$select public.load_coins(%L, %L, 1000, 1200, 'cash')$q$, :'salon_a', :'coin_client'), 'custom bonus rejected for receptionist');
select t.ok((public.load_coins(:'salon_a', :'coin_client', 1000) ->> 'balance')::numeric = 6500, 'custom amount without bonus: 1 coin = ₹1');
select t.fails(format($q$select public.load_coins(%L, %L, 500, 400, 'cash')$q$, :'salon_a', :'coin_client'), 'fewer coins than paid rejected');
select t.fails(format($q$select public.load_coins(%L, %L, 500, null, 'wallet')$q$, :'salon_a', :'coin_client'), 'coins cannot be bought with coins');
select t.fails(format($q$select public.load_coins(%L, %L, 'NaN')$q$, :'salon_a', :'coin_client'), 'NaN amount rejected');
select t.fails(format($q$select public.load_coins(%L, %L, -100)$q$, :'salon_a', :'coin_client'), 'negative amount rejected');
select t.fails(format($q$select public.adjust_coins(%L, %L, 100, 'please')$q$, :'salon_a', :'coin_client'), 'front desk cannot adjust balances');

-- Paying a bill with coins
select * from public.create_invoice(:'salon_a', jsonb_build_object('customer_id', :'coin_client',
  'items', '[{"kind":"custom","name":"Haircut","qty":1,"unit_price":600}]'::jsonb,
  'payments', '[{"method":"wallet","amount":400},{"method":"cash","amount":200}]'::jsonb)) \gset cinv_
select t.ok(:'cinv_status' = 'paid' and :cinv_paid_total = 600, 'bill paid partly with coins');
select t.ok((select coin_balance from public.customers where id = :'coin_client') = 6100, 'paying with coins reduces the balance');
select t.ok(exists (select 1 from public.payments where invoice_id = :'cinv_id' and method = 'wallet' and amount = 400), 'coins payment recorded with method wallet');
select t.ok(exists (select 1 from public.coin_transactions where invoice_id = :'cinv_id' and kind = 'spend' and coins = -400 and balance_after = 6100), 'spend row linked to the bill');
select t.ok(t.err(format($q$select public.create_invoice(%L, jsonb_build_object('customer_id', %L, 'items', '[{"kind":"custom","name":"Bridal","qty":1,"unit_price":20000}]'::jsonb, 'payments', '[{"method":"wallet","amount":7000}]'::jsonb))$q$, :'salon_a', :'coin_client'))
  = 'Not enough coins: balance ₹6,100', 'insufficient coins rejected with the balance');
select t.ok((select coin_balance from public.customers where id = :'coin_client') = 6100
  and (select count(*) from public.invoices where salon_id = :'salon_a' and total = 20000) = 0, 'failed bill leaves balance and bill numbers alone');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"custom","name":"x","qty":1,"unit_price":100}],"payments":[{"method":"wallet","amount":100}]}'::jsonb)$q$, :'salon_a'), 'coins need a client on the bill');
select (public.create_invoice(:'salon_a', jsonb_build_object('customer_id', :'coin_client', 'items', '[{"kind":"custom","name":"Facial","qty":1,"unit_price":1000}]'::jsonb))).id as due_inv \gset
select (public.add_payment(:'due_inv', 'wallet', 300)).status as due_status \gset
select t.ok(:'due_status' = 'partial' and (select coin_balance from public.customers where id = :'coin_client') = 5800, 'later payment with coins (add_payment)');
select (public.create_invoice(:'salon_a', jsonb_build_object('customer_id', :'sneha', 'items', '[{"kind":"custom","name":"Manicure","qty":1,"unit_price":700}]'::jsonb))).id as sneha_inv \gset
select t.fails(format($q$select public.add_payment(%L, 'wallet', 100)$q$, :'sneha_inv'), 'add_payment with coins needs enough balance');
select t.fails(format($q$select public.void_invoice(%L, 'oops')$q$, :'cinv_id'), 'front desk cannot cancel bills (no coin refunds)');

-- Owner: cancel refunds coins, adjustments, custom bonus
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
select public.void_invoice(:'cinv_id', 'Billed twice by mistake') \gset
select t.ok((select coin_balance from public.customers where id = :'coin_client') = 6200
  and exists (select 1 from public.coin_transactions where invoice_id = :'cinv_id' and kind = 'refund' and coins = 400), 'cancelling a bill refunds the coins spent on it');
select public.void_invoice(:'cinv_id', 'again') \gset
select t.ok((select count(*) from public.coin_transactions where invoice_id = :'cinv_id' and kind = 'refund') = 1, 'cancelling twice refunds once');
select public.void_invoice(:'due_inv', 'Wrong amount') \gset
select t.ok((select coin_balance from public.customers where id = :'coin_client') = 6500, 'coins from a later payment are refunded too');
select t.ok((public.adjust_coins(:'salon_a', :'sneha', 250, 'Goodwill for the delay') ->> 'balance')::numeric = 250, 'owner adds coins with a note');
select t.fails(format($q$select public.adjust_coins(%L, %L, 100, '  ')$q$, :'salon_a', :'sneha'), 'adjustment needs a note');
select t.ok(t.err(format($q$select public.adjust_coins(%L, %L, -1000, 'fix')$q$, :'salon_a', :'sneha')) like 'That would take the balance below zero%', 'adjustment never goes below zero');
select t.ok((public.load_coins(:'salon_a', :'sneha', 1000, 1300, 'card') ->> 'balance')::numeric = 1550, 'owner can give a custom bonus');
select t.fails(format($q$update public.customers set coin_balance = 99999 where id = %L$q$, :'coin_client'), 'direct update of coin_balance blocked');
select t.fails(format($q$insert into public.customers (salon_id, name, phone, coin_balance) values (%L, 'Rich', '919811114444', 500)$q$, :'salon_a'), 'client cannot be created with coins');
select t.fails(format($q$insert into public.coin_transactions (salon_id, customer_id, kind, coins, balance_after) values (%L, %L, 'adjust', 1000, 1000)$q$, :'salon_a', :'sneha'), 'ledger rows cannot be inserted directly');
update public.coin_transactions set coins = 99999 where customer_id = :'sneha';
delete from public.coin_transactions where customer_id = :'sneha';
select t.ok((select count(*) = 3 and max(coins) < 99999 from public.coin_transactions where customer_id = :'sneha'), 'ledger rows cannot be edited or deleted');
select t.fails(format($q$select public.coin_post(%L, %L, 'adjust', 100000)$q$, :'salon_a', :'sneha'), 'internal coin_post is not callable');
select t.fails(format($q$delete from public.customers where id = %L$q$, :'sneha'), 'client with coin history cannot be deleted');
update public.salons set coins_enabled = false where id = :'salon_a';
select t.fails(format($q$select public.load_coins(%L, %L, 100)$q$, :'salon_a', :'sneha'), 'no coin sales while coins are turned off');
select t.ok((public.add_payment(:'sneha_inv', 'wallet', 700)).status = 'paid', 'existing coins still spendable when sales are off');
update public.salons set coins_enabled = true where id = :'salon_a';
select public.salon_report(:'salon_a', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) as crep \gset
select t.ok((:'crep'::jsonb ->> 'coins_sold')::numeric = 7000 and (:'crep'::jsonb ->> 'coins_bonus')::numeric = 800
  and (:'crep'::jsonb ->> 'coins_redeemed')::numeric = 700 and (:'crep'::jsonb ->> 'coins_outstanding')::numeric = 7350
  and (:'crep'::jsonb ->> 'revenue')::numeric > 0, 'report: coins sold, bonus, used and outstanding');

-- Stylist
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
select t.fails(format($q$select public.load_coins(%L, %L, 100)$q$, :'salon_a', :'sneha'), 'stylist cannot sell coins');
select t.fails(format($q$select public.adjust_coins(%L, %L, 100, 'x')$q$, :'salon_a', :'sneha'), 'adjust by stylist rejected');
select t.ok((select count(*) from public.coin_transactions) = 0, 'stylist cannot see the coin ledger');

-- Another salon
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select t.ok((select count(*) from public.coin_transactions) = 0, 'other salon cannot see coin history');
select t.fails(format($q$select public.load_coins(%L, %L, 100)$q$, :'salon_a', :'sneha'), 'other salon cannot sell coins at this salon');
select t.fails(format($q$select public.load_coins(%L, %L, 100)$q$, :'salon_b', :'sneha'), 'other salon cannot load coins onto this salon''s client');
select t.fails(format($q$select public.create_invoice(%L, jsonb_build_object('customer_id', %L, 'items', '[{"kind":"custom","name":"Fade","qty":1,"unit_price":300}]'::jsonb, 'payments', '[{"method":"wallet","amount":300}]'::jsonb))$q$, :'salon_b', :'sneha'), 'coins can only be spent at the salon that sold them');
select t.fails(format($q$select public.adjust_coins(%L, %L, 100, 'x')$q$, :'salon_a', :'sneha'), 'other salon owner cannot adjust');

-- The client (phone login) sees their own coins only
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', false);
select t.ok(public.claim_customer_profiles() >= 1, 'client login links the new record');
select t.ok((select coin_balance from public.customers where id = :'coin_client') = 6500, 'client sees own balance');
select t.ok((select count(*) from public.coin_transactions) > 0 and not exists (select 1 from public.coin_transactions where customer_id <> :'coin_client'), 'client sees own coin history only');
select t.ok(not exists (select 1 from public.coin_transactions where customer_id = :'sneha'), 'client cannot see other clients'' coins');
select t.fails(format($q$select public.load_coins(%L, %L, 100)$q$, :'salon_a', :'coin_client'), 'client cannot load coins themselves');

-- ===== International clients (Bhutan +975, Jaigaon border) =====
reset role;
-- Supabase keeps auth phones as digits without "+"; Karma signed in with +975 17 12 34 56 and entered the code.
insert into auth.users (id, phone, phone_confirmed_at) values ('00000000-0000-0000-0000-000000000975', '97517123456', now());
-- Started a sign-up with Karma's number but never entered the code
insert into auth.users (id, phone) values ('00000000-0000-0000-0000-000000000976', '97517123456');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'Karma Wangmo', '97517123456') returning id as karma_a \gset
select t.ok((select phone from public.customers where id = :'karma_a') = '97517123456', 'front desk adds a Bhutan (+975) client');
insert into public.customers (salon_id, name, phone) values (:'salon_a', 'Pema', '97577123456'), (:'salon_a', 'Sita', '9779841234567'), (:'salon_a', 'Rahim', '8801712345678');
select t.ok((select count(*) from public.customers where salon_id = :'salon_a' and phone in ('97577123456', '9779841234567', '8801712345678')) = 3, 'TashiCell, Nepal and Bangladesh numbers stored as digits with country code');
select t.fails(format($q$insert into public.customers (salon_id, name, phone) values (%L, 'Karma again', '97517123456')$q$, :'salon_a'), 'same +975 number cannot be added twice at one salon');
select t.fails(format($q$insert into public.customers (salon_id, name, phone) values (%L, 'Plus sign', '+97517123456')$q$, :'salon_a'), 'phone stored without "+"');
select t.fails(format($q$insert into public.customers (salon_id, name, phone) values (%L, 'National only', '17123456')$q$, :'salon_a'), 'Bhutan number without its country code rejected');
-- She also visits the other salon (created there by the booking service, as the public booking page does)
reset role;
insert into public.customers (salon_id, name, phone) values (:'salon_b', 'Karma W', '97517123456') returning id as karma_b \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000976","role":"authenticated"}', false);
select t.ok(public.claim_customer_profiles() = 0 and (select count(*) from public.customers) = 0, 'unverified +975 sign-up cannot claim the records');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000975","role":"authenticated"}', false);
select t.ok((select count(*) from public.customers) = 0, '+975 login sees nothing before claiming');
select t.ok(public.claim_customer_profiles() = 2, '+975 phone login claims her records at both salons');
select t.ok((select count(*) from public.customers) = 2 and not exists (select 1 from public.customers where phone <> '97517123456'), '+975 client sees only her own records');
select t.ok((select count(*) from public.customers where id in (:'karma_a', :'karma_b') and user_id = '00000000-0000-0000-0000-000000000975') = 2, 'both records linked to her login');
select t.ok(public.claim_customer_profiles() = 2, 'claiming again is harmless');
reset role;
update auth.users set phone = '+97577123456', phone_confirmed_at = now() where id = '00000000-0000-0000-0000-000000000976';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000976","role":"authenticated"}', false);
select public.claim_customer_profiles() as pema_claimed \gset
select t.ok(:pema_claimed = 1 and (select name from public.customers) = 'Pema', 'auth phone with a "+" still matches the stored digits');

-- ===== GST modes (0007): Bill / Bill of Supply / Tax Invoice =====
reset role;
select t.ok(public.service_gst_rate('2025-09-21') = 18 and public.service_gst_rate('2025-09-22') = 5 and public.service_gst_rate('2026-10-28') = 5,
  'salon services: 18% until 21 Sep 2025, 5% from 22 Sep 2025');
select t.ok(public.gst_place_of_supply('West Bengal', null) = 'West Bengal (19)'
  and public.gst_place_of_supply('Karnataka', '19ABCDE1234F1Z5') = 'West Bengal (19)'
  and public.gst_place_of_supply(' ', null) is null, 'place of supply: state with its GST code, GSTIN state wins');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'tashi@jaigaon.in');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}', false);
select t.fails('select public.create_salon(''Tashi Salon'', ''tashi-salon'', p_gst_mode => ''regular'')', 'registered salon needs a GSTIN at sign-up');
select t.fails('select public.create_salon(''Tashi Salon'', ''tashi-salon'', p_gst_mode => ''sometimes'')', 'unknown GST mode rejected');
select (public.create_salon('Tashi Beauty Parlour', 'tashi-beauty', '919800012345', 'Jaigaon', 'Tashi', true, p_state => 'West Bengal')).id as salon_u \gset
select (public.create_salon('Dooars Unisex Salon', 'dooars-salon', null, 'Jaigaon', 'Tashi', false, 'composition', '19abcde1234f1z5', 'West Bengal')).id as salon_c \gset
select t.ok((select gst_mode = 'unregistered' and gstin is null and state = 'West Bengal' from public.salons where id = :'salon_u'), 'default sign-up: not GST registered');
select t.ok((select gst_mode = 'composition' and gstin = '19ABCDE1234F1Z5' from public.salons where id = :'salon_c'), 'composition salon signs up with its GSTIN (cleaned up)');
select t.ok((select sac_code from public.services where salon_id = :'salon_u' and name = 'Facial') = '999722'
  and (select sac_code from public.services where salon_id = :'salon_u' and name = 'Haircut') = '999721', 'starter menu carries SAC codes');
select t.fails(format('update public.services set gst_rate = 7 where salon_id = %L', :'salon_u'), 'service GST override must be a GST slab');
select t.fails(format('update public.services set sac_code = %L where salon_id = %L', '998599', :'salon_u'), 'service SAC must be a salon SAC (99972x)');
select id as u_cut from public.services where salon_id = :'salon_u' and name = 'Haircut' \gset
select id as u_facial from public.services where salon_id = :'salon_u' and name = 'Facial' \gset

-- Unregistered: a plain bill, no GST anywhere, whatever the app sends
select * from public.create_invoice(:'salon_u', jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('kind','service','service_id',:'u_cut','name','Haircut','qty',1,'unit_price',600,'gst_rate',18),
  jsonb_build_object('kind','product','name','Hair oil','qty',2,'unit_price',149.50,'gst_rate',5,'code','3305'),
  jsonb_build_object('kind','custom','name','Threading','qty',1,'unit_price',60)))) \gset u_
select t.ok(:'u_bill_type' = 'bill' and :'u_gst_mode' = 'unregistered' and :u_cgst = 0 and :u_sgst = 0 and :u_igst = 0
  and :u_total = 959 and :u_taxable_total = 959 and :u_composition_tax = 0, 'unregistered salon: plain bill, zero tax (959 = 600 + 299 + 60)');
select t.ok((select seller_gstin is null and place_of_supply is null and client_gstin is null from public.invoices where id = :'u_id'), 'unregistered bill carries no GSTIN or place of supply');
select t.ok((select bool_and(gst_rate = 0 and tax = 0 and taxable = line_total) from public.invoice_items where invoice_id = :'u_id'), 'every line of an unregistered bill has 0% and no tax');
select t.ok((select string_agg(code, ',' order by sort) from public.invoice_items where invoice_id = :'u_id') = '999721,3305,999729', 'SAC/HSN kept per line for the record');
select t.fails(format($q$select public.create_invoice(%L, '{"client_gstin":"19ABCDE1234F1Z5","items":[{"kind":"custom","name":"x","qty":1,"unit_price":100}]}'::jsonb)$q$, :'salon_u'),
  'client GSTIN refused on a bill that isn''t a tax invoice');
select t.ok((public.create_invoice(:'salon_u', '{"items":[{"kind":"product","name":"Soap","qty":1,"unit_price":40}]}'::jsonb)).total = 40,
  'unregistered salon can sell a product without choosing a GST rate');

-- Composition: bill of supply, no tax collected, 6% estimated for the salon
select * from public.create_invoice(:'salon_c', jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('kind','service','name','Facial','qty',1,'unit_price',1200,'gst_rate',18),
  jsonb_build_object('kind','product','name','Lipstick','qty',1,'unit_price',349,'gst_rate',18,'code','3304')))) \gset c_
select t.ok(:'c_bill_type' = 'bill_of_supply' and :c_cgst + :c_sgst = 0 and :c_total = 1549 and :c_composition_tax = 92.94,
  'composition salon: bill of supply, zero tax, composition tax 6% of 1549 = 92.94');
select t.ok(:'c_seller_gstin' = '19ABCDE1234F1Z5' and (select bool_and(gst_rate = 0 and tax = 0) from public.invoice_items where invoice_id = :'c_id'),
  'bill of supply shows the GSTIN but no tax on any line');

-- Regular: services at the statutory rate (or their override), products at the rate chosen, client GSTIN
update public.salons set gst_mode = 'regular', state = 'West Bengal' where id = :'salon_c';
select t.ok((select gst_mode from public.salons where id = :'salon_c') = 'regular', 'owner can change GST mode (composition to regular)');
update public.services set gst_rate = 0, sac_code = '999722' where id = :'u_facial';
update public.salons set gst_mode = 'regular', gstin = '19PQRSX5678K1Z2' where id = :'salon_u';
select * from public.create_invoice(:'salon_u', jsonb_build_object('client_gstin', '19pqrst1234k1z9', 'client_address', ' Hotel Druk,  Main Road, Jaigaon ',
  'items', jsonb_build_array(
    jsonb_build_object('kind','service','service_id',:'u_cut','name','Haircut','qty',1,'unit_price',600,'gst_rate',18,'code','999723'),
    jsonb_build_object('kind','service','service_id',:'u_facial','name','Facial','qty',1,'unit_price',1800),
    jsonb_build_object('kind','product','name','Face cream','qty',1,'unit_price',590,'gst_rate',18,'code','33049910'),
    jsonb_build_object('kind','product','name','Shampoo','qty',1,'unit_price',315,'gst_rate',5,'code','3305')))) \gset r_
-- 600 @5% incl -> 571.43 + 28.57 ; facial override 0% -> 1800 ; cream 590 @18% -> 500 + 90 ; shampoo 315 @5% -> 300 + 15
select t.ok(:'r_bill_type' = 'tax_invoice' and :r_total = 3305 and :r_taxable_total = 3171.43 and :r_cgst + :r_sgst = 133.57,
  'regular: 5% on services, 18% and 5% on products (3305 = 3171.43 + 133.57)');
select t.ok((select string_agg(gst_rate::int || ':' || code, ',' order by sort) from public.invoice_items where invoice_id = :'r_id') = '5:999721,0:999722,18:33049910,5:3305',
  'per-line rates and codes: service rate and SAC come from the menu, products keep theirs');
select t.ok(:'r_client_gstin' = '19PQRST1234K1Z9' and :'r_client_address' = 'Hotel Druk, Main Road, Jaigaon' and :'r_place_of_supply' = 'West Bengal (19)',
  'client GSTIN and address on the tax invoice; place of supply West Bengal (19)');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"product","name":"Serum","qty":1,"unit_price":500}]}'::jsonb)$q$, :'salon_u'),
  'regular: a product needs its GST rate');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"product","name":"Serum","qty":1,"unit_price":500,"gst_rate":7}]}'::jsonb)$q$, :'salon_u'),
  'regular: product rate must be a GST slab');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"product","name":"Serum","qty":1,"unit_price":500,"gst_rate":18,"code":"33A4"}]}'::jsonb)$q$, :'salon_u'),
  'HSN code must be 4, 6 or 8 digits');
select t.fails(format($q$select public.create_invoice(%L, '{"client_gstin":"19PQRST1234K1Z","items":[{"kind":"custom","name":"x","qty":1,"unit_price":100}]}'::jsonb)$q$, :'salon_u'),
  'client GSTIN format checked');
update public.salons set prices_include_tax = false where id = :'salon_u';
select * from public.create_invoice(:'salon_u', jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('kind','service','service_id',:'u_cut','name','Haircut','qty',1,'unit_price',1000)))) \gset x_
select t.ok(:x_total = 1050 and :x_cgst = 25 and :x_sgst = 25, 'GST added on top: ₹1,000 service + 5% = ₹1,050');
update public.salons set prices_include_tax = true where id = :'salon_u';
select t.fails(format('update public.salons set gst_mode = %L where id = %L', 'turbo', :'salon_u'), 'GST mode must be one of the three');

-- Reports: GST only from tax invoices; composition estimate; this financial year's turnover
select public.salon_report(:'salon_u', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) as urep \gset
select t.ok((:'urep'::jsonb ->> 'tax')::numeric = 133.57 + 50 and (:'urep'::jsonb ->> 'composition_tax')::numeric = 0
  and (:'urep'::jsonb ->> 'fy_turnover')::numeric = 959 + 40 + 3171.43 + 1000, 'report: GST only from tax invoices, turnover before tax for the year');
select t.ok((:'urep'::jsonb ->> 'fy_from')::date <= (now() at time zone 'Asia/Kolkata')::date
  and extract(month from (:'urep'::jsonb ->> 'fy_from')::date) = 4 and extract(day from (:'urep'::jsonb ->> 'fy_from')::date) = 1, 'financial year starts on 1 April');
select public.salon_report(:'salon_c', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) as crep2 \gset
select t.ok((:'crep2'::jsonb ->> 'tax')::numeric = 0 and (:'crep2'::jsonb ->> 'composition_tax')::numeric = 92.94, 'report: composition tax payable (estimate)');
reset role;
-- Old bills keep the mode they were issued under
select t.ok((select bill_type from public.invoices where id = :'c_id') = 'bill_of_supply', 'switching mode leaves earlier bills unchanged');
select t.fails(format($q$update public.invoices set bill_type = 'tax_invoice' where id = %L$q$, :'c_id'), 'bill type always matches the bill''s GST mode');
set role authenticated;

-- ===== Payment types for Jaigaon (0008) and receipts/UPI settings (0010) =====
select t.ok((select payment_methods = '{cash,upi,card,wallet}' and receipt_size = '80' and upi_vpa is null from public.salons where id = :'salon_u'),
  'defaults: cash, UPI, card, coins; 80 mm receipts; no UPI ID');
update public.salons set payment_methods = '{cash,cash_nu,upi,upi_bhutan,wallet}', upi_vpa = 'tashi.parlour@oksbi', upi_payee_name = 'Tashi Beauty Parlour', receipt_size = '58'
  where id = :'salon_u';
select t.ok((select payment_methods = '{cash,cash_nu,upi,upi_bhutan,wallet}' and upi_vpa = 'tashi.parlour@oksbi' and receipt_size = '58' from public.salons where id = :'salon_u'),
  'owner picks payment types (incl. Nu cash and Bhutan UPI), UPI ID and 58 mm receipts');
select t.fails(format($q$update public.salons set payment_methods = '{cash,bitcoin}' where id = %L$q$, :'salon_u'), 'unknown payment type rejected');
select t.fails(format($q$update public.salons set payment_methods = '{}' where id = %L$q$, :'salon_u'), 'at least one payment type');
select t.fails(format($q$update public.salons set payment_methods = '{wallet}' where id = %L$q$, :'salon_u'), 'coins alone are not enough (walk-ins need a way to pay)');
select t.fails(format($q$update public.salons set payment_methods = '{cash,cash}' where id = %L$q$, :'salon_u'), 'no duplicate payment types');
select t.fails(format($q$update public.salons set payment_methods = null where id = %L$q$, :'salon_u'), 'payment types cannot be null');
select t.fails(format($q$update public.salons set upi_vpa = 'tashi parlour@sbi' where id = %L$q$, :'salon_u'), 'UPI ID without spaces');
select t.fails(format($q$update public.salons set upi_vpa = '9876543210' where id = %L$q$, :'salon_u'), 'UPI ID needs @handle');
select t.fails(format($q$update public.salons set upi_vpa = 'x@sbi&am=1' where id = %L$q$, :'salon_u'), 'UPI ID cannot smuggle QR parameters');
select t.fails(format($q$update public.salons set upi_payee_name = repeat('a', 51) where id = %L$q$, :'salon_u'), 'payee name at most 50 characters');
select t.fails(format($q$update public.salons set receipt_size = '76' where id = %L$q$, :'salon_u'), 'receipt size is A4, 80 mm or 58 mm');
insert into public.customers (salon_id, name, phone) values (:'salon_u', 'Karma Dorji', '97517654321') returning id as karma \gset
select * from public.create_invoice(:'salon_u', jsonb_build_object('customer_id', :'karma', 'items', jsonb_build_array(
  jsonb_build_object('kind','service','service_id',:'u_cut','name','Haircut','qty',3,'unit_price',600)),
  'payments', '[{"method":"cash_nu","amount":1000,"reference":"Nu notes"},{"method":"upi_bhutan","amount":500,"reference":"BNB 4471"}]'::jsonb)) \gset nu_
select t.ok(:'nu_status' = 'partial' and :nu_paid_total = 1500 and :nu_total = 1800
  and (select count(*) from public.payments where invoice_id = :'nu_id' and method in ('cash_nu', 'upi_bhutan')) = 2, 'bill paid with Nu cash and Bhutan UPI, in rupees at par');
select t.ok((public.add_payment(:'nu_id', 'upi_bhutan', 300, 'BNB 4480')).status = 'paid', 'later payment by Bhutan UPI');
select t.ok((public.load_coins(:'salon_u', :'karma', 2000, null, 'cash_nu') ->> 'balance')::numeric = 2000, 'coins can be bought with Nu cash');
select (public.create_invoice(:'salon_u', jsonb_build_object('customer_id', :'karma', 'items', '[{"kind":"custom","name":"Head massage","qty":1,"unit_price":300}]'::jsonb,
  'payments', '[{"method":"wallet","amount":300}]'::jsonb))).status as kstatus \gset
select t.ok(:'kstatus' = 'paid' and (select coin_balance from public.customers where id = :'karma') = 1700, 'coins still pay bills at a Jaigaon salon');
select public.salon_report(:'salon_u', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date) as prep \gset
select t.ok((:'prep'::jsonb -> 'by_method' ->> 'cash_nu')::numeric = 1000 and (:'prep'::jsonb -> 'by_method' ->> 'upi_bhutan')::numeric = 800,
  'report payment mix shows Nu cash and Bhutan UPI separately');
select t.fails(format($q$select public.create_invoice(%L, '{"items":[{"kind":"custom","name":"x","qty":1,"unit_price":100}],"payments":[{"method":"paypal","amount":100}]}'::jsonb)$q$, :'salon_u'),
  'unknown payment method rejected on a bill');

-- ===== Day close and expenses (0009) =====
-- A small parlour (salon C) with an owner (Dolma), a front-desk login (Karma) and a stylist login (Pema).
-- Day D is eight days ago (salon-local); bills, payments and coin rows are moved onto D with exact local times.
reset role;
create function t.at(d date, hhmm text) returns timestamptz language sql immutable as $$
  select (d + hhmm::time) at time zone 'Asia/Kolkata';
$$;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'dolma@parlour.in', '{"full_name":"Dolma"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'karma@parlour.in', '{"full_name":"Karma"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'pema@parlour.in', '{"full_name":"Pema"}');
select (now() at time zone 'Asia/Kolkata')::date - 8 as d \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select (public.create_salon('Dolma Beauty Parlour', 'dolma-parlour', '919800000003', 'Jaigaon', 'Dolma')).id as salon_c \gset
select id as dolma_staff from public.staff where salon_id = :'salon_c' and user_id = '00000000-0000-0000-0000-0000000000c1' \gset
insert into public.staff (salon_id, user_id, name) values (:'salon_c', '00000000-0000-0000-0000-0000000000c2', 'Karma') returning id as karma_staff \gset
insert into public.staff (salon_id, user_id, name) values (:'salon_c', '00000000-0000-0000-0000-0000000000c3', 'Pema') returning id as pema_staff \gset
insert into public.salon_members (salon_id, user_id, role, staff_id) values
  (:'salon_c', '00000000-0000-0000-0000-0000000000c2', 'receptionist', :'karma_staff'),
  (:'salon_c', '00000000-0000-0000-0000-0000000000c3', 'stylist', :'pema_staff');
insert into public.customers (salon_id, name, phone) values (:'salon_c', 'Tashi', '97517112233') returning id as tashi \gset
select id as c_haircut from public.services where salon_id = :'salon_c' and name = 'Haircut' \gset
select id as c_facial from public.services where salon_id = :'salon_c' and name = 'Facial' \gset
-- Dolma: an unpaid bill three days before D (paid later, on D)
select (public.create_invoice(:'salon_c', '{"items":[{"kind":"custom","name":"Threading x4","qty":1,"unit_price":800}]}'::jsonb)).id as b4 \gset
-- Dolma: a UPI bill at 3:00 AM on D (still the previous day in UTC)
select (public.create_invoice(:'salon_c', '{"items":[{"kind":"custom","name":"Eyebrows","qty":1,"unit_price":200}],"payments":[{"method":"upi","amount":200}]}'::jsonb)).id as b7 \gset

-- Karma at the front desk
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', false);
select (public.create_invoice(:'salon_c', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind','service','service_id',:'c_haircut','staff_id',:'pema_staff','name','Haircut','qty',1,'unit_price',1000)),
  'payments', '[{"method":"cash","amount":1000}]'::jsonb))).id as b1 \gset
select (public.create_invoice(:'salon_c', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind','service','service_id',:'c_facial','staff_id',:'pema_staff','name','Facial','qty',1,'unit_price',2000,'discount',200)),
  'payments', '[{"method":"upi","amount":1800}]'::jsonb))).id as b2 \gset
select (public.create_invoice(:'salon_c', '{"items":[{"kind":"product","name":"Hair oil","qty":1,"unit_price":500}],"payments":[{"method":"cash","amount":500}]}'::jsonb)).id as b3 \gset
select (public.add_payment(:'b4', 'cash', 800)).status as b4_status \gset
select (public.create_invoice(:'salon_c', '{"items":[{"kind":"custom","name":"Head massage","qty":1,"unit_price":300}],"payments":[{"method":"cash","amount":300}]}'::jsonb)).id as b5 \gset
select (public.create_invoice(:'salon_c', '{"items":[{"kind":"custom","name":"Late wax","qty":1,"unit_price":999}],"payments":[{"method":"cash","amount":999}]}'::jsonb)).id as b6 \gset
select public.load_coins(:'salon_c', :'tashi', 2000, 2100, 'cash') \gset
select (public.create_invoice(:'salon_c', jsonb_build_object('customer_id', :'tashi', 'items', jsonb_build_array(jsonb_build_object('kind','service','staff_id',:'pema_staff','name','Pedicure','qty',1,'unit_price',700)),
  'payments', '[{"method":"wallet","amount":700}]'::jsonb))).id as b8 \gset
-- Dolma cancels the hair oil bill
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select public.void_invoice(:'b3', 'Client returned the oil') \gset
select t.ok((select voided_by from public.invoices where id = :'b3') = '00000000-0000-0000-0000-0000000000c1', 'cancelling a bill records who cancelled it');
-- Expenses on D (owner)
insert into public.expenses (salon_id, spent_on, category, amount, paid_from, note) values
  (:'salon_c', :'d', 'Electricity', 1500, 'upi', 'October bill'),
  (:'salon_c', :'d', 'Tea & snacks', 120, 'cash', null);
insert into public.expenses (salon_id, spent_on, category, amount, paid_from, staff_id) values (:'salon_c', :'d', 'Staff advance', 1000, 'cash', :'pema_staff') returning id as adv \gset
select t.ok((select created_by from public.expenses where id = :'adv') = '00000000-0000-0000-0000-0000000000c1', 'expense records who added it');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount, staff_id) values (%L, %L, 'Staff advance', 100, %L)$q$, :'salon_c', :'d', :'priya'), 'staff advance cannot name another salon''s staff');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Rent', 100)$q$, :'salon_c', (now() at time zone 'Asia/Kolkata')::date + 2), 'expense date cannot be in the future');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Bribes', 100)$q$, :'salon_c', :'d'), 'expense category must be one of the list');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Rent', 0)$q$, :'salon_c', :'d'), 'expense amount must be more than zero');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount, staff_id) values (%L, %L, 'Rent', 100, %L)$q$, :'salon_c', :'d', :'pema_staff'), 'only staff advances name a staff member');

-- Put everything at exact salon-local times
reset role;
update public.invoices set created_at = t.at(:'d'::date - 3, '17:00') where id = :'b4';
update public.invoices set created_at = t.at(:'d', '03:00') where id = :'b7';
update public.payments set created_at = t.at(:'d', '03:00') where invoice_id = :'b7';
update public.invoices set created_at = t.at(:'d', '10:00') where id = :'b1';
update public.payments set created_at = t.at(:'d', '10:00') where invoice_id = :'b1';
update public.invoices set created_at = t.at(:'d', '12:00') where id = :'b2';
update public.payments set created_at = t.at(:'d', '12:00') where invoice_id = :'b2';
update public.invoices set created_at = t.at(:'d', '13:00'), voided_at = t.at(:'d', '18:00') where id = :'b3';
update public.payments set created_at = t.at(:'d', '13:00') where invoice_id = :'b3';
update public.payments set created_at = t.at(:'d', '15:00') where invoice_id = :'b4';
update public.invoices set created_at = t.at(:'d', '23:30') where id = :'b5';
update public.payments set created_at = t.at(:'d', '23:30') where invoice_id = :'b5';
update public.invoices set created_at = t.at(:'d'::date + 1, '00:15') where id = :'b6';
update public.payments set created_at = t.at(:'d'::date + 1, '00:15') where invoice_id = :'b6';
update public.coin_transactions set created_at = t.at(:'d', '11:00') where customer_id = :'tashi' and kind in ('load', 'bonus');
update public.invoices set created_at = t.at(:'d', '16:00') where id = :'b8';
update public.payments set created_at = t.at(:'d', '16:00') where invoice_id = :'b8';
update public.coin_transactions set created_at = t.at(:'d', '16:00') where invoice_id = :'b8';
select t.ok((t.at(:'d'::date + 1, '00:15') at time zone 'UTC')::date = :'d'::date and (t.at(:'d', '03:00') at time zone 'UTC')::date = :'d'::date - 1, 'test set-up: two payments sit on the other side of the UTC date line');

-- Previous day: closed with ₹2,000 counted, ₹500 taken home => ₹1,500 opening cash on D
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select * from public.close_day(:'salon_c', :'d'::date - 1, 2000, null, 'First day on Styile', 500) \gset prev_
select t.ok(:prev_expected_cash = 0 and :prev_difference = 2000 and :prev_opening_cash = 0, 'close with nothing recorded: whole count shows as excess');

-- Karma (front desk) looks at D
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', false);
select public.day_summary(:'salon_c', :'d') as s \gset
select t.ok((:'s'::jsonb #>> '{totals,bills}')::int = 5 and (:'s'::jsonb #>> '{totals,sales}')::numeric = 4000,
  'summary: 5 bills worth ₹4,000 (cancelled bill and the 12:15 AM bill left out, the 3 AM bill counted)');
select t.ok((:'s'::jsonb #>> '{totals,voids}')::int = 1 and (:'s'::jsonb #>> '{totals,voids_total}')::numeric = 500
  and (:'s'::jsonb #>> '{voids,0,voided_by}') = 'Dolma' and (:'s'::jsonb #>> '{voids,0,billed_by}') = 'Karma'
  and (:'s'::jsonb #>> '{voids,0,reason}') = 'Client returned the oil' and (:'s'::jsonb #>> '{voids,0,paid_by_method,cash}')::numeric = 500,
  'summary: cancelled bill with amount, who billed, who cancelled, reason and cash paid on it');
select t.ok((:'s'::jsonb #>> '{totals,discounts}')::numeric = 200 and (:'s'::jsonb #>> '{discounts,0,billed_by}') = 'Karma', 'summary: discounts given and by whom');
select t.ok((:'s'::jsonb #>> '{by_method,cash,bills}')::numeric = 2600 and (:'s'::jsonb #>> '{by_method,cash,coins}')::numeric = 2000
  and (:'s'::jsonb #>> '{by_method,cash,refunds}')::numeric = 500 and (:'s'::jsonb #>> '{by_method,upi,net}')::numeric = 2000
  and (:'s'::jsonb #>> '{by_method,wallet,bills}')::numeric = 700,
  'summary: payments by method include a later payment on an older bill, coins sold for cash and the refund');
select t.ok((:'s'::jsonb #>> '{totals,collected}')::numeric = 6100 and (:'s'::jsonb #>> '{totals,received}')::numeric = 6600,
  'summary: money collected ₹6,100 (paying with coins is not money)');
select t.ok((:'s'::jsonb #>> '{totals,coins_sold}')::numeric = 2000 and (:'s'::jsonb #>> '{totals,coins_bonus}')::numeric = 100
  and (:'s'::jsonb #>> '{totals,coins_used}')::numeric = 700, 'summary: coins sold vs used');
select t.ok((:'s'::jsonb #>> '{totals,expenses}')::numeric = 2620 and (:'s'::jsonb #>> '{totals,expenses_cash}')::numeric = 1120
  and (:'s'::jsonb #>> '{expenses,by_paid_from,upi}')::numeric = 1500 and (:'s'::jsonb #>> '{expenses,by_category,Staff advance}')::numeric = 1000,
  'summary: expenses by how they were paid and by category');
select t.ok((:'s'::jsonb #>> '{opening,cash}')::numeric = 1500 and (:'s'::jsonb #>> '{totals,expected_cash}')::numeric = 4480,
  'cash expected = 1,500 opening + 4,600 cash in − 500 handed back − 1,120 cash expenses = 4,480');
select t.ok((:'s'::jsonb #>> '{totals,expected_cash_nu}')::numeric = 0 and not (:'s'::jsonb ->> 'uses_nu')::boolean, 'no Ngultrum expected when none was taken');
select t.ok((select (e ->> 'services')::int = 3 and (e ->> 'sales')::numeric = 3500
             from jsonb_array_elements(:'s'::jsonb -> 'by_staff') e where e ->> 'name' = 'Pema'), 'by staff: Pema did 3 services, ₹3,500 (unregistered salon: no GST)');
select t.ok((select (e #>> '{collected_by_method,cash}')::numeric = 4600 and (e #>> '{collected_by_method,upi}')::numeric = 1800
             and (e ->> 'collected')::numeric = 6400 and e ->> 'staff_id' = :'karma_staff'
             from jsonb_array_elements(:'s'::jsonb -> 'by_staff') e where e ->> 'name' = 'Karma'), 'by staff: Karma took ₹4,600 cash and ₹1,800 UPI');
select t.ok((select (e #>> '{collected_by_method,upi}')::numeric = 200 from jsonb_array_elements(:'s'::jsonb -> 'by_staff') e where e ->> 'name' = 'Dolma'),
  'by staff: Dolma took the 3 AM UPI payment');
select t.ok((public.day_summary(:'salon_c', :'d'::date + 1) #>> '{by_method,cash,bills}')::numeric = 999, 'the 12:15 AM payment belongs to the next day');

-- Receptionist closes D
select t.fails(format('select public.close_day(%L, %L, 100)', :'salon_c', (now() at time zone 'Asia/Kolkata')::date + 1), 'cannot close a future day');
select t.fails(format('select public.close_day(%L, %L, -5)', :'salon_c', :'d'), 'counted cash cannot be negative');
select t.fails(format('select public.close_day(%L, %L, 100, null, null, 200)', :'salon_c', :'d'), 'cannot take out more cash than counted');
select t.fails(format($q$insert into public.day_closes (salon_id, business_date, counted_cash, expected_cash, difference) values (%L, %L, 0, 0, 0)$q$, :'salon_c', :'d'), 'a close cannot be inserted directly (snapshot comes from the database)');
select * from public.close_day(:'salon_c', :'d', 4400, null, 'Short ₹80 — checking with Karma', 4000) \gset cl_
select t.ok(:cl_expected_cash = 4480 and :cl_difference = -80 and :cl_opening_cash = 1500 and :'cl_closed_by' = '00000000-0000-0000-0000-0000000000c2',
  'front desk closes the day: ₹80 short recorded');
select t.ok((select jsonb_array_length(by_staff) = 3 and (totals ->> 'collected')::numeric = 6100 and (by_method #>> '{cash,net}')::numeric = 4100
             and details ->> 'closed_by_name' = 'Karma' and jsonb_array_length(details -> 'voids') = 1
             from public.day_closes where id = :'cl_id'), 'close keeps the snapshot (by staff, by method, totals, cancelled bills)');
select t.fails(format('select public.close_day(%L, %L, 4480)', :'salon_c', :'d'), 'a day cannot be closed twice');
select t.ok((public.day_summary(:'salon_c', :'d'::date + 1) #>> '{opening,cash}')::numeric = 400, 'next day opens with what was left in the drawer (₹4,400 − ₹4,000 taken out)');
-- Expenses: front desk adds today's, cannot touch closed or older days
insert into public.expenses (salon_id, spent_on, category, amount, paid_from) values (:'salon_c', public.salon_today(:'salon_c'), 'Tea & snacks', 60, 'cash') returning id as tea \gset
select t.ok((select count(*) from public.expenses where salon_id = :'salon_c') = 1, 'front desk sees today''s expenses only');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Rent', 100)$q$, :'salon_c', :'d'::date + 2), 'front desk cannot back-date expenses');
update public.expenses set amount = 6 where id = :'tea';
delete from public.expenses where id = :'tea';
select t.ok((select amount from public.expenses where id = :'tea') = 60, 'front desk cannot edit or delete expenses');
delete from public.day_closes where id = :'cl_id';
select t.ok(exists (select 1 from public.day_closes where id = :'cl_id'), 'front desk cannot reopen a closed day');

-- Stylist
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', false);
select t.ok((select count(*) from public.expenses) = 0, 'stylist cannot see expenses');
select t.ok((select count(*) from public.day_closes) = 0, 'stylist cannot see day closes');
select t.fails(format('select public.day_summary(%L, %L)', :'salon_c', :'d'), 'stylist cannot see the day summary');
select t.fails(format('select public.close_day(%L, %L, 0)', :'salon_c', public.salon_today(:'salon_c')), 'stylist cannot close the day');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Rent', 100)$q$, :'salon_c', public.salon_today(:'salon_c')), 'stylist cannot add expenses');
select t.fails(format('select public.expense_report(%L, %L, %L)', :'salon_c', :'d', :'d'), 'stylist cannot see the expense report');
delete from public.day_closes where id = :'cl_id';

-- Another salon's owner
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
select t.ok((select count(*) from public.expenses) = 0 and (select count(*) from public.day_closes) = 0, 'other salon cannot see expenses or closes');
select t.fails(format('select public.day_summary(%L, %L)', :'salon_c', :'d'), 'other salon cannot read the day summary');
select t.fails(format('select public.close_day(%L, %L, 0)', :'salon_c', public.salon_today(:'salon_c')), 'other salon cannot close the day');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Rent', 100)$q$, :'salon_c', public.salon_today(:'salon_c')), 'other salon cannot add expenses');
select t.fails(format('select public.expense_report(%L, %L, %L)', :'salon_c', :'d', :'d'), 'other salon cannot read the expense report');
delete from public.day_closes where id = :'cl_id';
delete from public.expenses where id = :'tea';

-- Owner: closed days freeze their expenses; reopening unfreezes and allows a new close
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select t.ok(exists (select 1 from public.day_closes where id = :'cl_id') and exists (select 1 from public.expenses where id = :'tea'), 'stylist and other salon could not delete anything');
select t.ok(t.err(format($q$update public.expenses set amount = 1400 where id = %L$q$, :'adv')) like 'The day % is closed.%', 'expenses of a closed day cannot be changed');
select t.fails(format($q$insert into public.expenses (salon_id, spent_on, category, amount) values (%L, %L, 'Repairs', 300)$q$, :'salon_c', :'d'), 'expenses cannot be added to a closed day');
select t.ok((public.expense_report(:'salon_c', :'d', :'d') ->> 'total')::numeric = 2620 and (public.expense_report(:'salon_c', :'d', :'d') ->> 'staff_advances')::numeric = 1000,
  'expense report totals and staff advances');
delete from public.day_closes where id = :'cl_id';
select t.ok(not exists (select 1 from public.day_closes where id = :'cl_id'), 'owner reopens the day');
insert into public.expenses (salon_id, spent_on, category, amount, paid_from) values (:'salon_c', :'d', 'Repairs', 80, 'cash');
select * from public.close_day(:'salon_c', :'d', 4400, 25, 'Found the ₹80: dryer repair', 4000, 25) \gset cl2_
select t.ok(:cl2_expected_cash = 4400 and :cl2_difference = 0 and :cl2_difference_nu = 25, 'closing again after reopening: balanced (Ngultrum counted separately)');

-- ===== Day close with Ngultrum cash (0008 + 0009) =====
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', false);
select (public.create_invoice(:'salon_c', '{"items":[{"kind":"custom","name":"Haircut (Bhutanese client)","qty":1,"unit_price":450}],"payments":[{"method":"cash_nu","amount":450}]}'::jsonb)).id as nu_bill \gset
select public.day_summary(:'salon_c', (now() at time zone 'Asia/Kolkata')::date) as s_nu \gset
select t.ok((:'s_nu'::jsonb -> 'totals' ->> 'expected_cash_nu')::numeric >= 450 and (:'s_nu'::jsonb ->> 'uses_nu')::boolean,
  'Ngultrum cash is expected separately in the drawer');
select t.ok(not ((:'s_nu'::jsonb -> 'totals' ->> 'expected_cash')::numeric >= 450 and (:'s_nu'::jsonb -> 'totals' ->> 'expected_cash')::numeric - 450 = (:'s_nu'::jsonb -> 'totals' ->> 'opening_cash')::numeric),
  'Ngultrum is not added to the rupee drawer');
reset role;

-- ===== Anonymous =====
reset role;
set role anon;
select set_config('request.jwt.claims', '{}', false);
select t.fails('select count(*) from public.salons', 'anonymous has no table access');
select t.fails('select public.create_salon(''X'', ''xx-salon'')', 'anonymous cannot create salon');
reset role;
\echo ALL DATABASE TESTS PASSED
