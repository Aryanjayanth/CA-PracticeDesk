/* ==========================================================================
   Fix: Split shared stamp_doc_no trigger into separate per-table functions.
   PostgreSQL PL/pgSQL validates column references against the triggering table's
   row type, so referencing NEW.invoice_no inside a trigger attached to public.jobs
   raises "record 'new' has no field 'invoice_no'".
   ========================================================================== */

create or replace function public.stamp_job_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.job_code is null then
    new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date));
  end if;
  return new;
end $$;

create or replace function public.stamp_invoice_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.invoice_no is null then
    new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date));
  end if;
  return new;
end $$;

create or replace function public.stamp_payment_doc_no() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.payment_code is null then
    new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date));
  end if;
  return new;
end $$;

drop trigger if exists jobs_stamp_doc_no on public.jobs;
create trigger jobs_stamp_doc_no before insert on public.jobs for each row execute function public.stamp_job_doc_no();

drop trigger if exists invoices_stamp_doc_no on public.invoices;
create trigger invoices_stamp_doc_no before insert on public.invoices for each row execute function public.stamp_invoice_doc_no();

drop trigger if exists payments_stamp_doc_no on public.payments;
create trigger payments_stamp_doc_no before insert on public.payments for each row execute function public.stamp_payment_doc_no();
