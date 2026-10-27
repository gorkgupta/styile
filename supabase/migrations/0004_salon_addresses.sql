-- Styile: every salon gets its own address, <slug>.styile.com.
-- Reserve names that the platform needs for itself (kept in sync with RESERVED_SLUGS in src/lib/tenant.ts).

create or replace function public.is_reserved_slug(p_slug text) returns boolean
language sql immutable as $$
  select p_slug = any (array['www', 'app', 'admin', 'api', 'auth', 'mail', 'email', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'images', 'help', 'support', 'docs', 'blog', 'status', 'about', 'pricing', 'login', 'signup', 'signin', 'register', 'account', 'billing', 'dashboard', 'me', 'my', 'book', 'booking', 'styile', 'test', 'demo', 'dev', 'staging', 'beta', 'm', 'wa', 'whatsapp']);
$$;

alter table public.salons
  add constraint salons_slug_not_reserved check (not public.is_reserved_slug(slug));
