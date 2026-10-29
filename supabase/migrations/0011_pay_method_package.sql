-- Styile — a payment type for package sessions.
--   package  "Package"  a service taken from a package the client bought earlier (0012). The money came in when the
--                       package was sold (a package receipt, not a tax invoice), so on the bill this is not money
--                       received today — like coins ('wallet').
--
-- ALTER TYPE … ADD VALUE: a new enum value can't be used in the transaction that adds it, so this file only adds it.
-- Everything that uses it is in 0012_packages_memberships.sql.
alter type public.pay_method add value if not exists 'package';
