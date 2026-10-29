-- Styile — receipts and UPI collection.
-- * receipt_size: what the bill page prints by default: an A4 invoice or a thermal receipt (80 mm or 58 mm roll).
-- * upi_vpa / upi_payee_name: the salon's OWN UPI ID. The app shows a UPI QR (upi://pay?pa=…&am=<due>) so clients
--   pay the salon directly; Styile never collects or routes money (RBI payment-aggregator rules). Payments are still
--   recorded by the front desk as today.
-- * payment_methods: which payment types the front desk sees (POS, record payment). A display choice: bills already
--   paid by a method that is later hidden keep it, and clients with coins can always spend them.
-- (0009 is the day-end close migration.)

create or replace function public.valid_payment_methods(p text[]) returns boolean
language sql immutable as $$
  select p is not null
     and cardinality(p) between 1 and 7
     and cardinality(p) = (select count(distinct x) from unnest(p) x)
     and not exists (select 1 from unnest(p) x where x is null or x not in ('cash', 'upi', 'card', 'wallet', 'other', 'cash_nu', 'upi_bhutan'))
     and exists (select 1 from unnest(p) x where x <> 'wallet');
$$;

-- A VPA: a handle, "@", and the bank/app's handle (name@okicici, 9876543210@ybl, salon.jaigaon@sbi).
create or replace function public.valid_upi_vpa(p text) returns boolean
language sql immutable as $$
  select p ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,254}@[A-Za-z][A-Za-z0-9]{1,63}$';
$$;

alter table public.salons
  add column payment_methods text[] not null default '{cash,upi,card,wallet}',
  add column upi_vpa text,
  add column upi_payee_name text,
  add column receipt_size text not null default '80';
alter table public.salons
  add constraint salons_payment_methods_valid check (public.valid_payment_methods(payment_methods)),
  add constraint salons_upi_vpa_valid check (upi_vpa is null or public.valid_upi_vpa(upi_vpa)),
  add constraint salons_upi_payee_name_valid check (upi_payee_name is null or (char_length(btrim(upi_payee_name)) between 1 and 50
                                                    and upi_payee_name !~ '[[:cntrl:]]')),
  add constraint salons_receipt_size_valid check (receipt_size in ('a4', '80', '58'));

comment on column public.salons.upi_vpa is 'The salon''s own UPI ID for the pay-by-QR on bills. Money goes straight to the salon.';
comment on column public.salons.payment_methods is 'Payment types offered at the desk: cash, upi, card, wallet (coins), other, cash_nu, upi_bhutan';
