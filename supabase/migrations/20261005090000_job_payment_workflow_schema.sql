/* ==========================================================================
   Phase 1 -- Job-centric workflow: JOB -> PAYMENT -> CLEARING -> SQUARE-OFF -> INVOICE
   Invoice creation is impossible until the job's payment clearing is squared
   off. Enforcement lives in Postgres; the UI only reflects it.
   References become JOB-XXXX-MMYY / PAY-XXXX-MMYY / INV-XXXX-MMYY.
   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
alter table public.jobs alter column job_code set default ('JOB-' || lpad(nextval('public.job_seq')::text, 4, '0') || '-' || to_char(current_date, 'MMYY'));
alter table public.payments alter column payment_code set default ('PAY-' || lpad(nextval('public.payment_seq')::text, 4, '0') || '-' || to_char(current_date, 'MMYY'));
alter table public.invoices alter column invoice_no set default ('INV-' || lpad(nextval('public.invoice_seq')::text, 4, '0') || '-' || to_char(current_date, 'MMYY'));
alter table public.jobs add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists completed_at timestamptz;
create or replace function public.stamp_job_completion() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' then
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status is distinct from 'completed' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists jobs_stamp_completion on public.jobs;
create trigger jobs_stamp_completion before insert or update on public.jobs for each row execute function public.stamp_job_completion();
create table if not exists public.job_clearing (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete restrict,
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  advance numeric(14,2) not null default 0 check (advance >= 0),
  tds_tcs numeric(14,2) not null default 0 check (tds_tcs >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  other_deduction numeric(14,2) not null default 0 check (other_deduction >= 0),
  other_addition numeric(14,2) not null default 0 check (other_addition >= 0),
  gross_fee numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0 check (final_amount >= 0),
  status text not null default 'draft' check (status in ('draft','cleared','squared_off')),
  cleared_at timestamptz, cleared_by uuid references public.profiles(id),
  squared_off_at timestamptz, squared_off_by uuid references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id)
);
create index if not exists job_clearing_firm_idx on public.job_clearing(firm_id);
create or replace function public.job_clearing_recalc() returns trigger language plpgsql as $$
declare j record;
begin
  select fee, discount into j from public.jobs where id = new.job_id;
  new.gross_fee := coalesce(j.fee, 0);
  new.final_amount := greatest(new.gross_fee - coalesce(j.discount, 0) - new.advance - new.tds_tcs - new.discount - new.other_deduction + new.other_addition, 0);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists job_clearing_recalc_trg on public.job_clearing;
create trigger job_clearing_recalc_trg before insert or update on public.job_clearing for each row execute function public.job_clearing_recalc();
alter table public.job_clearing enable row level security;
drop policy if exists "job_clearing read" on public.job_clearing;
create policy "job_clearing read" on public.job_clearing for select to authenticated using (public.is_finance() or public.is_manager());
drop policy if exists "job_clearing write" on public.job_clearing;
create policy "job_clearing write" on public.job_clearing for all to authenticated using (public.is_finance()) with check (public.is_finance());
alter table public.payments alter column job_id set not null;
alter table public.invoices add column if not exists job_id uuid references public.jobs(id) on delete restrict;
alter table public.invoices add column if not exists payment_id uuid references public.payments(id) on delete restrict;
create index if not exists invoices_job_idx on public.invoices(job_id);
create index if not exists payments_job_idx on public.payments(job_id);
create unique index if not exists invoices_one_per_job on public.invoices(job_id) where job_id is not null and status <> 'cancelled';
drop policy if exists "pay ins" on public.payments;
create policy "pay ins" on public.payments for insert to authenticated with check ((public.is_finance() or public.is_cashier()) and created_by = auth.uid());
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  expense_date date not null default current_date,
  category text not null default 'Other',
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null default 'other' check (mode in ('cash','bank','upi','cheque','card','other')),
  reference text, paid_to text, notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_firm_idx on public.expenses(firm_id);
create index if not exists expenses_client_idx on public.expenses(client_id);
create index if not exists expenses_job_idx on public.expenses(job_id);
alter table public.expenses enable row level security;
drop policy if exists "expenses read" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated using (public.is_staff_plus());
drop policy if exists "expenses write" on public.expenses;
create policy "expenses write" on public.expenses for all to authenticated using (public.is_finance()) with check (public.is_finance());
create table if not exists public.job_conditions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  code text not null,
  label text not null,
  description text,
  severity text not null default 'block' check (severity in ('block','warn')),
  enabled boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (firm_id, code)
);
create index if not exists job_conditions_firm_idx on public.job_conditions(firm_id);
alter table public.job_conditions enable row level security;
drop policy if exists "job_conditions read" on public.job_conditions;
create policy "job_conditions read" on public.job_conditions for select to authenticated using (true);
drop policy if exists "job_conditions write" on public.job_conditions;
create policy "job_conditions write" on public.job_conditions for all to authenticated using (public.is_manager()) with check (public.is_manager());
create table if not exists public.recurring_payments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.current_firm_id() references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete restrict,
  label text not null,
  amount numeric(14,2) not null check (amount > 0),
  mode text not null default 'bank' check (mode in ('cash','bank','upi','cheque','card','other')),
  frequency text not null check (frequency in ('monthly','quarterly','half_yearly','yearly')),
  next_run_date date not null default current_date,
  last_run_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','stopped')),
  reference text, notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recurring_payments_firm_idx on public.recurring_payments(firm_id);
alter table public.recurring_payments enable row level security;
drop policy if exists "recurring_payments read" on public.recurring_payments;
create policy "recurring_payments read" on public.recurring_payments for select to authenticated using (public.is_finance());
drop policy if exists "recurring_payments write" on public.recurring_payments;
create policy "recurring_payments write" on public.recurring_payments for all to authenticated using (public.is_manager()) with check (public.is_manager());
do $$ declare t text; begin
  foreach t in array array['job_clearing','expenses','job_conditions','recurring_payments'] loop
    execute format('create policy "firm isolation" on public.%I as restrictive for all to authenticated using (firm_id = public.current_firm_id()) with check (firm_id = public.current_firm_id())', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_trigger()', t);
  end loop;
end $$;
revoke execute on function public.auto_invoice_job(uuid) from public, anon, authenticated;
create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.firm_guard('jobs', _job_id);
  if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then raise exception 'Not authorised'; end if;
  perform set_config('app.status_reason', coalesce(_reason,''), true);
  update public.jobs set status=_status where id=_job_id;
end $$;
create or replace function public.assert_invoice_eligible(_job_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare j record; c record; inv record;
begin
  select * into j from public.jobs where id = _job_id;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.status = 'cancelled' then raise exception 'Job % is cancelled', j.job_code; end if;
  select * into inv from public.invoices where job_id = _job_id and status <> 'cancelled' limit 1;
  if inv.id is not null then raise exception 'Job % is already invoiced as %', j.job_code, inv.invoice_no; end if;
  if j.status <> 'completed' then raise exception 'Job % must be completed before invoicing', j.job_code; end if;
  select * into c from public.job_clearing where job_id = _job_id;
  if c.id is null then raise exception 'Invoice cannot be created until payment clearing is completed.'; end if;
  if c.status = 'draft' then raise exception 'Invoice cannot be created until payment clearing is completed.'; end if;
  if c.status = 'cleared' then raise exception 'Invoice cannot be created until payment is squared off.'; end if;
  if c.final_amount <= 0 then raise exception 'Cleared amount for job % must be greater than zero', j.job_code; end if;
  return;
end $$;
create or replace function public.create_invoice(_client_id uuid, _job_ids uuid[], _invoice_date date, _due_date date, _discount numeric, _discount_reason text, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare inv_id uuid; sub numeric := 0; j record; tax numeric; tot numeric; amt numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('clients', _client_id);
  insert into public.invoices(client_id, invoice_date, due_date, notes, created_by) values (_client_id, _invoice_date, _due_date, _notes, auth.uid()) returning id into inv_id;
  for j in select * from public.jobs where id = any(coalesce(_job_ids,'{}'::uuid[])) loop
    if j.client_id <> _client_id then raise exception 'Job % belongs to another client', j.job_code; end if;
    perform public.assert_invoice_eligible(j.id);
    select coalesce((select c.final_amount from public.job_clearing c where c.job_id=j.id), j.net_amount) into amt;
    insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, j.id, j.title, amt);
    update public.invoices set job_id = j.id where id = inv_id and job_id is null;
    sub := sub + amt;
  end loop;
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
    sub := sub + _extra_amount;
  end if;
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  if coalesce(_discount,0) > sub then raise exception 'Discount cannot exceed subtotal'; end if;
  tax := round((sub - coalesce(_discount,0)) * coalesce(_tax_rate,0) / 100, 2);
  tot := sub - coalesce(_discount,0) + tax;
  update public.invoices set subtotal=sub, discount=coalesce(_discount,0), tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot, description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  if coalesce(_discount,0) > 0 then
    insert into public.discounts(invoice_id, original_amount, discount_amount, net_amount, reason, approved_by) values (inv_id, sub, _discount, sub-_discount, _discount_reason, auth.uid());
  end if;
  update public.jobs set financial_status='invoiced' where id = any(coalesce(_job_ids,'{}'));
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'invoice_created', 'invoices', inv_id, 'legacy multi-job path');
  return inv_id;
end $$;
create or replace function public.create_invoice_for_job(_job_id uuid, _payment_id uuid, _invoice_date date, _due_date date, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare j record; c record; inv_id uuid; sub numeric; tax numeric; tot numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  perform public.assert_invoice_eligible(_job_id);
  select * into j from public.jobs where id = _job_id;
  select * into c from public.job_clearing where job_id = _job_id;
  if _payment_id is not null then
    perform public.firm_guard('payments', _payment_id);
    if not exists(select 1 from public.payments where id = _payment_id and job_id = _job_id) then raise exception 'Payment does not belong to job %', j.job_code; end if;
  end if;
  sub := c.final_amount + coalesce(_extra_amount, 0);
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  tax := round(sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := sub + tax;
  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by) values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid()) returning id into inv_id;
  insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, _job_id, j.title, c.final_amount);
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
  end if;
  update public.invoices set subtotal=sub, tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot, description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  update public.jobs set financial_status='invoiced' where id=_job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);
  return inv_id;
end $$;
create or replace function public.save_job_clearing(_job_id uuid, _advance numeric, _tds_tcs numeric, _discount numeric, _other_deduction numeric, _other_addition numeric, _notes text) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  if exists(select 1 from public.job_clearing where job_id=_job_id and status<>'draft') then raise exception 'Clearing has already been completed and cannot be edited. Reverse it first.'; end if;
  insert into public.job_clearing(job_id, advance, tds_tcs, discount, other_deduction, other_addition, notes)
  values (_job_id, coalesce(_advance,0), coalesce(_tds_tcs,0), coalesce(_discount,0), coalesce(_other_deduction,0), coalesce(_other_addition,0), _notes)
  on conflict (job_id) do update set advance=excluded.advance, tds_tcs=excluded.tds_tcs, discount=excluded.discount, other_deduction=excluded.other_deduction, other_addition=excluded.other_addition, notes=excluded.notes
  returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'clearing_saved', 'job_clearing', cid, _job_id::text);
  return cid;
end $$;
create or replace function public.mark_job_cleared(_job_id uuid, _notes text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  update public.job_clearing set status='cleared', cleared_at=now(), cleared_by=auth.uid(), notes=coalesce(_notes, notes) where job_id=_job_id returning id into cid;
  if cid is null then raise exception 'Save the clearing details before clearing the payment.'; end if;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'payment_cleared', 'job_clearing', cid, _job_id::text);
end $$;
create or replace function public.sq_off_job_clearing(_job_id uuid, _notes text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid; jc record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into jc from public.job_clearing where job_id=_job_id;
  if jc.id is null then raise exception 'Save the clearing details before squaring off.'; end if;
  if jc.status = 'draft' then raise exception 'Invoice cannot be created until payment clearing is completed.'; end if;
  if jc.status = 'squared_off' then raise exception 'Payment is already squared off.'; end if;
  update public.job_clearing set status='squared_off', squared_off_at=now(), squared_off_by=auth.uid(), notes=coalesce(_notes, notes) where id=jc.id returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'payment_squared_off', 'job_clearing', cid, _job_id::text);
end $$;
create or replace function public.reopen_job_clearing(_job_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  if exists(select 1 from public.invoices where job_id=_job_id and status<>'cancelled') then raise exception 'This job already has an invoice. Cancel the invoice before reopening the clearing.'; end if;
  update public.job_clearing set status='draft', cleared_at=null, cleared_by=null, squared_off_at=null, squared_off_by=null where job_id=_job_id returning id into cid;
  if cid is null then raise exception 'No clearing record found for this job.'; end if;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'clearing_reopened', 'job_clearing', cid, coalesce(_reason,''));
end $$;
create or replace function public.job_workflow(_job_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j record; c record; inv record; npay int; nopen numeric; blocked text; avail bool;
begin
  select * into j from public.jobs where id=_job_id;
  if j.id is null then raise exception 'Job not found'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into c from public.job_clearing where job_id=_job_id;
  select * into inv from public.invoices where job_id=_job_id and status<>'cancelled' limit 1;
  select count(*) into npay from public.payments where job_id=_job_id and status<>'reversed';
  select coalesce(sum(greatest(amount - allocated_amount, 0)),0) into nopen from public.payments where job_id=_job_id and status<>'reversed';
  blocked := null; avail := false;
  if inv.id is not null then
    avail := false; blocked := format('Invoice %s already exists for this job.', inv.invoice_no);
  elsif j.status = 'cancelled' then
    avail := false; blocked := 'Job is cancelled.';
  elsif j.status <> 'completed' then
    avail := false; blocked := 'Job must be completed before payment clearing.';
  elsif c.id is null or c.status = 'draft' then
    avail := false; blocked := 'Invoice cannot be created until payment clearing is completed.';
  elsif c.status = 'cleared' then
    avail := false; blocked := 'Invoice cannot be created until payment is squared off.';
  else
    avail := true; blocked := null;
  end if;
  return jsonb_build_object(
    'job_id', j.id, 'job_code', j.job_code, 'job_status', j.status,
    'job_completed_at', j.completed_at, 'due_date', j.due_date,
    'overdue', (j.due_date is not null and j.due_date < current_date and coalesce(c.status,'') <> 'squared_off' and j.status <> 'cancelled'),
    'gross_fee', j.fee, 'job_discount', j.discount, 'net_amount', j.net_amount,
    'advance', coalesce(c.advance,0), 'tds_tcs', coalesce(c.tds_tcs,0),
    'clearing_discount', coalesce(c.discount,0), 'other_deduction', coalesce(c.other_deduction,0), 'other_addition', coalesce(c.other_addition,0),
    'clearing_status', coalesce(c.status,'draft'), 'clearing_id', c.id,
    'cleared_at', c.cleared_at, 'squared_off_at', c.squared_off_at,
    'final_amount', coalesce(c.final_amount, 0),
    'payment_count', npay, 'payment_unallocated', nopen,
    'invoice_id', inv.id, 'invoice_no', inv.invoice_no, 'invoice_status', inv.status,
    'invoice_available', avail, 'blocked_reason', blocked,
    'stages', jsonb_build_object(
      'created', true,
      'completed', (j.status = 'completed'),
      'payment_created', (npay > 0),
      'payment_cleared', (c.status in ('cleared','squared_off')),
      'squared_off', (c.status = 'squared_off'),
      'invoiced', (inv.id is not null)
    )
  );
end $$;
grant select, insert, update on public.job_clearing, public.expenses, public.job_conditions, public.recurring_payments to authenticated;
grant all on public.job_clearing, public.expenses, public.job_conditions, public.recurring_payments to service_role;
grant update on public.payments to authenticated;
revoke execute on function public.assert_invoice_eligible(uuid), public.save_job_clearing(uuid, numeric, numeric, numeric, numeric, numeric, text), public.mark_job_cleared(uuid, text), public.sq_off_job_clearing(uuid, text), public.reopen_job_clearing(uuid, text), public.job_workflow(uuid), public.create_invoice_for_job(uuid, uuid, date, date, numeric, text, text, numeric) from public, anon;
grant execute on function public.create_invoice_for_job(uuid, uuid, date, date, numeric, text, text, numeric), public.save_job_clearing(uuid, numeric, numeric, numeric, numeric, numeric, text), public.mark_job_cleared(uuid, text), public.sq_off_job_clearing(uuid, text), public.reopen_job_clearing(uuid, text), public.job_workflow(uuid), public.update_job_status(uuid, text, text), public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric) to authenticated;