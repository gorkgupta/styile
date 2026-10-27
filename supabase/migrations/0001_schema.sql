-- Styile salon platform — core schema
-- Multi-tenant: every business row carries salon_id; isolation is enforced by RLS (0002_security.sql).

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'manager', 'receptionist', 'stylist');
create type public.appt_status as enum ('waiting', 'booked', 'confirmed', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show');
create type public.booking_source as enum ('walk_in', 'phone', 'online', 'whatsapp', 'staff');
create type public.pay_method as enum ('cash', 'upi', 'card', 'wallet', 'other');
create type public.invoice_status as enum ('paid', 'partial', 'unpaid', 'void');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  email text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Salons (tenants) and branches
-- ---------------------------------------------------------------------------
create table public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 1),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  legal_name text,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  phone text,
  email text,
  address text,
  city text,
  state text,
  pincode text,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  brand_color text not null default '#0F5257' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url text,
  -- Billing
  prices_include_tax boolean not null default true,
  default_gst_rate numeric(5,2) not null default 18 check (default_gst_rate >= 0 and default_gst_rate <= 28),
  invoice_prefix text not null default 'INV',
  next_invoice_no integer not null default 1,
  -- Online booking
  booking_enabled boolean not null default true,
  slot_interval_min integer not null default 15 check (slot_interval_min in (5, 10, 15, 20, 30, 60)),
  booking_lead_min integer not null default 60 check (booking_lead_min >= 0),
  booking_window_days integer not null default 30 check (booking_window_days between 1 and 180),
  -- SaaS subscription (managed by the platform admin)
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'growth', 'pro')),
  plan_status text not null default 'trialing' check (plan_status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  -- WhatsApp (each salon has its own number on the WhatsApp Cloud API)
  wa_phone_number_id text unique,
  wa_business_account_id text,
  wa_display_number text,
  wa_bot_enabled boolean not null default true,
  wa_bot_instructions text,
  created_at timestamptz not null default now()
);

-- Secrets live in their own table with RLS enabled and no policies: only the service role can read them.
create table public.salon_secrets (
  salon_id uuid primary key references public.salons (id) on delete cascade,
  wa_access_token text,
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  name text not null,
  address text,
  phone text,
  is_default boolean not null default false,
  -- {"mon": [["10:00","20:00"]], "tue": [...], ... }  empty array = closed
  business_hours jsonb not null default '{"mon":[["10:00","20:00"]],"tue":[["10:00","20:00"]],"wed":[["10:00","20:00"]],"thu":[["10:00","20:00"]],"fri":[["10:00","20:00"]],"sat":[["10:00","21:00"]],"sun":[["10:00","21:00"]]}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index branches_one_default on public.branches (salon_id) where is_default;
create index on public.branches (salon_id);

-- ---------------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------------
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  phone text,
  title text,
  color text not null default '#0F5257',
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  working_hours jsonb, -- same shape as branches.business_hours; null = follow branch hours
  bookable boolean not null default true,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.staff (salon_id);

create table public.salon_members (
  salon_id uuid not null references public.salons (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  staff_id uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (salon_id, user_id)
);
create index on public.salon_members (user_id);

-- ---------------------------------------------------------------------------
-- Service menu
-- ---------------------------------------------------------------------------
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  name text not null,
  sort integer not null default 0
);
create index on public.service_categories (salon_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  category_id uuid references public.service_categories (id) on delete set null,
  name text not null,
  description text,
  duration_min integer not null check (duration_min between 5 and 600),
  price numeric(10,2) not null check (price >= 0),
  gst_rate numeric(5,2) check (gst_rate is null or (gst_rate >= 0 and gst_rate <= 28)),
  gender text not null default 'unisex' check (gender in ('unisex', 'female', 'male')),
  online_bookable boolean not null default true,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.services (salon_id);

-- If a staff member has no rows here, they can perform every service.
create table public.staff_services (
  staff_id uuid not null references public.staff (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  primary key (staff_id, service_id)
);

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  name text not null,
  phone text not null check (phone ~ '^[0-9]{10,15}$'), -- digits with country code, e.g. 919876543210
  email text,
  gender text check (gender is null or gender in ('female', 'male', 'other')),
  birthday date,
  notes text,
  tags text[] not null default '{}',
  user_id uuid references auth.users (id) on delete set null,
  marketing_opt_in boolean not null default true,
  visit_count integer not null default 0,
  total_spent numeric(12,2) not null default 0,
  last_visit_at timestamptz,
  created_at timestamptz not null default now(),
  unique (salon_id, phone)
);
create index on public.customers (salon_id, name);
create index on public.customers (user_id);

-- ---------------------------------------------------------------------------
-- Appointments and walk-in queue
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  customer_id uuid not null references public.customers (id) on delete restrict,
  staff_id uuid references public.staff (id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.appt_status not null default 'booked',
  source public.booking_source not null default 'staff',
  token_no integer, -- walk-in queue number for the day
  notes text,
  cancelled_reason text,
  invoice_id uuid,
  reminder_24h_sent_at timestamptz,
  reminder_2h_sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  -- A stylist can never be double-booked, whatever path the booking came from (app, web, WhatsApp).
  constraint appointments_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (staff_id is not null and status not in ('waiting', 'cancelled', 'no_show'))
);
create index on public.appointments (salon_id, start_at);
create index on public.appointments (customer_id);
create index on public.appointments (staff_id, start_at);

create table public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  name text not null,
  price numeric(10,2) not null,
  duration_min integer not null,
  sort integer not null default 0
);
create index on public.appointment_services (appointment_id);

-- ---------------------------------------------------------------------------
-- Billing (GST invoices) and payments
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  invoice_no text not null,
  customer_id uuid references public.customers (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  prices_include_tax boolean not null,
  subtotal numeric(12,2) not null,       -- sum of qty * unit_price
  discount_total numeric(12,2) not null, -- sum of line discounts
  taxable_total numeric(12,2) not null,
  cgst numeric(12,2) not null,
  sgst numeric(12,2) not null,
  igst numeric(12,2) not null default 0,
  round_off numeric(6,2) not null default 0,
  total numeric(12,2) not null,
  paid_total numeric(12,2) not null default 0,
  status public.invoice_status not null,
  notes text,
  void_reason text,
  voided_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (salon_id, invoice_no)
);
create index on public.invoices (salon_id, created_at);
create index on public.invoices (customer_id);
alter table public.appointments
  add constraint appointments_invoice_fk foreign key (invoice_id) references public.invoices (id) on delete set null;

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  kind text not null check (kind in ('service', 'product', 'custom')),
  service_id uuid references public.services (id) on delete set null,
  staff_id uuid references public.staff (id) on delete set null,
  name text not null,
  qty numeric(10,2) not null check (qty > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  gst_rate numeric(5,2) not null,
  taxable numeric(12,2) not null,
  tax numeric(12,2) not null,
  line_total numeric(12,2) not null,
  sort integer not null default 0
);
create index on public.invoice_items (invoice_id);
create index on public.invoice_items (salon_id, staff_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  method public.pay_method not null,
  amount numeric(12,2) not null check (amount > 0),
  reference text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.payments (invoice_id);

-- ---------------------------------------------------------------------------
-- WhatsApp conversations
-- ---------------------------------------------------------------------------
create table public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  wa_id text not null, -- customer's WhatsApp number (digits)
  profile_name text,
  bot_paused boolean not null default false, -- true after a hand-off to a person
  needs_attention boolean not null default false,
  state jsonb not null default '{}'::jsonb,   -- pending confirmations for the bot
  last_inbound_at timestamptz,
  last_message_at timestamptz not null default now(),
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (salon_id, wa_id)
);
create index on public.wa_conversations (salon_id, last_message_at desc);

create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('customer', 'bot', 'staff', 'system')),
  kind text not null default 'text',
  body text,
  payload jsonb,
  wa_message_id text unique,
  status text,
  created_at timestamptz not null default now()
);
create index on public.wa_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();

-- Create a profile row whenever someone signs up (email or phone).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.phone,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email/phone equal to the login's (team invites find existing accounts by profile email).
create or replace function public.handle_user_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email or new.phone is distinct from old.phone then
    perform set_config('styile.internal', 'on', true);
    update public.profiles set email = new.email, phone = new.phone where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_updated after update of email, phone on auth.users
  for each row execute function public.handle_user_updated();
