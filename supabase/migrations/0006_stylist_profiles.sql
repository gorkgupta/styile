-- Styile — stylist profiles for "choose your stylist".
-- Clients pick a stylist on the booking page and in WhatsApp; this gives each stylist a public face (photo, short bio,
-- specialties, experience), lets the owner keep someone off the client-facing choice while the front desk can still
-- book them, and works out a client's usual stylist so returning clients get them pre-selected.

-- ---------------------------------------------------------------------------
-- Public profile fields on staff
-- ---------------------------------------------------------------------------
-- Check constraints can't hold subqueries, so the per-item rule for specialties lives in an immutable helper.
create or replace function public.valid_specialties(p text[]) returns boolean
language sql immutable as $$
  select p is not null
     and coalesce(cardinality(p), 0) <= 8
     and not exists (select 1 from unnest(p) x where x is null or char_length(btrim(x)) = 0 or char_length(x) > 30);
$$;

alter table public.staff
  add column photo_url text,
  add column bio text,
  add column specialties text[] not null default '{}',
  add column years_experience smallint,
  add column show_on_booking boolean not null default true;

alter table public.staff
  -- Shown to the public in <img src>: only plain https URLs (the app only saves our own storage bucket's URLs).
  add constraint staff_photo_url_https check (photo_url is null or photo_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[A-Za-z0-9._~/%+-]*$'),
  add constraint staff_bio_length check (bio is null or char_length(bio) <= 280),
  add constraint staff_specialties_valid check (public.valid_specialties(specialties)),
  add constraint staff_years_experience_range check (years_experience is null or years_experience between 0 and 60);

comment on column public.staff.show_on_booking is
  'false = not offered to clients online (booking page, WhatsApp); the front desk can still book them';

-- ---------------------------------------------------------------------------
-- A client's usual stylist: most completed visits in the last 12 months, ties go to the most recent.
-- Only current team members count (someone who left can't be pre-selected).
-- Callable by members of the salon, by the client themselves, and by the server (service role: booking page, WhatsApp).
-- ---------------------------------------------------------------------------
create or replace function public.usual_stylist(p_salon uuid, p_customer uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  if not (public.is_member(p_salon) or public.is_trusted_writer()
          or p_customer in (select public.my_customer_ids())) then
    raise exception 'Only this salon''s team can look up a client''s stylist';
  end if;
  select a.staff_id into v
    from public.appointments a
    join public.staff s on s.id = a.staff_id and s.salon_id = p_salon and s.active
   where a.salon_id = p_salon
     and a.customer_id = p_customer
     and a.status = 'completed'
     and a.start_at >= now() - interval '12 months'
   group by a.staff_id
   order by count(*) desc, max(a.start_at) desc
   limit 1;
  return v;
end $$;

revoke all on function public.usual_stylist(uuid, uuid) from public, anon;
grant execute on function public.usual_stylist(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Photos: Supabase Storage bucket "staff-photos" (public read via public URLs).
-- Objects live under "<salon_id>/…"; only that salon's owner or manager can add, replace or remove them.
-- Plain Postgres (scripts/db-test) has no storage schema, so this part only runs on Supabase.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('staff-photos', 'staff-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute 'drop policy if exists staff_photos_read on storage.objects';
    execute 'drop policy if exists staff_photos_insert on storage.objects';
    execute 'drop policy if exists staff_photos_update on storage.objects';
    execute 'drop policy if exists staff_photos_delete on storage.objects';

    -- Upserts need to see the existing object; the public bucket serves photos to everyone else by URL.
    execute $p$create policy staff_photos_read on storage.objects for select to authenticated
      using (bucket_id = 'staff-photos' and exists (
        select 1 from public.salons s
         where s.id::text = (storage.foldername(objects.name))[1] and public.has_role(s.id, '{owner,manager}')))$p$;
    execute $p$create policy staff_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'staff-photos' and exists (
        select 1 from public.salons s
         where s.id::text = (storage.foldername(objects.name))[1] and public.has_role(s.id, '{owner,manager}')))$p$;
    execute $p$create policy staff_photos_update on storage.objects for update to authenticated
      using (bucket_id = 'staff-photos' and exists (
        select 1 from public.salons s
         where s.id::text = (storage.foldername(objects.name))[1] and public.has_role(s.id, '{owner,manager}')))
      with check (bucket_id = 'staff-photos' and exists (
        select 1 from public.salons s
         where s.id::text = (storage.foldername(objects.name))[1] and public.has_role(s.id, '{owner,manager}')))$p$;
    execute $p$create policy staff_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'staff-photos' and exists (
        select 1 from public.salons s
         where s.id::text = (storage.foldername(objects.name))[1] and public.has_role(s.id, '{owner,manager}')))$p$;
  end if;
end $$;
