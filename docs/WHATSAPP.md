# WhatsApp setup

Styile uses Meta's **WhatsApp Cloud API** directly (no BSP fee). Each salon gets its **own WhatsApp number**; one Meta app (yours, the Styile vendor) receives every salon's messages through a single webhook and routes them by `phone_number_id`.

```
Client's WhatsApp ──► Meta Cloud API ──► POST /api/whatsapp/webhook (signature checked)
                                              │  find salon by phone_number_id
                                              │  store message, mark read + typing indicator
                                              ▼
                                   Assistant (Claude + booking tools)
                                              │  check availability / propose / confirm
                                              ▼
                       Supabase (appointment row) ──► Realtime ──► salon calendar updates live
```

## 1. One-time: your Meta app (platform)

1. In **Meta Business Suite**, complete **business verification** for your company (GST certificate / incorporation documents).
2. In **Meta for Developers**, create an app of type *Business* and add the **WhatsApp** product.
3. **App secret** (App settings → Basic) → `WHATSAPP_APP_SECRET`.
4. Create a **System user** in Business settings with admin access to the app, generate a permanent token with `whatsapp_business_messaging` and `whatsapp_business_management` → `WHATSAPP_ACCESS_TOKEN`.
5. **Webhook** (WhatsApp → Configuration): callback URL `https://YOUR-DOMAIN/api/whatsapp/webhook`, verify token = any random string you also put in `WHATSAPP_VERIFY_TOKEN`. Subscribe to the **messages** field.
6. Add your own **platform number** (used only for customer login codes) → its phone number id → `WHATSAPP_PLATFORM_PHONE_NUMBER_ID`.
7. Create the **authentication template** `login_code` on the platform number (category *Authentication*, "Copy code" button). Name must match `WHATSAPP_OTP_TEMPLATE`.

## 2. Each salon's number

Two ways, both end with the platform admin pasting the IDs into **/admin → salon → Connect WhatsApp**:

**A. Embedded Signup (recommended once you have many salons).** Enrol as a Meta **Tech Provider**, then the salon owner clicks through Meta's Embedded Signup popup. Afterwards your server must (server-to-server, with the business token from the signup): exchange the code at `GET /oauth/access_token`, subscribe your app with `POST /<WABA_ID>/subscribed_apps`, and register the number with `POST /<PHONE_NUMBER_ID>/register` (6-digit PIN). The salon then adds a payment method in WhatsApp Manager — Meta bills message charges to the salon directly. *Styile Phase 1 includes the admin form to store the resulting IDs/token; the in-app Embedded Signup button is on the Phase 2 list.* Note Meta is retiring Embedded Signup v2/v3 on 15 Oct 2026 — build against **v4**.

**B. Manual (fine for the first pilot salons).** Add the salon's number under your own WhatsApp Business Account in WhatsApp Manager, verify it by SMS/voice, and copy its **Phone number ID** and **WABA ID** into /admin. Leave the token empty to use your system-user token.

Requirements for the salon's number: it must **not** be active on the WhatsApp app or WhatsApp Business app (or use Meta's coexistence onboarding), and must receive an SMS/call for verification.

## 3. Message templates (per WhatsApp Business Account)

Replies inside the 24-hour customer-service window are free-form. Outside it (reminders, confirmations for bookings made by the front desk, bills) WhatsApp requires approved templates. Create these in WhatsApp Manager → Message templates, category **Utility**, language **English**, with exactly these names and variables:

| Name | Body |
|---|---|
| `booking_confirmation` | Hi {{1}}, your appointment at {{2}} is confirmed for {{3}} with {{4}}: {{5}}. Reply to this message to change or cancel. |
| `appointment_reminder` | Hi {{1}}, a reminder about your {{2}} on {{3}} with {{4}} at {{5}}. Reply to this message if you need to change it. |
| `bill_receipt` | Hi {{1}}, thank you for visiting {{2}}! Your bill {{3}} for {{4}} is ready. — with a **URL button** "View bill" → `https://styile.com/b/{{1}}` (one link for every salon; it forwards to the bill on the salon's own address) |
| `coins_update` | Hi {{1}}, {{2}} coins have been added to your balance at {{3}}. Your balance is now {{4}} coins — use them on your next bill. ({{1}} name, {{2}} coins added, {{3}} salon, {{4}} balance) |

Optional: add Hindi (`hi`) versions with the same names.

## 4. What the assistant can do

* Understand free text in English, Hindi/Hinglish and other Indian languages ("kal 5 baje haircut milega?").
* Check real availability (opening hours, each stylist's hours and skills, existing bookings, lead time).
* Book, reschedule and cancel — **always via a Confirm button**; nothing is written until the client confirms, and the database refuses double bookings.
* Answer questions about services, prices, timings and anything the salon adds under Settings → WhatsApp → "What the assistant should know".
* Tell clients their **coin balance** at the salon and their recent coin use (`my_coins`). Coins are bought at the front desk only; the assistant can't add coins or take payments.
* Hand over to a person (complaints, refunds, bridal/group bookings, medical questions, or on request). The chat then shows **Needs reply** in the inbox and the assistant stays quiet until the team resumes it.

Voice notes and images aren't understood yet; the assistant asks the client to type.

## 5. Costs (India, from 1 Oct 2026)

Meta charges ₹0.115 per utility/service message (first 1,000 service replies a month per number are free) and ₹0.8631 per marketing message.

**Login codes to clients abroad.** Client sign-in codes go from the platform number as *Authentication* template messages. Clients can sign in with a non-Indian number (Bhutan +975 is common at border towns like Jaigaon; Nepal +977, Bangladesh +880 and any other country work too), and Meta bills authentication messages by the **recipient's country**: a code sent to a +975 number is charged at Meta's international authentication rate for Bhutan, not the Indian rate. Check Meta's current rate card (WhatsApp Manager → Insights, or Meta's pricing page) and watch the platform number's spend if many clients sign in from abroad. Salon messages (confirmations, reminders, bills) to those clients are likewise billed at the client's country rate, to the salon's WhatsApp account. Claude (default model `claude-haiku-5-5`) costs a few paise per conversation. Styile's plans include a monthly number of assistant conversations; set your price with these costs in mind.
