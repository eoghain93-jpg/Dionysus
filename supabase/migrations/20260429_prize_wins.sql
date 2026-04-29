-- Prize wins from the pub's two fruit machines.
--
-- Customers win paper vouchers from the machines and redeem them at the bar
-- for cash (paid out of the till). The voucher itself is held separately so
-- the supplier can reimburse the pub. For end-of-day cash reconciliation,
-- prize wins reduce expected-in-till in the same way as cashback.
--
-- machine: '1' or '2' — keeps the data flexible if the pub adds more later.

create table prize_wins (
  id uuid primary key default gen_random_uuid(),
  amount numeric(10,2) not null check (amount > 0),
  machine text not null,
  staff_id uuid references members(id),
  till_id text not null default 'till-1',
  created_at timestamptz default now()
);
