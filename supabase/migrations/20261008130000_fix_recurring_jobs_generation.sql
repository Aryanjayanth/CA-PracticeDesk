-- ========================================================
-- Migration: Fix Recurring Jobs Generation & Populating
-- ========================================================

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
begin
  for cs in
    select cs.*
    from public.client_services cs
    where cs.status = 'active'
      and cs.firm_id = _firm
      and (cs.end_date is null or cs.end_date >= cs.start_date)
  loop
    select * into svc from public.services where id = cs.service_id;
    if svc.id is null then continue; end if;

    if cs.frequency = 'one_time' then
      if not exists (
        select 1 from public.jobs
        where client_service_id = cs.id
      ) then
        insert into public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          created_by,
          auto_invoice,
          status,
          financial_status
        ) values (
          _firm,
          cs.client_id,
          cs.service_id,
          cs.id,
          svc.name,
          cs.start_date,
          cs.start_date,
          coalesce(cs.agreed_fee, 0),
          0,
          cs.start_date + coalesce(cs.due_days, 0),
          cs.assigned_staff,
          auth.uid(),
          coalesce(cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        );
        n := n + 1;
      end if;
      continue;
    end if;

    step := case cs.frequency
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'half_yearly' then interval '6 months'
      else interval '1 year'
    end;

    ps := date_trunc('month', cs.start_date)::date;

    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency
        when 'monthly' then to_char(ps, 'Mon YYYY')
        when 'yearly' then 'FY ' || to_char(ps, 'YYYY')
        else to_char(ps, 'Mon YYYY') || ' – ' || to_char(pe, 'Mon YYYY')
      end;

      if not exists (
        select 1 from public.jobs
        where client_service_id = cs.id and period_start = ps
      ) then
        insert into public.jobs(
          firm_id,
          client_id,
          service_id,
          client_service_id,
          title,
          period_start,
          period_end,
          fee,
          discount,
          due_date,
          assigned_staff,
          created_by,
          auto_invoice,
          status,
          financial_status
        ) values (
          _firm,
          cs.client_id,
          cs.service_id,
          cs.id,
          svc.name || ' – ' || lbl,
          ps,
          pe,
          coalesce(cs.agreed_fee, 0),
          0,
          pe + coalesce(cs.due_days, 0),
          cs.assigned_staff,
          auth.uid(),
          coalesce(cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        );
        n := n + 1;
      end if;

      ps := (ps + step)::date;
    end loop;
  end loop;

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
begin
  if not (public.has_capability('recurring', 'edit') or public.is_manager() or public.is_finance()) then
    raise exception 'Not authorised';
  end if;
  return public.generate_recurring_jobs_for_firm(public.current_firm_id(), _upto);
end $function$;

GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs_for_firm(uuid, date) TO service_role;
