-- Allow lump-sum client level payments (job_id optional on payments)
alter table public.payments alter column job_id drop not null;

-- Update job_workflow to recognize client-level payments for a job
create or replace function public.job_workflow(_job_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare j record; c record; inv record; npay int; nopen numeric; blocked text; avail bool;
begin
  select * into j from public.jobs where id=_job_id;
  if j.id is null then raise exception 'Job not found'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into c from public.job_clearing where job_id=_job_id;
  select * into inv from public.invoices where job_id=_job_id and status<>'cancelled' limit 1;
  
  -- Count payments directly for this job OR general lump-sum payments from this client
  select count(*) into npay from public.payments where (job_id=_job_id or (client_id=j.client_id and job_id is null)) and status<>'reversed';
  select coalesce(sum(greatest(amount - allocated_amount, 0)),0) into nopen from public.payments where (job_id=_job_id or (client_id=j.client_id and job_id is null)) and status<>'reversed';
  
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
      'payment_created', (npay > 0 or coalesce(c.advance, 0) > 0),
      'payment_cleared', (c.status in ('cleared','squared_off')),
      'squared_off', (c.status = 'squared_off'),
      'invoiced', (inv.id is not null)
    )
  );
end $$;

-- Update create_invoice_for_job to allow client-level payments
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
    if not exists(select 1 from public.payments where id = _payment_id and client_id = j.client_id) then
      raise exception 'Payment does not belong to client of job %', j.job_code;
    end if;
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
