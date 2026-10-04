-- Relax client contact requirements:
--   - Contact Name removed entirely (only ever held placeholder data)
--   - Name of Concerned Person + their phone are now optional
--   - New optional secondary phone number
-- Mandatory set is now: Client Name, Client Type, Address, Phone Number.
--
-- ORDER IS LOAD-BEARING. Two separate things reject the backfill, and both must
-- be dealt with before the UPDATE runs:
--   1. the clients_validate_required trigger  -> narrow the function first
--   2. NOT NULL on contact_person_name/phone -> drop the constraint first
-- Getting either one wrong aborts the whole transaction with
-- "Missing required field(s)" / "violates not-null constraint" and rolls back.

-- 1. Narrow the mandatory set. The trigger stays attached and now uses this body.
create or replace function public.validate_client_required() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''        then 'Client Name' end,
    case when btrim(coalesce(new.client_type, '')) = ''  then 'Client Type' end,
    case when btrim(coalesce(new.address, '')) = ''      then 'Address' end,
    case when btrim(coalesce(new.mobile, '')) = ''       then 'Phone Number' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

-- 2. Relax the columns BEFORE writing any data to them.
alter table public.clients
  drop column if exists contact_name,
  alter column contact_person_name  drop not null,
  alter column contact_person_phone drop not null;

-- 3. Secondary phone
alter table public.clients add column if not exists secondary_phone text;

-- 4. Now legal: the trigger permits blanks and the columns accept NULL.
update public.clients set
  contact_person_name  = nullif(contact_person_name, 'Not provided'),
  contact_person_phone = nullif(contact_person_phone, 'Not provided');

create index if not exists clients_secondary_phone_idx on public.clients(secondary_phone);