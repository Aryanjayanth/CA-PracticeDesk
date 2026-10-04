-- Client contact fields + mandatory-field enforcement
-- Adds: Contact Name, Name of Concerned Person, Concerned Person's Phone, Concerned Person's Role
-- Enforces the mandatory set (Client Name, Type, Address, Phone, Contact Name,
-- Name of Concerned Person, Concerned Person's Phone) in the database so the
-- rule holds regardless of client — why: rules must hold regardless of client.

-- 1. New columns
alter table public.clients
  add column if not exists contact_name         text,
  add column if not exists contact_person_name  text,
  add column if not exists contact_person_phone text,
  add column if not exists contact_person_role  text;

-- 2. Backfill so pre-existing rows satisfy the new requirement.
--    Rows are only ever soft-edited afterwards; no financial record is touched.
update public.clients set
  address              = coalesce(nullif(btrim(address), ''), 'Not provided'),
  mobile               = coalesce(nullif(btrim(mobile), ''), 'Not provided'),
  client_type          = coalesce(nullif(btrim(client_type), ''), 'Company'),
  contact_name         = coalesce(nullif(btrim(contact_name), ''), 'Not provided'),
  contact_person_name  = coalesce(nullif(btrim(contact_person_name), ''), 'Not provided'),
  contact_person_phone = coalesce(nullif(btrim(contact_person_phone), ''), 'Not provided'),
  contact_person_role  = coalesce(nullif(btrim(contact_person_role), ''), 'Others');

-- 3. Hard NOT NULL on the mandatory columns
alter table public.clients
  alter column address              set not null,
  alter column mobile               set not null,
  alter column contact_name         set not null,
  alter column contact_person_name  set not null,
  alter column contact_person_phone set not null;

-- 4. Guard against blank / whitespace-only strings (NOT NULL alone allows '')
create or replace function public.validate_client_required() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''                then 'Client Name' end,
    case when btrim(coalesce(new.client_type, '')) = ''          then 'Client Type' end,
    case when btrim(coalesce(new.address, '')) = ''               then 'Address' end,
    case when btrim(coalesce(new.mobile, '')) = ''                then 'Phone Number' end,
    case when btrim(coalesce(new.contact_name, '')) = ''          then 'Contact Name' end,
    case when btrim(coalesce(new.contact_person_name, '')) = ''   then 'Name of Concerned Person' end,
    case when btrim(coalesce(new.contact_person_phone, '')) = ''  then 'Concerned Person''s Phone Number' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

drop trigger if exists clients_validate_required on public.clients;
create trigger clients_validate_required
  before insert or update on public.clients
  for each row execute function public.validate_client_required();

-- 5. Indexes for the new list filters
create index if not exists clients_client_type_idx on public.clients(client_type);
create index if not exists clients_industry_idx     on public.clients(industry);
create index if not exists clients_gst_type_idx     on public.clients(gst_type);
create index if not exists clients_contact_person_idx on public.clients(contact_person_name);