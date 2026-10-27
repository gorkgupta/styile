-- Styile — row level security.
-- Roles:
--   platform admin  : profiles.is_platform_admin, sees every salon (you, the software vendor)
--   owner           : full control of their salon
--   manager         : runs the salon day to day, no billing/subscription or team-role changes
--   receptionist    : front desk — calendar, clients, billing
--   stylist         : own calendar, clients; no invoices or reports
--   customer        : an auth user linked to customers.user_id; sees only their own visits and bills
-- Writes from the public booking page and the WhatsApp bot run on the server with the service role,
-- after validation, so anonymous users get no table access at all.

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse through RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_role(p_salon uuid) returns public.member_role
language sql stable security definer set search_path = public as $$
  select role from public.salon_members where salon_id = p_salon and user_id = auth.uid();
$$;

create or replace function public.is_member(p_salon uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.salon_members where salon_id = p_salon and user_id = auth.uid())
      or public.is_platform_admin();
$$;

create or replace function public.has_role(p_salon uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role(p_salon) = any (p_roles), false) or public.is_platform_admin();
$$;

create or replace function public.my_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.customers where user_id = auth.uid() and auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.salons enable row level security;
alter table public.salon_secrets enable row level security;
alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.salon_members enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.staff_services enable row level security;
alter table public.customers enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_services enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages enable row level security;

-- Anonymous visitors get nothing directly.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create policy profiles_self_read on public.profiles for select
  using (id = auth.uid() or public.is_platform_admin()
         or exists (select 1 from public.salon_members m1
                    join public.salon_members m2 on m1.salon_id = m2.salon_id
                    where m1.user_id = auth.uid() and m2.user_id = profiles.id));
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- Protected columns (platform admin flag, subscription, invoice numbering, WhatsApp routing) can only be
-- changed by the platform admin, the service role, or internal functions. Column-level REVOKE does not
-- override Supabase's table-level grants, so this is enforced with triggers.
create or replace function public.is_trusted_writer() returns boolean
language sql stable as $$
  select coalesce(coalesce(auth.role(), 'service_role') not in ('authenticated', 'anon')
      or coalesce(current_setting('styile.internal', true), '') = 'on'
      or public.is_platform_admin(), false);
$$;

create or replace function public.guard_profiles() returns trigger
language plpgsql as $$
begin
  if new.is_platform_admin is distinct from old.is_platform_admin and not public.is_trusted_writer() then
    raise exception 'Only the platform admin can change admin access';
  end if;
  -- email/phone mirror the verified auth identity (team invites look accounts up by email), so users can't edit them.
  if (new.email is distinct from old.email or new.phone is distinct from old.phone) and not public.is_trusted_writer() then
    raise exception 'Email and phone are managed by your login';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profiles();

create or replace function public.guard_salons() returns trigger
language plpgsql as $$
begin
  if not public.is_trusted_writer() and (
       new.plan is distinct from old.plan or new.plan_status is distinct from old.plan_status
    or new.trial_ends_at is distinct from old.trial_ends_at or new.next_invoice_no is distinct from old.next_invoice_no
    or new.wa_phone_number_id is distinct from old.wa_phone_number_id
    or new.wa_business_account_id is distinct from old.wa_business_account_id
    or new.wa_display_number is distinct from old.wa_display_number
    or new.slug is distinct from old.slug) then
    raise exception 'These salon settings are managed by the platform';
  end if;
  if new.timezone is distinct from old.timezone and not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone';
  end if;
  return new;
end $$;
create trigger salons_guard before update on public.salons for each row execute function public.guard_salons();

-- Tenant integrity: foreign keys don't know about salons, so a member of salon A could otherwise point a row at
-- salon B's client, stylist, appointment or bill (e.g. block B's stylist via the overlap constraint, message B's
-- clients, or pull B's stylist names/commission into A's reports). Every reference must share the row's salon_id.
-- Arguments are pairs: column name, referenced table. Runs for all writers, including security definer functions.
create or replace function public.check_same_salon() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  i integer := 0;
  v_col text; v_tbl text; v_id uuid; v_salon uuid;
begin
  while i < tg_nargs loop
    v_col := tg_argv[i];
    v_tbl := tg_argv[i + 1];
    i := i + 2;
    v_id := (to_jsonb(new) ->> v_col)::uuid;
    continue when v_id is null;
    continue when tg_op = 'UPDATE' and new.salon_id = old.salon_id and v_id is not distinct from (to_jsonb(old) ->> v_col)::uuid;
    execute format('select salon_id from public.%I where id = $1', v_tbl) into v_salon using v_id;
    if v_salon is distinct from new.salon_id then
      raise exception 'That % is not part of this salon. Refresh and try again.',
        case v_col when 'customer_id' then 'client' when 'staff_id' then 'stylist' when 'invoice_id' then 'bill'
                   when 'conversation_id' then 'chat' else replace(replace(v_col, '_id', ''), '_', ' ') end;
    end if;
  end loop;
  return new;
end $$;

create trigger staff_same_salon before insert or update on public.staff
  for each row execute function public.check_same_salon('branch_id', 'branches');
create trigger members_same_salon before insert or update on public.salon_members
  for each row execute function public.check_same_salon('staff_id', 'staff');
create trigger services_same_salon before insert or update on public.services
  for each row execute function public.check_same_salon('category_id', 'service_categories');
create trigger staff_services_same_salon before insert or update on public.staff_services
  for each row execute function public.check_same_salon('staff_id', 'staff', 'service_id', 'services');
create trigger appointments_same_salon before insert or update on public.appointments
  for each row execute function public.check_same_salon('branch_id', 'branches', 'customer_id', 'customers', 'staff_id', 'staff', 'invoice_id', 'invoices');
create trigger appt_services_same_salon before insert or update on public.appointment_services
  for each row execute function public.check_same_salon('appointment_id', 'appointments', 'service_id', 'services');
create trigger invoices_same_salon before insert or update on public.invoices
  for each row execute function public.check_same_salon('branch_id', 'branches', 'customer_id', 'customers', 'appointment_id', 'appointments');
create trigger invoice_items_same_salon before insert or update on public.invoice_items
  for each row execute function public.check_same_salon('invoice_id', 'invoices', 'service_id', 'services', 'staff_id', 'staff');
create trigger payments_same_salon before insert or update on public.payments
  for each row execute function public.check_same_salon('invoice_id', 'invoices');
create trigger wa_conv_same_salon before insert or update on public.wa_conversations
  for each row execute function public.check_same_salon('customer_id', 'customers');
create trigger wa_msg_same_salon before insert or update on public.wa_messages
  for each row execute function public.check_same_salon('conversation_id', 'wa_conversations');

-- ---------------------------------------------------------------------------
-- Salons
-- ---------------------------------------------------------------------------
create policy salons_read on public.salons for select using (public.is_member(id));
create policy salons_owner_update on public.salons for update
  using (public.has_role(id, '{owner}')) with check (public.has_role(id, '{owner}'));
create policy salons_platform_admin on public.salons for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- salon_secrets: RLS on, no policies => only the service role can read or write.

-- ---------------------------------------------------------------------------
-- Settings-type tables: members read, owner/manager write
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['branches', 'staff', 'service_categories', 'services', 'staff_services'] loop
    execute format('create policy %1$s_read on public.%1$s for select using (public.is_member(salon_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.has_role(salon_id, ''{owner,manager}'')) with check (public.has_role(salon_id, ''{owner,manager}''))', t);
  end loop;
end $$;

-- Customers can see the menu of salons they are a client of (portal re-booking). They get no direct access to
-- staff rows (phone numbers, commission, logins): anyone can become a client by booking online, so the portal
-- reads stylist names on the server instead.
create policy services_customer_read on public.services for select
  using (salon_id in (select salon_id from public.customers where user_id = auth.uid()));
create policy salons_customer_read on public.salons for select
  using (id in (select salon_id from public.customers where user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Team membership
-- ---------------------------------------------------------------------------
create policy members_read on public.salon_members for select
  using (user_id = auth.uid() or public.is_member(salon_id));
create policy members_owner_write on public.salon_members for all
  using (public.has_role(salon_id, '{owner}')) with check (public.has_role(salon_id, '{owner}'));

-- ---------------------------------------------------------------------------
-- Customers (clients)
-- ---------------------------------------------------------------------------
create policy customers_staff_read on public.customers for select using (public.is_member(salon_id));
create policy customers_staff_insert on public.customers for insert with check (public.is_member(salon_id));
create policy customers_staff_update on public.customers for update
  using (public.is_member(salon_id)) with check (public.is_member(salon_id));
create policy customers_manager_delete on public.customers for delete
  using (public.has_role(salon_id, '{owner,manager}'));
create policy customers_self_read on public.customers for select using (user_id = auth.uid());

-- customers.user_id grants a login read access to the client's visits and bills (my_customer_ids), so only
-- claim_customer_profiles() (verified phone) and the server can set it. Otherwise a staff member could link every
-- client to their own login and keep reading the salon's appointments and bills after being removed from the team.
create or replace function public.guard_customers() returns trigger
language plpgsql as $$
begin
  if public.is_trusted_writer() then return new; end if;
  if tg_op = 'UPDATE' and new.phone is distinct from old.phone then
    new.user_id := null; -- the login belonged to the old number; the new number's owner links on their next sign-in
  elsif (tg_op = 'INSERT' and new.user_id is not null)
     or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'Client logins are linked automatically when the client signs in with their phone';
  end if;
  return new;
end $$;
create trigger customers_guard before insert or update on public.customers for each row execute function public.guard_customers();

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create policy appts_staff_read on public.appointments for select using (public.is_member(salon_id));
create policy appts_staff_insert on public.appointments for insert with check (public.is_member(salon_id));
create policy appts_staff_update on public.appointments for update
  using (public.is_member(salon_id)) with check (public.is_member(salon_id));
create policy appts_manager_delete on public.appointments for delete
  using (public.has_role(salon_id, '{owner,manager}'));
create policy appts_customer_read on public.appointments for select
  using (customer_id in (select public.my_customer_ids()));

create policy appt_services_staff on public.appointment_services for all
  using (public.is_member(salon_id)) with check (public.is_member(salon_id));
create policy appt_services_customer_read on public.appointment_services for select
  using (appointment_id in (select id from public.appointments where customer_id in (select public.my_customer_ids())));

-- ---------------------------------------------------------------------------
-- Invoices & payments: created only through create_invoice(); stylists can't see billing
-- ---------------------------------------------------------------------------
create policy invoices_read on public.invoices for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}') or customer_id in (select public.my_customer_ids()));
create policy invoice_items_read on public.invoice_items for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}')
         or invoice_id in (select id from public.invoices where customer_id in (select public.my_customer_ids())));
create policy payments_read on public.payments for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}'));

-- ---------------------------------------------------------------------------
-- WhatsApp inbox: front desk and above
-- ---------------------------------------------------------------------------
create policy wa_conv_read on public.wa_conversations for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}'));
create policy wa_conv_update on public.wa_conversations for update
  using (public.has_role(salon_id, '{owner,manager,receptionist}'))
  with check (public.has_role(salon_id, '{owner,manager,receptionist}'));
-- Staff may pause/resume the assistant and clear unread/attention flags; routing fields (number, client, the 24h
-- window, the assistant's pending confirmation) are written only by the server.
create or replace function public.guard_wa_conversations() returns trigger
language plpgsql as $$
begin
  if not public.is_trusted_writer() and (
       new.salon_id is distinct from old.salon_id or new.wa_id is distinct from old.wa_id
    or new.customer_id is distinct from old.customer_id or new.state is distinct from old.state
    or new.last_inbound_at is distinct from old.last_inbound_at) then
    raise exception 'These chat details are managed by the WhatsApp assistant';
  end if;
  return new;
end $$;
create trigger wa_conv_guard before update on public.wa_conversations for each row execute function public.guard_wa_conversations();
create policy wa_msg_read on public.wa_messages for select
  using (public.has_role(salon_id, '{owner,manager,receptionist}'));

-- ---------------------------------------------------------------------------
-- Realtime: the calendar and inbox update live
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.appointments, public.wa_messages, public.wa_conversations;
  end if;
end $$;
