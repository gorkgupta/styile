-- Languages: Hindi, Nepali and Bengali next to English (src/lib/i18n).
--
-- profiles.locale        the language a staff member sees the app in (null = English). Each user sets only their own:
--                        the profiles_self_update policy (0002) limits updates to id = auth.uid(), and guard_profiles
--                        only protects the admin flag, email and phone, so the user's own locale is writable.
-- salons.default_locale  the language of the salon's client pages (booking page, /me, bills and receipts). Clients can
--                        switch with ?lang= or the switcher in the header (remembered in the styile_lang cookie).
--                        Only owners can change it (salons_owner_update).

alter table public.profiles
  add column locale text check (locale in ('en', 'hi', 'ne', 'bn'));

alter table public.salons
  add column default_locale text not null default 'en' check (default_locale in ('en', 'hi', 'ne', 'bn'));

comment on column public.profiles.locale is 'App language for this user: en, hi, ne or bn (null = English).';
comment on column public.salons.default_locale is 'Language of the salon''s client pages: en, hi, ne or bn.';
