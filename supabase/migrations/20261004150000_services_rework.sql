-- Services rework: SAC codes, default fees and due-day rules move off the master.
--
-- What changed and why:
--   * sac_code is dropped outright. It was surfaced on the services screen AND
--     printed on invoice line items (invoice_items -> jobs -> services.sac_code).
--     Historic invoices simply stop showing it.
--   * default_fee and due_days are dropped from services. client_services
--     (the assignment) already carries its own agreed_fee and due_days, and the
--     service-level copies had drifted out of sync with real assignments --
--     they were only ever prefills. Dropping the columns loses no real data.
--   * The silent column defaults ('Other', 'recurring', 'monthly') are removed
--     so those three must be chosen deliberately rather than inherited.
--
-- Mandatory set for a service is now: name, service_type, billing_type, frequency.

-- 1. Remove the columns that now live on the assignment (or are gone entirely).
alter table public.services
  drop column if exists sac_code,
  drop column if exists default_fee,
  drop column if exists due_days;

-- 2. Remove the silent defaults so the user must pick these explicitly.
alter table public.services
  alter column service_type drop default,
  alter column billing_type drop default,
  alter column frequency  drop default;

-- 3. Enforce the mandatory set in the database, and keep billing_type and
--    frequency consistent with each other.
create or replace function public.validate_service_required() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''         then 'Service Name' end,
    case when btrim(coalesce(new.service_type, '')) = '' then 'Service Type' end,
    case when btrim(coalesce(new.billing_type, '')) = '' then 'Billing Type' end,
    case when btrim(coalesce(new.frequency, '')) = ''    then 'Frequency' end,
    case when new.billing_type = 'one_time' and new.frequency <> 'one_time'
      then 'Frequency must be One-time for a non-recurring service' end,
    case when new.billing_type = 'recurring' and new.frequency = 'one_time'
      then 'Choose a recurring frequency' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

drop trigger if exists services_validate_required on public.services;
create trigger services_validate_required
  before insert or update on public.services
  for each row execute function public.validate_service_required();

create index if not exists services_active_idx on public.services(active);