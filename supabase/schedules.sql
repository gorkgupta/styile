-- Run once in the Supabase SQL editor AFTER the app is deployed (replace the two placeholders).
-- Calls the reminder endpoint every 15 minutes using pg_cron + pg_net (both available on Supabase).
-- 1. Database > Extensions: enable "pg_cron" and "pg_net".
-- 2. Replace https://YOUR-APP-DOMAIN and YOUR_CRON_SECRET (same value as the CRON_SECRET secret on Cloudflare).

select cron.schedule(
  'styile-whatsapp-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-APP-DOMAIN/api/cron/reminders',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);

-- To stop it later:  select cron.unschedule('styile-whatsapp-reminders');
