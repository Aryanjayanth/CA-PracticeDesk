CREATE OR REPLACE FUNCTION public.delete_firm(_firm_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare f_status text;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorised: Only Super Admin can delete firms';
  end if;

  select status into f_status from public.firms where id = _firm_id;
  if f_status is null then
    raise exception 'Firm not found';
  end if;

  if f_status <> 'suspended' then
    raise exception 'Firm must be suspended before it can be deleted';
  end if;

  -- Nullify active / acting references
  update public.profiles set acting_firm_id = null where acting_firm_id = _firm_id;
  update public.profiles set firm_id = null where firm_id = _firm_id;

  -- Delete all associated firm data
  delete from public.firm_invites where firm_id = _firm_id;
  delete from public.audit_logs where firm_id = _firm_id;
  delete from public.payment_allocations where firm_id = _firm_id;
  delete from public.payment_reversals where firm_id = _firm_id;
  delete from public.discounts where firm_id = _firm_id;
  delete from public.invoice_items where firm_id = _firm_id;
  delete from public.invoices where firm_id = _firm_id;
  delete from public.payments where firm_id = _firm_id;
  delete from public.bank_transactions where firm_id = _firm_id;
  delete from public.job_status_history where firm_id = _firm_id;
  delete from public.jobs where firm_id = _firm_id;
  delete from public.client_services where firm_id = _firm_id;
  delete from public.clients where firm_id = _firm_id;
  delete from public.services where firm_id = _firm_id;
  delete from public.settings where firm_id = _firm_id;
  delete from public.firms where id = _firm_id;
end $function$;

REVOKE EXECUTE ON FUNCTION public.delete_firm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_firm(uuid) TO authenticated;
