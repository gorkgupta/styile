# Styile — salon software with a WhatsApp booking assistant

Styile runs a salon's day — calendar, walk-in queue, GST billing, clients, team, reports — and lets clients book, change or cancel by simply texting the salon's WhatsApp number. It is multi-tenant: you sell it to many salons on a monthly subscription and manage them from a platform console.

## Who logs in

Every salon gets its own address, `<salon>.styile.com`. One login (email for staff, phone for clients) works on every address, but each salon's site only shows that salon.

| Login | Where | What they can do |
|---|---|---|
| **Owner** | `glowstudio.styile.com/app` | Everything for their salon(s): settings, team access, reports, billing |
| **Manager** | `glowstudio.styile.com/app` | Day-to-day running, menu, team schedules, reports, cancel bills |
| **Front desk** (admin) | `glowstudio.styile.com/app` | Calendar, walk-ins, clients, billing, WhatsApp inbox |
| **Stylist** | `glowstudio.styile.com/app` | Their own calendar column, clients |
| **Client** | `glowstudio.styile.com/me` (code on WhatsApp) | Book, see upcoming visits, change/cancel, bills — at that salon only |
| **Platform admin** (you) | `styile.com/admin` | All salons, plans and status, connect WhatsApp numbers |

The same rules are enforced twice: in the interface (`src/lib/permissions.ts`) and in the database with row-level security (`supabase/migrations/0002_security.sql`), so one salon can never read another's data even if the app had a bug.

## What's in Phase 1

* **Today** — revenue, appointments, queue, chair status, setup checklist.
* **Calendar** — stylist columns, colour-coded blocks, click a gap to book, move/cancel/no-show, live updates when WhatsApp bookings arrive; double booking is impossible (database exclusion constraint).
* **Walk-ins** — token numbers, waiting times, start with whoever is free.
* **Billing** — GST invoices (inclusive or exclusive pricing, CGST/SGST, round-off, amount in words, SAC 999721), split payments (cash/UPI/card), partial payments, cancellation with reason, bill on WhatsApp.
* **Clients** — history, notes (colour formulas, allergies), tags, visit and spend stats.
* **Services, team, settings** — menu with durations and GST rates, staff hours/skills/commission, team logins and roles, opening hours, online booking rules.
* **Reports** — revenue by day, stylist commissions, top services, payment mix, booking sources.
* **Coins** — prepaid balance (1 coin = ₹1) sold at the desk for cash/UPI/card, with salon-defined bonus packs (pay ₹5,000 → 5,500 coins). Coins are spent as a payment method on normal GST bills, only at the salon that sold them; cancelling a bill refunds its coins. Owner adjustments with a required note, a full ledger, coins in reports, the client portal and the WhatsApp assistant. Selling coins gives a *coins receipt*, not a tax invoice — GST is charged when coins are used (confirm the GST treatment with your CA). No expiry yet.
* **Online booking page** per salon and a **client portal**.
* **WhatsApp assistant** — understands free text in English and Indian languages, checks real availability, books/reschedules/cancels with a Confirm button, answers questions, hands over to a person; staff inbox to take over; automatic confirmations, 24h/2h reminders and bills.

Planned next: memberships/packages, coin expiry and online coin top-ups (Razorpay), inventory, attendance & payroll, WhatsApp campaigns, multi-branch, in-app Embedded Signup for WhatsApp, subscription billing via Razorpay, native apps.

## Architecture

```
Browser / phone (installable web app)        Client on WhatsApp
          │                                          │
          ▼                                          ▼
  Next.js 15 on Cloudflare Workers  ◄── Meta Cloud API webhook (/api/whatsapp/webhook)
  · server components + server actions        │
  · /api/cron/reminders, /api/auth/sms-hook   └─► Claude (tool use) ─► booking service
          │
          ▼
  Supabase: Postgres (RLS per salon), Auth (email for staff, phone OTP via WhatsApp for clients), Realtime
```

* `supabase/migrations` — schema, security rules, business functions (invoice numbering and GST maths live in the database).
* `src/lib/booking.ts` + `src/lib/availability.ts` — one booking engine shared by the front desk, booking page and WhatsApp assistant.
* `src/lib/whatsapp/engine.ts` — the assistant: Claude may look things up and *propose*; nothing is written until the client confirms.
* See `docs/CONVENTIONS.md` for code layout and patterns.

## Running and testing

```bash
npm install
cp .env.example .env.local     # Supabase + keys
npm run dev
npm test                       # booking engine, GST maths, assistant conversations, webhook signatures
npm run db:test                # schema + RLS + billing on a throwaway Postgres 16
node preview/build.mjs         # static preview of every screen with sample data (preview/dist/index.html)
```

Deploying: **docs/DEPLOY.md**. WhatsApp setup and message templates: **docs/WHATSAPP.md**.
