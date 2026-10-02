ALTER TABLE public.services ADD COLUMN IF NOT EXISTS sac_code text NOT NULL DEFAULT '998221';

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare cs record; ps date; pe date; step interval; n int := 0; svc record; lbl text;
begin
  for cs in select * from public.client_services where status='active' and firm_id=_firm loop
    select * into svc from public.services where id=cs.service_id;
    if cs.frequency='one_time' then
      insert into public.jobs(firm_id, client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (_firm, cs.client_id, cs.service_id, cs.id, svc.name, cs.start_date, cs.start_date, cs.agreed_fee, cs.start_date + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      continue;
    end if;
    step := case cs.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months' else interval '1 year' end;
    ps := date_trunc('month', cs.start_date)::date;
    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency when 'monthly' then to_char(ps,'Mon YYYY') when 'yearly' then 'FY ' || to_char(ps,'YYYY') else to_char(ps,'Mon YYYY') || ' – ' || to_char(pe,'Mon YYYY') end;
      insert into public.jobs(firm_id, client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (_firm, cs.client_id, cs.service_id, cs.id, svc.name || ' – ' || lbl, ps, pe, cs.agreed_fee, pe + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      ps := (ps + step)::date;
    end loop;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  return public.generate_recurring_jobs_for_firm(public.current_firm_id(), _upto);
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare f record; n int := 0;
begin
  for f in select id from public.firms where status='active' loop
    n := n + public.generate_recurring_jobs_for_firm(f.id, current_date);
  end loop;
  return n;
end $function$;

-- Lock down internal / trigger functions
REVOKE EXECUTE ON FUNCTION public.generate_recurring_jobs_for_firm(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_recurring_jobs_all() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.after_allocation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.job_status_trigger() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_firm() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_allocation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_invoice(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recalc_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.firm_guard(text, uuid) FROM PUBLIC, anon, authenticated;

-- App RPCs & RLS helpers: signed-in users only, never anonymous
REVOKE EXECUTE ON FUNCTION public.allocate_payment(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_invoice(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.client_lookup() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_firm(text, text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_firm_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.firm_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_recurring_jobs(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_cashier() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_finance() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_manager() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff_plus() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_roles() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_allocation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_payment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_acting_firm(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_job_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allocate_payment(uuid, jsonb), public.cancel_invoice(uuid, text), public.client_lookup(), public.create_firm(text, text, text, text, text), public.create_invoice(uuid, uuid[], date, date, numeric, text, numeric, text, text, numeric), public.current_firm_id(), public.firm_overview(), public.generate_recurring_jobs(date), public.has_role(uuid, app_role), public.is_cashier(), public.is_finance(), public.is_manager(), public.is_staff_plus(), public.is_super_admin(), public.my_roles(), public.reverse_allocation(uuid, text), public.reverse_payment(uuid, text), public.set_acting_firm(uuid), public.update_job_status(uuid, text, text) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('daily-recurring-jobs', '30 0 * * *', $$ select public.generate_recurring_jobs_all(); $$);