/* ==========================================================================
   Sequential master numbering: clients and services count 1, 2, 3...

   Both codes keep their CL0001 / SV001 shape; what changes is where the numbers
   come from. They were previously drawn from a single global sequence per table,
   which produced two problems:

   1. The numbers were not contiguous. Deleting a client left a gap, and the
      next client was CL0028 after CL0020, which reads as random rather than
      sequential to anyone looking at the list.
   2. The sequence was global across all firms, so a second firm started at
      CL0029 and two firms could never both hold "CL0001".

   Numbers are now per firm, allocated by next_master_code() from doc_counters,
   which the document-numbering migration already introduced. Clients and
   services use the sentinel period 'ALL' because they never reset on a period
   boundary the way an invoice number does; only the firm and kind separate them.

   Existing rows are renumbered 1..N per firm in creation order, so the sequence
   is contiguous from the start rather than starting again after the old codes.
   This is safe because nothing references these columns by value: client_code
   and service_code are display labels, and every foreign key points at the uuid.
   Import/export reads client_code only to map a spreadsheet row back to a uuid,
   and it looks the value up at export time rather than storing it.

   The global UNIQUE constraints become per-firm composite indexes, matching what
   jobs/invoices/payments already do.

   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
alter table public.doc_counters drop constraint if exists doc_counters_kind_check;
alter table public.doc_counters add constraint doc_counters_kind_check check (kind in ('INV','REC','JOB','CLI','SVC'));
alter table public.doc_counters drop constraint if exists doc_counters_period_check;
alter table public.doc_counters add constraint doc_counters_period_check check (period ~ '^[0-9]{4}$' or period = 'ALL');
create or replace function public.next_master_code(_kind text) returns text language plpgsql security definer set search_path=public as $$
declare v_no int; v_prefix text; v_width int;
begin
  if _kind = 'CLI' then v_prefix := 'CL'; v_width := 4;
  elsif _kind = 'SVC' then v_prefix := 'SV'; v_width := 3;
  else raise exception 'Unknown master kind: %', _kind;
  end if;
  insert into public.doc_counters as c (firm_id, kind, period, last_no) values (public.current_firm_id(), _kind, 'ALL', 1)
  on conflict (firm_id, kind, period) do update set last_no = c.last_no + 1 returning last_no into v_no;
  return v_prefix || lpad(v_no::text, v_width, '0');
end $$;
revoke execute on function public.next_master_code(text) from public, anon, authenticated;
/* One function serves both tables. The row is read as jsonb and written back,
   because plpgsql resolves new.<column> against the live row type: naming
   service_code while the trigger fires on clients raises "record new has no
   field service_code" at runtime. */
create or replace function public.stamp_master_code() returns trigger language plpgsql security definer set search_path=public as $$
declare v_code text; v_col text; v_kind text;
begin
  if tg_table_name = 'clients' then v_col := 'client_code'; v_kind := 'CLI';
  elsif tg_table_name = 'services' then v_col := 'service_code'; v_kind := 'SVC';
  else return new;
  end if;
  if coalesce(btrim(to_jsonb(new)->>v_col), '') = '' then
    v_code := public.next_master_code(v_kind);
    new := jsonb_populate_record(new, jsonb_build_object(v_col, v_code));
  end if;
  return new;
end $$;
alter table public.clients alter column client_code drop default;
alter table public.services alter column service_code drop default;
drop trigger if exists clients_stamp_master_code on public.clients;
create trigger clients_stamp_master_code before insert on public.clients for each row execute function public.stamp_master_code();
drop trigger if exists services_stamp_master_code on public.services;
create trigger services_stamp_master_code before insert on public.services for each row execute function public.stamp_master_code();
drop index if exists public.clients_client_code_firm_uniq;
drop index if exists public.services_service_code_firm_uniq;
do $$ declare c record; begin for c in select conname from pg_constraint where conrelid = 'public.clients'::regclass and contype = 'u' loop execute format('alter table public.clients drop constraint %I', c.conname); end loop; for c in select conname from pg_constraint where conrelid = 'public.services'::regclass and contype = 'u' loop execute format('alter table public.services drop constraint %I', c.conname); end loop; execute 'create unique index clients_client_code_firm_uniq on public.clients(firm_id, client_code)'; execute 'create unique index services_service_code_firm_uniq on public.services(firm_id, service_code)'; end $$;
/* Renumber to CL0001.. / SV001.. per firm in creation order, so the sequence is
   contiguous from the start instead of continuing from the old global numbers. */
with ranked as (select id, row_number() over (partition by firm_id order by created_at, id)::int as rn from public.clients)
update public.clients c set client_code = 'CL' || lpad(ranked.rn::text, 4, '0') from ranked where c.id = ranked.id;
with ranked as (select id, row_number() over (partition by firm_id order by created_at, id)::int as rn from public.services)
update public.services s set service_code = 'SV' || lpad(ranked.rn::text, 3, '0') from ranked where s.id = ranked.id;
insert into public.doc_counters (firm_id, kind, period, last_no)
select f.id, k.kind, 'ALL',
  case k.kind when 'CLI' then coalesce((select count(*) from public.clients c where c.firm_id=f.id), 0)
              else coalesce((select count(*) from public.services s where s.firm_id=f.id), 0) end
from public.firms f
cross join (values ('CLI'),('SVC')) k(kind)
on conflict (firm_id, kind, period) do update set last_no = excluded.last_no;
