-- Styile — a payment type for advances.
--   advance  "Advance"  money the client paid earlier (a bridal or event advance, 0014) applied on the final bill.
--                       The money came in when the advance was received (an advance receipt, not a tax invoice), so on
--                       the bill this is not money received today — like coins and package sessions.
--
-- ALTER TYPE … ADD VALUE: a new enum value can't be used in the transaction that adds it, so this file only adds it.
-- Everything that uses it is in 0014_events_advances.sql.
alter type public.pay_method add value if not exists 'advance';
