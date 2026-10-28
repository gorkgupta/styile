# Styile codebase conventions

Styile is a multi-tenant salon management SaaS for India: Next.js 15 (App Router, React 19, TypeScript strict) on Cloudflare Workers via OpenNext, Supabase (Postgres + Auth + Realtime) as the backend, WhatsApp Cloud API + Claude for the booking assistant.

## Layout

```
supabase/migrations/   schema (0001), row level security (0002), RPC functions (0003), salon addresses (0004), coins (0005), stylist profiles (0006), GST modes (0007), payment types (0008), day close (0009), receipts & UPI (0010),
                       packages & memberships (0011 adds the 'package' payment type, 0012 the rest),
                       bridal & event bookings with advances (0013 adds the 'advance' payment type, 0014 the rest),
                       languages (0015: profiles.locale, salons.default_locale)
src/app/               routes. /app/* = salon dashboard, /s/[slug] = salon site (booking page; /s/[slug]/me = client portal), /admin = platform console.
                       In production the middleware serves /s/<slug>/* at <slug>.styile.com/* (see src/lib/tenant.ts); link with
                       salonUrl(slug, path) from '@/lib/tenant', or with the `base` prop inside salon-site pages — never hardcode /s/ or /me.
src/actions/           'use server' modules — every mutation goes through one of these
src/components/ui/     primitives: ui.tsx (Button, TextField, SelectField, TextArea, Switch, SearchInput, Badge, StatusBadge, Avatar,
                       Panel, Stat, Empty, Notice, Segmented, Sheet, Dialog, ToastProvider/useToast, SubmitButton), icons.tsx (<Icon name=…/>)
src/components/app/    dashboard screens. shell.tsx has AppShell + <Topbar title subtitle actions back/>
src/lib/               types.ts (row types + labels), time.ts (time zones/formatting), billing.ts (computeBill, money, amountInWords), packages.ts (packages & membership cards), events.ts (bridal & event bookings, advances), gst.ts (GST modes, bill types, rates, states), upi.ts (UPI QR payload), qr.ts (vendored QR encoder, MIT),
                       i18n/ (languages: en.ts strings, hi/ne/bn translations, useT/getT — see docs/TRANSLATIONS.md),
                       availability.ts (slot engine), booking.ts (server booking service), coins.ts (coin packs/formatting), phone.ts, permissions.ts (can(role, perm)),
                       context.ts (getSalonContext/requirePermission), queries.ts, actions.ts (fail/must/errorMessage),
                       supabase/{server,client,admin}.ts, whatsapp/{cloud-api,outbox}.ts, env.ts
preview/               static preview harness with sample data (see below)
tests/                 node:test unit tests (npm test)
scripts/db-test/       runs migrations + RLS/billing tests on a throwaway Postgres
```

## Page pattern

Each route's `page.tsx` is a **server component** that loads data and renders one **client screen component** from `src/components/...`, passing plain data props:

```tsx
// src/app/app/customers/page.tsx
export const metadata = { title: 'Clients' };
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePermission('viewClients');          // redirects if the role can't see this
  const { data } = await ctx.supabase.from('customers').select('*').eq('salon_id', ctx.salon.id).limit(200);
  return <ClientsScreen clients={data ?? []} tz={ctx.salon.timezone} canDelete={can(ctx.role, 'deleteClients')} />;
}
```

* `ctx.supabase` acts as the signed-in user — RLS applies. Always also filter `.eq('salon_id', ctx.salon.id)` (a user can belong to several salons).
* Next 15: `params` and `searchParams` are Promises — `await` them.
* Screen components start with `'use client'`, render `<Topbar …/>` first, then `<div className="page">…</div>`.
* Screens never import server-only modules (`@/lib/context`, `@/lib/supabase/server|admin`, `@/lib/booking`, `@/lib/queries`, `@/lib/whatsapp/*`).

## Server actions

* Live in `src/actions/<area>.ts`, start with `'use server'`, export **only `async function`s** (types may be exported with `export interface/type`).
* Signature returns `Promise<ActionResult<T>>` (`{ ok: true, data?, message? } | { ok: false, error }`). Never throw to the client: `try { … } catch (e) { return fail(e); }`.
* Get the user's salon with `await getSalonContext()`; check permissions with `can(ctx.role, '…')` before writing (the DB enforces it too).
* Validate input (normalise phones with `normalizePhone` — any country, India by default; say what's wrong with `invalidPhoneMessage` — dates with `isValidDateStr`). Clients and salons type phones in `<PhoneInput>` (`@/components/ui/phone-input`: country code select + number); never hard-code a "+91" prefix. Write user-facing error text that says what to do.
* After writes call `revalidatePath('/app', 'layout')` (or a narrower path).
* Use `createAdminClient()` (service role, bypasses RLS) **only** for public/WhatsApp/platform-admin paths, and only after your own checks.
* Client components call actions directly: `const r = await saveCustomer(input); if (!r.ok) return toast(r.error, 'error');` then `router.refresh()`.

## UI rules

* Styling: classes from `src/app/globals.css` only (no CSS framework, no inline colours except staff colours). Useful classes: `page`, `split`, `stack/stack-sm/stack-lg`, `row/row-wrap/between/grow`, `grid-2/grid-3`, `panel/panel-head/panel-body`, `list`, `table/table-wrap`, `stats/stat`, `chip` (aria-pressed), `segmented`, `badge-*`, `muted/small/tiny/strong/num/truncate/nowrap`, `hide-mobile/show-mobile`, `notice-*`.
* Colours: peacock teal (primary action), marigold (attention/now/queue), aubergine ink text. Money and times use `className="num"` (tabular figures). Money: `money(n)` (₹1,24,500). Dates/times: helpers in `lib/time.ts` with the salon `tz` — never `toLocaleString()` without a timeZone.
* Copy: plain, sentence case, Indian English, the user's words ("Clients", "Bills", "Stylist", "Walk-in"). Buttons say what happens ("Save client", "Record payment"). Errors say how to fix. Empty states invite the next action.
* Languages: on translated screens (client pages and front desk; see docs/TRANSLATIONS.md) text goes through `const t = useT(); t('area.key', vars)` with the English in `src/lib/i18n/en.ts` — no new hard-coded strings there. Dates with words take the language: `fmtDateLong(d, t.locale)`. Keep digits Latin. Server components/actions use `getT(locale)`.
* Mobile first-class: everything must work at 390px wide (front desks use phones/tablets). Tables get a `table-wrap` or turn into lists on mobile.
* Accessibility: real `<button>`/`<a>`, labels on inputs (TextField/SelectField do this), `aria-pressed` on toggles, visible focus is global.
* No new npm dependencies.

## Preview harness (how to see your screens)

`node preview/build.mjs` bundles `preview/main.tsx` into `preview/dist/` with esbuild; `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node preview/shot.mjs /app/route [--mobile] [--full]` saves PNGs to `preview/shots/` and prints runtime errors. In the preview:
* `@/actions/*` are auto-replaced by mocks: register handlers by action name in `preview/mocks/<area>.ts` (unregistered actions return `{ ok: true }`).
* `next/link`, `next/navigation`, `@/lib/supabase/client` are shimmed.
* Register screens in `preview/screens/<area>.tsx` as `'/app/route': { title, render: () => <Screen …mock props/> }`. Routes under `/app` are wrapped in the AppShell automatically. Dynamic routes may use `[id]` in the key.
* Sample data lives in `preview/data.ts` (salon, staff, services, customers, appointments, invoices, conversations, report). Add what you need to your own screens file rather than editing shared data.

## Enum values

`ALTER TYPE … ADD VALUE` can't be used in the transaction that adds it. Put it alone in its own migration file that sorts
before the file that uses it (e.g. 0011_pay_method_package.sql, then 0012_packages_memberships.sql).
