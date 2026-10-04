-- Drop the client financial_year column.
--
-- It was write-only: no report, job, invoice or RPC ever read it. The period a
-- client is billed for already lives in client_services (start_date, frequency,
-- due_days) and on the generated jobs, so this was a second place for the same
-- fact to go stale — why: one loose text field cannot represent a client
-- spanning several financial years.
--
-- Optional field, never mandatory, no dependent index — safe to drop.
alter table public.clients drop column if exists financial_year;