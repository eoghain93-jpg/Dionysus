-- Kev joins the monthly report distribution alongside the accountant.
-- (z_report_recipients is unaffected — he already gets the daily Zs.)

insert into monthly_report_recipients (email, name) values
  ('shineyheadkev@gmail.com', 'Kev')
on conflict (email) do nothing;
