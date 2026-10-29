# Deploying Styile (Supabase + Cloudflare)

Time needed: about an hour for the first deploy, plus Meta's review time for WhatsApp.

## 1. Supabase

1. Create a project — region **Mumbai (ap-south-1)** keeps data in India and latency low.
2. Apply the database: either
   * `npx supabase link --project-ref <ref>` then `npx supabase db push` (runs `supabase/migrations/*` in order), or
   * paste every file in `supabase/migrations` into the **SQL editor**, one after another in number order — currently `0001_schema.sql` through `0015_locale.sql` (15 files). Skipping one breaks the files after it. When a later pull request adds a new migration file, run just that new file the same way (or `npx supabase db push` again).
3. **Authentication → URL configuration**: Site URL `https://styile.com`; add both `https://styile.com/**` and `https://*.styile.com/**` to redirect URLs (salon sites live on subdomains).
4. **Authentication → Providers**:
   * **Email**: on (owners and staff sign in with email + password). Keep "Confirm email" on.
   * **Phone**: on (customers sign in with a code). No SMS provider is needed because of the hook below. Keep "Enable phone confirmations" on: a client's bookings and bills are linked to whoever proves they own the number.
5. **Authentication → Hooks → Send SMS hook**: type *HTTPS*, URL `https://YOUR-DOMAIN/api/auth/sms-hook`. Generate the secret and copy it (starts with `v1,whsec_`) → `SUPABASE_SMS_HOOK_SECRET`. Login codes are then delivered on WhatsApp from your platform number — no DLT/SMS registration.
6. **Project settings → API**: copy the URL, `anon` key and `service_role` key.
7. After you sign up in the app yourself, make yourself the platform admin:
   ```sql
   update public.profiles set is_platform_admin = true where email = 'you@yourcompany.in';
   ```
8. After the app is live, schedule WhatsApp reminders: enable the `pg_cron` and `pg_net` extensions and run `supabase/schedules.sql` with your domain and `CRON_SECRET` filled in.

## 2. Cloudflare (Workers, via OpenNext)

The app is a standard Next.js app built for Workers with `@opennextjs/cloudflare` (`wrangler.jsonc` and `open-next.config.ts` are included).

**From GitHub (recommended):** Workers & Pages → Create → Import a repository → pick the repo.
* Build command: `npx opennextjs-cloudflare build`
* Deploy command: `npx opennextjs-cloudflare deploy`
* Build variables (needed at build time): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` (`https://styile.com`), `NEXT_PUBLIC_ROOT_DOMAIN` (`styile.com`), `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SUPPORT_EMAIL`.

With this setup, every pull request you merge into `main` is built and deployed automatically. Every pull request also gets a "Build check" comment from GitHub; only merge when it says passed ✅.

**From your laptop:** `npm install`, `npx wrangler login`, `npm run deploy`.

Then add **secrets** (Worker → Settings → Variables and secrets, or `npx wrangler secret put NAME`):

| Name | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API settings (also needed at runtime) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API settings — keep secret |
| `NEXT_PUBLIC_APP_URL` | `https://styile.com` |
| `NEXT_PUBLIC_ROOT_DOMAIN` | `styile.com` — turns on salon addresses like `glowstudio.styile.com` |
| `CRON_SECRET` | any long random string (same as in `schedules.sql`) |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PLATFORM_PHONE_NUMBER_ID` | see `docs/WHATSAPP.md` |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `SUPABASE_SMS_HOOK_SECRET` | Supabase auth hook (step 1.5) |

**Domain and salon addresses (styile.com):**

1. Add `styile.com` to Cloudflare (Websites → Add a site) and point your registrar's nameservers to Cloudflare.
2. DNS → add a record for every salon at once: type `AAAA`, name `*`, content `100::`, **Proxied** (orange cloud). Cloudflare's free Universal SSL covers `*.styile.com`.
3. `wrangler.jsonc` already routes `styile.com` (custom domain) and `*.styile.com/*` to the Worker, so `npm run deploy` attaches both. (From the dashboard: Worker → Settings → Domains & Routes.)
4. Optional: a Redirect Rule from `www.styile.com/*` to `https://styile.com/$1`.

A new salon's address works the moment the owner finishes sign-up — nothing to set up per salon. Old `styile.com/s/<salon>` links redirect to the salon's address.

**How addresses behave**

| Address | Shows |
|---|---|
| `styile.com` | Your website, salon sign-up, `/admin` |
| `glowstudio.styile.com` | Glow Studio's booking page |
| `glowstudio.styile.com/me` | A client's bookings, bills and coins at Glow Studio only |
| `glowstudio.styile.com/app` | Staff app, locked to Glow Studio |
| `styile.com/b/<bill id>` | Short bill link used in WhatsApp; forwards to the salon's site |

One login works on every address (the session cookie is set for `.styile.com`), so a client who visits two Styile salons signs in once, but each salon's site only ever shows that salon.

## 3. WhatsApp and Claude

Follow `docs/WHATSAPP.md` (Meta app, webhook, templates, connecting each salon's number). Add an Anthropic API key with billing enabled. The model is set by `ANTHROPIC_MODEL` (default `claude-haiku-5-5`, fast and inexpensive; use a larger model if you want richer conversations).

## 4. Check it works

1. `npm test` (logic, assistant flows, signatures) and `npm run db:test` (needs a local Postgres 16: schema + security rules).
2. Sign up at `styile.com/signup`, create a salon at `/onboarding`, add a stylist, then book from `<your-slug>.styile.com` on your phone.
3. In `/admin`, connect a WhatsApp number to the salon, then message it: "Hi, can I book a haircut tomorrow at 5?"

## Local development

```bash
cp .env.example .env.local   # fill in Supabase values (a separate dev project is best)
npm install
npm run dev                  # http://localhost:3000
```
To receive WhatsApp webhooks locally, expose port 3000 with `cloudflared tunnel --url http://localhost:3000` and use that URL in Meta.
