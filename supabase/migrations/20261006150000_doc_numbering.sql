/* ==========================================================================
   Document numbering: JOB0001-1026 / REC0001-1026 / INV0001-1026

   Replaces the column defaults ('JB' || lpad(job_seq,5,'0')) and the
   intermediate phase-1 hyphenated defaults. Numbers are per firm, per kind,
   per MMYY period, and restart at 0001 every month, so INV00011026 reads as
   "first invoice of October 2026" rather than a running global counter.

   The MMYY suffix comes from the document's own business date (invoice_date,
   payment_date, created_at), not the row insert time, so a back-dated invoice
   carries the month it is dated in.

   Generated in a before insert trigger rather than a column default because a
   default cannot read another column on the row, and because the old defaults
   have to be dropped anyway or they would fill the code before the trigger
   ever sees it.

   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
create table if not exists public.doc_counters (
  firm_id uuid not null references public.firms(id) on delete cascade,
  kind text not null check (kind in ('INV','REC','JOB')),
  period text not null check (period ~ '^[0-9]{4}$'),
  last_no int not null default 0,
  primary key (firm_id, kind, period)
);
alter table public.doc_counters enable row level security;
revoke all on public.doc_counters from anon, authenticated;
grant all on public.doc_counters to service_role;
create or replace function public.next_doc_code(_kind text, _on date) returns text language plpgsql security definer set search_path=public as $$
declare v_period text; v_no int;
begin
  if _kind not in ('INV','REC','JOB') then raise exception 'Unknown document kind: %', _kind; end if;
  v_period := to_char(coalesce(_on, current_date), 'MMYY');
  insert into public.doc_counters as c (firm_id, kind, period, last_no) values (public.current_firm_id(), _kind, v_period, 1)
  on conflict (firm_id, kind, period) do update set last_no = c.last_no + 1  returning last_no into v_no;
  return _kind || lpad(v_no::text, 4, '0') || '-' || v_period;
end $$;
create or replace function public.stamp_job_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.job_code is null then new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date)); end if;
  return new;
end $$;
create or replace function public.stamp_invoice_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.invoice_no is null then new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date)); end if;
  return new;
end $$;
create or replace function public.stamp_payment_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.payment_code is null then new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date)); end if;
  return new;
end $$;
alter table public.jobs alter column job_code drop default;
alter table public.invoices alter column invoice_no drop default;
alter table public.payments alter column payment_code drop default;
drop trigger if exists jobs_stamp_doc_no on public.jobs;
create trigger jobs_stamp_doc_no before insert on public.jobs for each row execute function public.stamp_job_doc_no();
drop trigger if exists invoices_stamp_doc_no on public.invoices;
create trigger invoices_stamp_doc_no before insert on public.invoices for each row execute function public.stamp_invoice_doc_no();
drop trigger if exists payments_stamp_doc_no on public.payments;
create trigger payments_stamp_doc_no before insert on public.payments for each row execute function public.stamp_payment_doc_no();
do $$
declare r record; c record;
begin
  for r in select * from (values ('jobs','job_code'),('invoices','invoice_no'),('payments','payment_code')) as v(tbl,col) loop
    for c in select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = format('public.%I', r.tbl)::regclass and contype = 'u' loop
      if c.def = format('UNIQUE (%s)', r.col) then execute format('alter table public.%I drop constraint %I', r.tbl, c.conname); end if;
    end loop;
    execute format('create unique index %I on public.%I (firm_id, %I)', r.tbl || '_' || r.col || '_firm_uniq', r.tbl, r.col);
  end loop;
end $$;