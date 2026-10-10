-- ========================================================
-- Migration: Multi-Firm Management, Recurring Jobs & Doc Numbering
-- ========================================================

-- 1. Make Primary Concerned Person mandatory in validation trigger
CREATE OR REPLACE FUNCTION public.validate_client_required() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare
  v_missing text;
begin
  v_missing := concat_ws(', ',
    case when btrim(coalesce(new.name, '')) = ''                 then 'Client Name' end,
    case when btrim(coalesce(new.client_type, '')) = ''           then 'Client Type' end,
    case when btrim(coalesce(new.address, '')) = ''               then 'Address' end,
    case when btrim(coalesce(new.mobile, '')) = ''                then 'Phone Number' end,
    case when btrim(coalesce(new.contact_person_name, '')) = ''   then 'Primary Concerned Person' end
  );
  if v_missing <> '' then
    raise exception 'Missing required field(s): %', v_missing using errcode = '23502';
  end if;
  return new;
end $$;

-- 2. Resilient Doc Numbering with explicit firm_id fallback
DROP FUNCTION IF EXISTS public.next_doc_code(text, date, uuid);
DROP FUNCTION IF EXISTS public.next_doc_code(text, date);

CREATE OR REPLACE FUNCTION public.next_doc_code(_kind text, _on date, _firm_id uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare
  v_period text;
  v_no int;
  v_firm_id uuid;
begin
  if _kind not in ('INV','REC','JOB') then
    raise exception 'Unknown document kind: %', _kind;
  end if;

  v_period := to_char(coalesce(_on, current_date), 'MMYY');
  v_firm_id := coalesce(
    _firm_id,
    public.current_firm_id(),
    (select firm_id from public.profiles where id = auth.uid()),
    (select id from public.firms where status = 'active' order by created_at limit 1)
  );

  if v_firm_id is null then
    raise exception 'Cannot generate doc code: No active firm found';
  end if;

  insert into public.doc_counters as c (firm_id, kind, period, last_no)
  values (v_firm_id, _kind, v_period, 1)
  on conflict (firm_id, kind, period) do update set last_no = c.last_no + 1
  returning last_no into v_no;

  return _kind || lpad(v_no::text, 4, '0') || '-' || v_period;
end $$;

CREATE OR REPLACE FUNCTION public.stamp_job_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.job_code is null then
    new.job_code := public.next_doc_code('JOB', coalesce(new.created_at::date, current_date), new.firm_id);
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.stamp_invoice_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.invoice_no is null then
    new.invoice_no := public.next_doc_code('INV', coalesce(new.invoice_date, current_date), new.firm_id);
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.stamp_payment_doc_no() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.payment_code is null then
    new.payment_code := public.next_doc_code('REC', coalesce(new.payment_date, current_date), new.firm_id);
  end if;
  return new;
end $$;

-- 3. Automatic firm_id inheritance triggers for jobs and client_services
CREATE OR REPLACE FUNCTION public.stamp_client_service_firm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.firm_id is null then
    new.firm_id := coalesce(
      (select firm_id from public.clients where id = new.client_id),
      public.current_firm_id(),
      (select firm_id from public.profiles where id = auth.uid())
    );
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS client_services_stamp_firm ON public.client_services;
CREATE TRIGGER client_services_stamp_firm BEFORE INSERT ON public.client_services
FOR EACH ROW EXECUTE FUNCTION public.stamp_client_service_firm();

CREATE OR REPLACE FUNCTION public.stamp_job_firm() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
begin
  if new.firm_id is null then
    new.firm_id := coalesce(
      (select firm_id from public.clients where id = new.client_id),
      public.current_firm_id(),
      (select firm_id from public.profiles where id = auth.uid())
    );
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS jobs_stamp_firm ON public.jobs;
CREATE TRIGGER jobs_stamp_firm BEFORE INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.stamp_job_firm();

-- 4. Enhanced recurring jobs generator
DROP FUNCTION IF EXISTS public.generate_recurring_jobs_for_firm(uuid, date);
DROP FUNCTION IF EXISTS public.generate_recurring_jobs(date);
DROP FUNCTION IF EXISTS public.generate_recurring_jobs_all();

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_for_firm(_firm uuid, _upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  r_cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
  target_upto date;
  target_firm uuid;
begin
  target_upto := coalesce(_upto, current_date);
  target_firm := coalesce(
    _firm,
    public.current_firm_id(),
    (select firm_id from public.profiles where id = auth.uid()),
    (select id from public.firms where status = 'active' order by created_at limit 1)
  );

  if target_firm is null then
    return 0;
  end if;

  for r_cs in
    select *
    from public.client_services
    where status = 'active'
      and (
        firm_id = target_firm
        or firm_id is null
        or coalesce(firm_id, (select c.firm_id from public.clients c where c.id = client_services.client_id)) = target_firm
      )
      and (end_date is null or end_date >= start_date)
  loop
    select * into svc from public.services where id = r_cs.service_id;
    if svc.id is null then continue; end if;

    if r_cs.frequency = 'one_time' then
      if not exists (
        select 1 from public.jobs
        where client_service_id = r_cs.id
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
          coalesce(r_cs.firm_id, target_firm),
          r_cs.client_id,
          r_cs.service_id,
          r_cs.id,
          svc.name,
          r_cs.start_date,
          r_cs.start_date,
          coalesce(r_cs.agreed_fee, 0),
          0,
          r_cs.start_date + coalesce(r_cs.due_days, 0),
          r_cs.assigned_staff,
          coalesce(auth.uid(), r_cs.assigned_staff),
          coalesce(r_cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        )
        on conflict (client_service_id, period_start) do nothing;
        if found then n := n + 1; end if;
      end if;
      continue;
    end if;

    step := case r_cs.frequency
      when 'monthly' then interval '1 month'
      when 'quarterly' then interval '3 months'
      when 'half_yearly' then interval '6 months'
      else interval '1 year'
    end;

    ps := date_trunc('month', r_cs.start_date)::date;

    while ps <= target_upto and (r_cs.end_date is null or ps <= r_cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case r_cs.frequency
        when 'monthly' then to_char(ps, 'Mon YYYY')
        when 'yearly' then 'FY ' || to_char(ps, 'YYYY')
        else to_char(ps, 'Mon YYYY') || ' – ' || to_char(pe, 'Mon YYYY')
      end;

      if not exists (
        select 1 from public.jobs
        where client_service_id = r_cs.id and period_start = ps
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
          coalesce(r_cs.firm_id, target_firm),
          r_cs.client_id,
          r_cs.service_id,
          r_cs.id,
          svc.name || ' – ' || lbl,
          ps,
          pe,
          coalesce(r_cs.agreed_fee, 0),
          0,
          pe + coalesce(r_cs.due_days, 0),
          r_cs.assigned_staff,
          coalesce(auth.uid(), r_cs.assigned_staff),
          coalesce(r_cs.auto_invoice, svc.auto_invoice, false),
          'pending',
          'open'
        )
        on conflict (client_service_id, period_start) do nothing;
        if found then n := n + 1; end if;
      end if;

      ps := (ps + step)::date;
    end loop;
  end loop;

  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  target_firm uuid;
begin
  if not (
    public.has_capability('recurring', 'edit')
    or public.is_manager()
    or public.is_finance()
    or public.has_capability('jobs', 'create')
  ) then
    raise exception 'Not authorised';
  end if;

  target_firm := coalesce(
    public.current_firm_id(),
    (select firm_id from public.profiles where id = auth.uid()),
    (select id from public.firms where status = 'active' order by created_at limit 1)
  );

  return public.generate_recurring_jobs_for_firm(target_firm, coalesce(_upto, current_date));
end $function$;

CREATE OR REPLACE FUNCTION public.generate_recurring_jobs_all()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  f record;
  n int := 0;
begin
  for f in select id from public.firms where status = 'active' loop
    n := n + public.generate_recurring_jobs_for_firm(f.id, current_date);
  end loop;
  return n;
end $function$;

-- 5. Multi-Firm Management: Support current_firm_id and set_acting_firm for all firm members
DROP FUNCTION IF EXISTS public.set_acting_firm(uuid);

CREATE OR REPLACE FUNCTION public.current_firm_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select case
    when public.is_super_admin() then p.acting_firm_id
    when p.acting_firm_id is not null and exists (
      select 1 from public.firms f where f.id = p.acting_firm_id and f.status = 'active'
    ) then p.acting_firm_id
    else (select f.id from public.firms f where f.id = p.firm_id and f.status = 'active')
  end
  from public.profiles p where p.id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.set_acting_firm(_firm_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if _firm_id is not null then
    if not (
      public.is_super_admin()
      or exists (select 1 from public.profiles where id = auth.uid() and (firm_id = _firm_id or acting_firm_id = _firm_id))
      or exists (select 1 from public.firms where id = _firm_id and lower(owner_email) = lower(auth.jwt()->>'email'))
      or exists (select 1 from public.firm_invites fi where fi.firm_id = _firm_id and lower(fi.email) = lower(auth.jwt()->>'email'))
    ) then
      raise exception 'Not authorised to switch to this firm';
    end if;
  end if;

  update public.profiles set acting_firm_id = _firm_id where id = auth.uid();
end $$;

-- 6. User Firms List RPC
DROP FUNCTION IF EXISTS public.user_firms_list();

CREATE OR REPLACE FUNCTION public.user_firms_list()
RETURNS TABLE (
  id uuid,
  name text,
  logo_url text,
  owner_email text,
  phone text,
  city text,
  status text,
  role public.app_role,
  is_current boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select distinct
    f.id,
    f.name,
    f.logo_url,
    f.owner_email,
    f.phone,
    f.city,
    f.status,
    coalesce(ur.role, case when lower(f.owner_email) = lower(auth.jwt()->>'email') then 'admin'::public.app_role else 'staff'::public.app_role end) as role,
    (f.id = public.current_firm_id()) as is_current
  from public.firms f
  left join public.profiles p on p.id = auth.uid()
  left join public.user_roles ur on ur.user_id = auth.uid()
  where f.status = 'active'
    and (
      public.is_super_admin()
      or f.id = p.firm_id
      or f.id = p.acting_firm_id
      or lower(f.owner_email) = lower(auth.jwt()->>'email')
      or exists (select 1 from public.firm_invites fi where fi.firm_id = f.id and lower(fi.email) = lower(auth.jwt()->>'email'))
    )
  order by f.name asc;
$$;

-- 7. Register Firm RPC
DROP FUNCTION IF EXISTS public.register_firm(text, text, text, text, text, text, text, text, numeric);

CREATE OR REPLACE FUNCTION public.register_firm(
  _name text,
  _phone text DEFAULT NULL,
  _city text DEFAULT NULL,
  _logo_url text DEFAULT NULL,
  _address text DEFAULT NULL,
  _gstin text DEFAULT NULL,
  _pan text DEFAULT NULL,
  _bank_details text DEFAULT NULL,
  _default_tax_rate numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  fid uuid;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(trim(_name), '') = '' then
    raise exception 'Firm name is required';
  end if;

  user_email := lower(trim(coalesce(auth.jwt()->>'email', '')));

  -- 1. Create firm record
  insert into public.firms(name, owner_email, phone, city, logo_url, status)
  values (trim(_name), user_email, _phone, _city, _logo_url, 'active')
  returning id into fid;

  -- 2. Create firm settings
  insert into public.settings(
    firm_id,
    firm_name,
    address,
    gstin,
    pan,
    phone,
    email,
    bank_details,
    default_tax_rate
  ) values (
    fid,
    trim(_name),
    _address,
    _gstin,
    _pan,
    _phone,
    user_email,
    _bank_details,
    coalesce(_default_tax_rate, 0)
  );

  -- 3. Ensure role exists for the user
  if not exists (select 1 from public.user_roles where user_id = auth.uid()) then
    insert into public.user_roles(user_id, role)
    values (auth.uid(), 'admin'::public.app_role);
  end if;

  -- 4. Seed role permissions for this firm
  perform public.seed_role_permissions(fid);

  -- 5. Switch user's active firm to the newly created firm
  update public.profiles set acting_firm_id = fid where id = auth.uid();

  return fid;
end $$;

-- 8. Function grants
GRANT EXECUTE ON FUNCTION public.user_firms_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_firm(text, text, text, text, text, text, text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_acting_firm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs_for_firm(uuid, date) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs_all() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_doc_code(text, date, uuid) TO authenticated, service_role;
