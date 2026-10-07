-- Fix invoice generation when advance covers full job fee and link advance allocation
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
  billable_sub numeric; 
  tax numeric; 
  tot numeric;
  alloc_amt numeric;
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

  -- The taxable billable fee is job fee minus discounts + additions
  billable_sub := coalesce(j.fee, 0) - coalesce(j.discount, 0) - coalesce(c.discount, 0) + coalesce(c.other_addition, 0) + coalesce(_extra_amount, 0);
  if billable_sub <= 0 then 
    billable_sub := coalesce(j.fee, 0);
  end if;
  if billable_sub <= 0 then 
    raise exception 'Invoice must have a billable amount greater than zero'; 
  end if;

  tax := round(billable_sub * coalesce(_tax_rate, 0) / 100, 2);
  tot := billable_sub + tax;

  insert into public.invoices(client_id, job_id, payment_id, invoice_date, due_date, notes, created_by)
  values (j.client_id, _job_id, _payment_id, coalesce(_invoice_date, current_date), coalesce(_due_date, current_date + 15), _notes, auth.uid())
  returning id into inv_id;

  insert into public.invoice_items(invoice_id, job_id, description, amount)
  values (inv_id, _job_id, j.title, billable_sub - coalesce(_extra_amount, 0));

  if coalesce(_extra_amount, 0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount)
    values (inv_id, coalesce(nullif(_extra_desc, ''), 'Professional charges / Reimbursable expenses'), _extra_amount);
  end if;

  update public.invoices 
  set subtotal = billable_sub, 
      tax_rate = coalesce(_tax_rate, 0), 
      tax_amount = tax, 
      total = tot, 
      description = (select string_agg(description, ', ') from public.invoice_items where invoice_id = inv_id) 
  where id = inv_id;

  update public.jobs set financial_status = 'invoiced' where id = _job_id;
  insert into public.audit_logs(user_id, action, module, record_id, reason) 
  values (auth.uid(), 'invoice_created', 'invoices', inv_id, j.job_code);

  -- If payment was linked or advance was recorded, auto-allocate to this invoice
  if _payment_id is not null then
    alloc_amt := least(coalesce(c.advance, tot), tot);
    if alloc_amt > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount)
      values (_payment_id, inv_id, alloc_amt)
      on conflict do nothing;
      perform public.recalc_invoice(inv_id);
      perform public.recalc_payment(_payment_id);
    end if;
  end if;

  return inv_id;
end $$;
