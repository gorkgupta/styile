# Translations: English, हिन्दी, नेपाली, বাংলা

Styile's first market is Jaigaon (Alipurduar district, West Bengal), where people at the front desk and the
clients they serve often read Bengali, Nepali or Hindi more easily than English. The front desk screens and the
clients' pages can show in any of the four languages. **English is the default and the source of every string.**

> **Before launch:** a native speaker in Jaigaon must review all three languages on a real phone. The translations
> were written carefully but without a native reviewer. Start with the screens in "What to review first" below.

## How it works

```
src/lib/i18n/
  locales.ts   en | hi | ne | bn, their names in their own script, the styile_lang cookie, pickSiteLocale()
  en.ts        English: every key and its text. This file defines the key type (MessageKey).
  hi.ts ne.ts bn.ts   Partial<…> of English — a key left out shows in English
  core.ts      createT(locale, messages) → t(key, vars); t.err(serverMessage); relDay(), fmtDurationT()
  format.ts    translated versions of small helpers (coins, sessions, countdowns, "3 weeks ago" …)
  react.tsx    'use client': <I18nProvider>, useT(), useSetLocale(), rich()
  server.ts    server only: getT(locale) for server components/actions, getMessages(), siteLocale()
  root.tsx     <I18nRoot locale> — wraps a page in its language and sets <html lang> before first paint
```

* **Staff** see the app in their own language: `profiles.locale` (migration 0015), chosen from the sidebar footer
  (on phones: the strip under every page). `src/app/app/layout.tsx` wraps the app in `<I18nRoot locale={ctx.locale}>`.
* **Clients** see a salon's site (booking page, `/me`, bills, receipts) in `?lang=`, else the `styile_lang` cookie
  (set by the switcher in the page header), else the salon's language for clients (`salons.default_locale`,
  Settings → Online booking → Language for clients).
* **Bundle**: English is bundled in the client (it is the fallback). The other languages never reach the JS bundle:
  the server passes the active language's dictionary to `<I18nProvider>` as data, so a page only carries the language
  it shows (≈17 KB gzipped per language; English adds ≈13 KB gzipped to the client bundle).
* **Dates and numbers**: money and every number stay in Indian format with Latin digits (₹1,24,500; 28). Weekday and
  month names come from a small built-in table in `lib/time.ts` for hi/ne/bn (Chrome has no Nepali date data, and a
  server/browser difference would break React hydration). Times are always "5:30 PM".
* **Server messages**: actions still return English. `t.err(message)` shows the translation when the English text
  matches an `err.*` key, else the English message — so add an `err.*` key when a client- or desk-facing action error
  should be translated.

## Adding or changing a string

1. Add the key and English text to `en.ts` in the right section (`area.name`; keep keys stable — renaming one loses
   its translations).
2. In the component: `const t = useT();` then `t('area.name', { name })`. Put React nodes inside a sentence with
   `rich(t('key'), { money: <span className="num">…</span> })` so translators control word order.
3. Add the same key to `hi.ts`, `ne.ts`, `bn.ts`. If you can't translate it well, leave it out — it shows in English
   and the coverage report lists it.
4. Run `tsx --test tests/i18n.test.ts`: it checks that every translation uses only English keys and **the same
   `{placeholders}`**, has no empty strings and no Devanagari/Bengali digits, and prints coverage per language.

Plurals: `{ one: '{count} service', other: '{count} services' }` with `t(key, { count })`, chosen by
`Intl.PluralRules` for the language. Hindi, Nepali and Bengali usually don't change the noun, so a plain string
(`'{count} सर्विस'`) is fine. Changing English text: also check whether the meaning changed for the translations.

Don't translate: data the salon typed (service names, categories, stylist names, tags, expense categories, notes),
statutory GST wording (Tax Invoice, Bill of Supply, the composition declaration, GSTIN, HSN/SAC, CGST/SGST/IGST, Place
of supply) or the printed A4/thermal bill.

## Tone guide

Everyday salon-counter language, the way the receptionist would say it — **not** literal, Sanskritised or
government-form style. Short: buttons must fit at 390 px. Polite to clients (आप / तपाईं / আপনি), plain on staff screens.

| English | हिन्दी | नेपाली | বাংলা |
|---|---|---|---|
| Client | क्लाइंट | ग्राहक | কাস্টমার |
| Service / Stylist | सर्विस / स्टाइलिस्ट | सर्भिस / स्टाइलिस्ट | সার্ভিস / স্টাইলিস্ট |
| Bill / Receipt | बिल / रसीद | बिल / रसिद | বিল / রসিদ |
| Cash / Coins | कैश / कॉइन | क्यास / कोइन | ক্যাশ / কয়েন |
| Discount | डिस्काउंट (offers: छूट) | छुट | ছাড় |
| Due / Total | बाकी / कुल | बाँकी / जम्मा | বাকি / মোট |
| Cancel | कैंसिल करें | रद्द गर्नुहोस् | বাতিল করুন |
| Confirm booking | बुकिंग कन्फ़र्म करें | बुकिङ पक्का गर्नुहोस् | বুকিং কনফার্ম করুন |
| Walk-in / queue | वॉक-इन / लाइन | वाक-इन / लाइन | ওয়াক-ইন / লাইন |
| Day close | दिन का हिसाब | दिनको हिसाब | দিনের হিসাব |
| Check out (make the bill) | बिल बनाएँ | बिल बनाउनुहोस् | বিল করুন |
| Advance / Package | एडवांस / पैकेज | एडभान्स / प्याकेज | অ্যাডভান্স / প্যাকেজ |

Kept in Latin script everywhere: UPI, GST, GSTIN, HSN, WhatsApp, OTP, Nu, VIP, ₹ amounts, AM/PM.
Hindi and Bengali end sentences with "।". Nepali uses Nepali words (छ, छैन, भयो, गर्नुहोस्), not Hindi ones.

## What to review first (native speaker, on a phone)

1. **Booking page** (`/s/<salon>?lang=bn|ne|hi`): every step, the WhatsApp-code step and its errors, the
   "You're booked" screen, "Sorry, someone just booked that time".
2. **Client bookings page** (`/me`): greeting, coins card, change time / cancel dialogs, past visits, bills.
3. **Client bill** and the **advance / package / coins receipts** (money words: advance, balance, handed back).
4. **New bill (POS)** with payment: split payment, coins, UPI QR text, "Save bill", the errors.
5. **Day close**: the cash words (opening cash, expected in the drawer, short/excess, taken out, left for tomorrow).
6. **Today, Calendar, Walk-ins, appointment sheet**: status badges (Booked, Arrived, In chair, No-show).
7. **Bills list / bill page, Clients list / profile**.

Questions for the reviewer: Bengali "কাস্টমার" vs "ক্লায়েন্ট", and "সেলুন" vs "পার্লার" for the business; Hindi
"क्लाइंट" vs "कस्टमर"; Nepali "ग्राहक"; whether "हिसाब" reads right for day close; greetings on Today.

## Not translated yet (follow-ups)

* Staff screens: Settings, Reports, Team, Services, Packages & memberships menu, Expenses (and the expense sheet on
  Day close), Bridal & events, WhatsApp inbox, Admin, sign-up/login, landing page. On the client profile: the
  membership panel and the sell coins / sell package / adjust coins sheets. Their navigation labels are translated.
* The printed A4 invoice and thermal receipt stay English (GST document). Bilingual printing is a possible follow-up.
* Outgoing WhatsApp notifications (confirmations, reminders, bill links, OTP message) stay English. The WhatsApp
  assistant already answers in the client's language.
* Server action messages that aren't in `err.*`, and page `<title>`s (except the booking page).
* `amountInWords` ("Rupees … Only") stays English.
