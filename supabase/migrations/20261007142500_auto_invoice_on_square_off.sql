-- Allow re-saving job clearing as long as an invoice is not yet created
create or replace function public.save_job_clearing(
  _job_id uuid, 
  _advance numeric, 
  _tds_tcs numeric, 
  _discount numeric, 
  _other_deduction numeric, 
  _other_addition numeric, 
  _notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  if exists(select 1 from public.invoices where job_id=_job_id and status<>'cancelled') then 
    raise exception 'Invoice already exists for this job. Cancel the invoice before editing clearing.'; 
  end if;
  insert into public.job_clearing(job_id, advance, tds_tcs, discount, other_deduction, other_addition, notes)
  values (_job_id, coalesce(_advance,0), coalesce(_tds_tcs,0), coalesce(_discount,0), coalesce(_other_deduction,0), coalesce(_other_addition,0), _notes)
  on conflict (job_id) do update set 
    advance=excluded.advance, 
    tds_tcs=excluded.tds_tcs, 
    discount=excluded.discount, 
    other_deduction=excluded.other_deduction, 
    other_addition=excluded.other_addition, 
    notes=excluded.notes
  returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'clearing_saved', 'job_clearing', cid, _job_id::text);
  return cid;
end $$;

-- Allow squaring off without erroring if already squared off
create or replace function public.sq_off_job_clearing(_job_id uuid, _notes text) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid; jc record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into jc from public.job_clearing where job_id=_job_id;
  if jc.id is null then raise exception 'Save the clearing details before squaring off.'; end if;
  update public.job_clearing set status='squared_off', squared_off_at=coalesce(squared_off_at, now()), squared_off_by=coalesce(squared_off_by, auth.uid()), notes=coalesce(_notes, notes) where id=jc.id returning id into cid;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(), 'payment_squared_off', 'job_clearing', cid, _job_id::text);
end $$;

-- Single Atomic RPC: Square off job and automatically generate invoice + allocate from client money jar
create or replace function public.square_off_and_invoice_job(
  _job_id uuid,
  _advance numeric,
  _tds_tcs numeric,
  _discount numeric,
  _other_deduction numeric,
  _other_addition numeric,
  _tax_rate numeric,
  _notes text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  j record;
  c record;
  inv_id uuid;
  billable_sub numeric;
  tax numeric;
  tot numeric;
  pay_rec record;
  needed_adv numeric;
  alloc_amt numeric;
  cid uuid;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  select * into j from public.jobs where id = _job_id;
  if j.id is null then raise exception 'Job not found'; end if;

  -- 1. Upsert job_clearing record as squared_off
  insert into public.job_clearing(
    job_id, advance, tds_tcs, discount, other_deduction, other_addition, notes, status, cleared_at, cleared_by, squared_off_at, squared_off_by
  )
  values (
    _job_id, coalesce(_advance, 0), coalesce(_tds_tcs, 0), coalesce(_discount, 0),
    coalesce(_other_deduction, 0), coalesce(_other_addition, 0), _notes,
    'squared_off', now(), auth.uid(), now(), auth.uid()
  )
  on conflict (job_id) do update set
    advance = excluded.advance,
    tds_tcs = excluded.tds_tcs,
    discount = excluded.discount,
    other_deduction = excluded.other_deduction,
    other_addition = excluded.other_addition,
    notes = excluded.notes,
    status = 'squared_off',
    cleared_at = coalesce(job_clearing.cleared_at, now()),
    cleared_by = coalesce(job_clearing.cleared_by, auth.uid()),
    squared_off_at = coalesce(job_clearing.squared_off_at, now()),
    squared_off_by = coalesce(job_clearing.squared_off_by, auth.uid())
  returning id into cid;

  select * into c from public.job_clearing where id = cid;

  -- 2. Calculate Billable Subtotal
  billable_sub := coalesce(j.fee, 0) - coalesce(j.discount, 0) - coalesce(_discount, 0) + coalesce(_other_addition, 0);
  if billable_sub <= 0 then
    billable_sub := coalesce(j.fee, 0);
  end if;
  if billable_sub <= 0 then
    billable_sub := 1;
  end if;

  tax := round(billable_sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := billable_sub + tax;

  -- 3. Create Invoice automatically
  insert into public.invoices(client_id, job_id, invoice_date, due_date, notes, created_by)
  values (j.client_id, _job_id, current_date, current_date + 15, _notes, auth.uid())
  returning id into inv_id;

  insert into public.invoice_items(invoice_id, job_id, description, amount)
  values (inv_id, _job_id, j.title, billable_sub);

  update public.invoices 
  set subtotal = billable_sub, 
      tax_rate = coalesce(_tax_rate, 0), 
      tax_amount = tax, 
      total = tot, 
      description = (select string_agg(description, ', ') from public.invoice_items where invoice_id = inv_id) 
  where id = inv_id;

  update public.jobs set financial_status = 'invoiced' where id = _job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) 
  values (auth.uid(), 'invoice_auto_generated_on_square_off', 'invoices', inv_id, j.job_code);

  -- 4. Auto-allocate advance payment from Money Jar to this invoice & update payment allocated amounts
  -- If _advance is > 0 use it; otherwise use tot if client has money in jar
  needed_adv := case when coalesce(_advance, 0) > 0 then least(_advance, tot) else tot end;
  if needed_adv > 0 then
    for pay_rec in 
      select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
      from public.payments 
      where client_id = j.client_id 
        and status <> 'reversed' 
        and (amount - allocated_amount) > 0 
      order by payment_date asc, created_at asc
    loop
      alloc_amt := least(needed_adv, pay_rec.avail_amount);
      if alloc_amt > 0 then
        insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
        values (pay_rec.id, inv_id, alloc_amt, auth.uid());
        
        needed_adv := needed_adv - alloc_amt;
        exit when needed_adv <= 0;
      end if;
    end loop;
  end if;

  return inv_id;
end $$;

grant execute on function public.square_off_and_invoice_job(uuid, numeric, numeric, numeric, numeric, numeric, numeric, text) to authenticated;

-- Helper RPC: Allocate available client money jar to any existing invoice
create or replace function public.allocate_client_jar_to_invoice(_invoice_id uuid) returns numeric language plpgsql security definer set search_path=public as $$
declare
  inv record;
  pay_rec record;
  needed numeric;
  alloc_amt numeric;
  total_allocated numeric := 0;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('invoices', _invoice_id);
  select * into inv from public.invoices where id = _invoice_id;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status in ('cancelled','draft','paid') then return 0; end if;

  needed := coalesce(inv.outstanding, inv.total - coalesce(inv.amount_paid, 0));
  if needed <= 0 then return 0; end if;

  for pay_rec in 
    select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
    from public.payments 
    where client_id = inv.client_id 
      and status <> 'reversed' 
      and (amount - allocated_amount) > 0 
    order by payment_date asc, created_at asc
  loop
    alloc_amt := least(needed, pay_rec.avail_amount);
    if alloc_amt > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
      values (pay_rec.id, inv.id, alloc_amt, auth.uid());
      
      needed := needed - alloc_amt;
      total_allocated := total_allocated + alloc_amt;
      exit when needed <= 0;
    end if;
  end loop;

  return total_allocated;
end $$;

grant execute on function public.allocate_client_jar_to_invoice(uuid) to authenticated;

-- Update create_invoice_for_job to also allocate advance from client money jar
create or replace function public.create_invoice_for_job(
  _job_id uuid,
  _payment_id uuid,
  _invoice_date date,
  _due_date date,
  _tax_rate numeric,
  _notes text,
  _extra_desc text,
  _extra_amount numeric
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  j record;
  c record;
  inv_id uuid;
  sub numeric;
  tax numeric;
  tot numeric;
  needed_adv numeric;
  pay_rec record;
  alloc_amt numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('jobs', _job_id);
  perform public.assert_invoice_eligible(_job_id);
  select * into j from public.jobs where id = _job_id;
  select * into c from public.job_clearing where job_id = _job_id;
  
  sub := coalesce(j.fee, 0) - coalesce(j.discount, 0) - coalesce(c.discount, 0) + coalesce(c.other_addition, 0) + coalesce(_extra_amount, 0);
  if sub <= 0 then
    sub := coalesce(c.final_amount, 0) + coalesce(_extra_amount, 0);
  end if;
  if sub <= 0 then
    sub := coalesce(j.fee, 1);
  end if;
  
  tax := round(sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := sub + tax;

  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by)
  values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid())
  returning id into inv_id;

  insert into public.invoice_items(invoice_id, job_id, description, amount)
  values (inv_id, _job_id, j.title, sub - coalesce(_extra_amount, 0));

  if coalesce(_extra_amount, 0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount)
    values (inv_id, coalesce(nullif(_extra_desc, ''), 'Additional charges / expenses'), _extra_amount);
  end if;

  update public.invoices 
  set subtotal = sub, 
      tax_rate = coalesce(_tax_rate, 0), 
      tax_amount = tax, 
      total = tot, 
      description = (select string_agg(description, ', ') from public.invoice_items where invoice_id = inv_id) 
  where id = inv_id;

  update public.jobs set financial_status = 'invoiced' where id = _job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) 
  values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);

  -- Allocate from specific payment or client money jar
  needed_adv := case when coalesce(c.advance, 0) > 0 then least(c.advance, tot) else tot end;
  if needed_adv > 0 then
    if _payment_id is not null then
      select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
      into pay_rec 
      from public.payments 
      where id = _payment_id and status <> 'reversed';

      if pay_rec.id is not null and pay_rec.avail_amount > 0 then
        alloc_amt := least(needed_adv, pay_rec.avail_amount);
        insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
        values (pay_rec.id, inv_id, alloc_amt, auth.uid());
        needed_adv := needed_adv - alloc_amt;
      end if;
    end if;

    if needed_adv > 0 then
      for pay_rec in 
        select id, amount, allocated_amount, greatest(0, amount - allocated_amount) as avail_amount 
        from public.payments 
        where client_id = j.client_id 
          and status <> 'reversed' 
          and (amount - allocated_amount) > 0 
        order by payment_date asc, created_at asc
      loop
        alloc_amt := least(needed_adv, pay_rec.avail_amount);
        if alloc_amt > 0 then
          insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by)
          values (pay_rec.id, inv_id, alloc_amt, auth.uid());
          needed_adv := needed_adv - alloc_amt;
          exit when needed_adv <= 0;
        end if;
      end loop;
    end if;
  end if;

  return inv_id;
end $$;

grant execute on function public.create_invoice_for_job(uuid, uuid, date, date, numeric, text, text, numeric) to authenticated;
