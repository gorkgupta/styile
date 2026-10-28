-- Styile — payment types for the Bhutan border (Jaigaon).
--   cash_nu     "Cash (Nu)"     Bhutanese Ngultrum notes, accepted at par with the rupee in Jaigaon.
--   upi_bhutan  "UPI (Bhutan)"  a Bhutanese bank app paying the salon's Indian UPI QR (cross-border UPI, Phase II,
--                               Sep 2026; limits ₹10,000 a payment, ₹25,000 a day, ₹50,000 a year per payer).
-- Both are recorded like any other payment: the money goes straight to the salon, Styile never holds it, and the
-- bill stays in rupees with no surcharge.
--
-- ALTER TYPE … ADD VALUE: a new enum value can't be used in the transaction that adds it, so this file only adds
-- them. The salon settings that mention them are in a later migration.
alter type public.pay_method add value if not exists 'cash_nu';
alter type public.pay_method add value if not exists 'upi_bhutan';
