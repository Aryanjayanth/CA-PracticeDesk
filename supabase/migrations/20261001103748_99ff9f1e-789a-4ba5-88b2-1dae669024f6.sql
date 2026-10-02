create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  owner_email text,
  phone text,
  city text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create table public.platform_admins (user_id uuid primary key, created_at timestamptz not null default now());
create table public.firm_invites (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'owner',
  full_name text,
  accepted boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, update on public.firms to authenticated; grant all on public.firms to service_role;
grant select on public.platform_admins to authenticated; grant all on public.platform_admins to service_role;
grant select on public.firm_invites to authenticated; grant all on public.firm_invites to service_role;
alter table public.firms enable row level security;
alter table public.platform_admins enable row level security;
alter table public.firm_invites enable row level security;

create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;

alter table public.profiles add column firm_id uuid references public.firms(id), add column acting_firm_id uuid references public.firms(id), add column avatar_url text;

create or replace function public.current_firm_id() returns uuid language sql stable security definer set search_path=public as $$
  select case when public.is_super_admin() then p.acting_firm_id
              else (select f.id from public.firms f where f.id=p.firm_id and f.status='active') end
  from public.profiles p where p.id=auth.uid() $$;

create policy "firms read" on public.firms for select to authenticated using (public.is_super_admin() or id=public.current_firm_id());
create policy "firms upd" on public.firms for update to authenticated using (public.is_super_admin() or (id=public.current_firm_id() and public.is_manager()));
create policy "pa read" on public.platform_admins for select to authenticated using (user_id=auth.uid());
create policy "inv read" on public.firm_invites for select to authenticated using (public.is_super_admin() or (firm_id=public.current_firm_id() and public.is_manager()));

-- role helpers include super admin
create or replace function public.is_finance() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','accountant')) $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin')) $$;
create or replace function public.is_staff_plus() returns boolean language sql stable security definer set search_path=public as $$
  select public.is_super_admin() or exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('owner','admin','accountant','staff')) $$;
create or replace function public.my_roles() returns setof public.app_role language sql stable security definer set search_path=public as $$
  select 'owner'::public.app_role where public.is_super_admin()
  union select role from public.user_roles where user_id=auth.uid() and not public.is_super_admin() $$;

-- default firm + backfill
insert into public.firms(id, name) select '00000000-0000-0000-0000-000000000001', coalesce((select firm_name from public.settings limit 1),'Default Firm');
update public.profiles set firm_id='00000000-0000-0000-0000-000000000001';

alter table public.settings drop constraint if exists settings_id_check;
create sequence if not exists public.settings_seq start 100;
alter table public.settings alter column id set default nextval('public.settings_seq');

do $$ declare t text; begin
  foreach t in array array['clients','services','client_services','jobs','job_status_history','invoices','invoice_items','discounts','payments','payment_allocations','payment_reversals','bank_transactions','audit_logs','settings'] loop
    execute format('alter table public.%I add column firm_id uuid references public.firms(id) default public.current_firm_id()', t);
    execute format('update public.%I set firm_id=%L', t, '00000000-0000-0000-0000-000000000001');
    if t <> 'audit_logs' then execute format('alter table public.%I alter column firm_id set not null', t); end if;
    execute format('create index on public.%I(firm_id)', t);
    execute format('create policy "firm isolation" on public.%I as restrictive for all to authenticated using (firm_id = public.current_firm_id()) with check (firm_id = public.current_firm_id())', t);
  end loop;
end $$;
alter table public.settings add constraint settings_firm_unique unique(firm_id);
grant insert on public.settings to service_role;

create policy "firm isolation" on public.profiles as restrictive for all to authenticated
  using (id=auth.uid() or firm_id=public.current_firm_id()) with check (id=auth.uid() or firm_id=public.current_firm_id());
create policy "firm isolation" on public.user_roles as restrictive for all to authenticated
  using (user_id=auth.uid() or exists(select 1 from public.profiles p where p.id=user_roles.user_id and p.firm_id=public.current_firm_id()))
  with check (exists(select 1 from public.profiles p where p.id=user_roles.user_id and p.firm_id=public.current_firm_id()));

create or replace function public.protect_profile_firm() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (new.firm_id is distinct from old.firm_id or new.acting_firm_id is distinct from old.acting_firm_id)
     and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Not allowed to change firm';
  end if;
  return new;
end $$;
create trigger profiles_protect_firm before update on public.profiles for each row execute function public.protect_profile_firm();

alter table public.clients add column avatar_url text;

-- new user: super admin by email, otherwise pending invite
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare inv record;
begin
  if lower(new.email)='sankaaryanjayanth@gmail.com' then
    insert into public.profiles(id, full_name, email) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'Super Admin'), new.email);
    insert into public.platform_admins(user_id) values (new.id) on conflict do nothing;
    return new;
  end if;
  select * into inv from public.firm_invites where lower(email)=lower(new.email) and not accepted order by created_at desc limit 1;
  insert into public.profiles(id, full_name, email, firm_id)
  values (new.id, coalesce(inv.full_name, new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email, inv.firm_id);
  if inv.id is not null then
    insert into public.user_roles(user_id, role) values (new.id, inv.role) on conflict do nothing;
    update public.firm_invites set accepted=true where id=inv.id;
  end if;
  return new;
end $$;

insert into public.platform_admins(user_id) select id from auth.users where lower(email)='sankaaryanjayanth@gmail.com' on conflict do nothing;
update public.profiles set firm_id=null, acting_firm_id='00000000-0000-0000-0000-000000000001' where lower(email)='sankaaryanjayanth@gmail.com';
delete from public.user_roles where user_id in (select user_id from public.platform_admins);

-- super admin RPCs
create or replace function public.set_acting_firm(_firm_id uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  update public.profiles set acting_firm_id=_firm_id where id=auth.uid();
end $$;

create or replace function public.create_firm(_name text, _owner_email text, _phone text, _city text, _logo_url text) returns uuid language plpgsql security definer set search_path=public as $$
declare fid uuid;
begin
  if not public.is_super_admin() then raise exception 'Not authorised'; end if;
  if coalesce(trim(_name),'')='' then raise exception 'Firm name is required'; end if;
  insert into public.firms(name, owner_email, phone, city, logo_url) values (trim(_name), lower(trim(_owner_email)), _phone, _city, _logo_url) returning id into fid;
  insert into public.settings(firm_id, firm_name, phone, email) values (fid, trim(_name), _phone, lower(trim(_owner_email)));
  return fid;
end $$;

create or replace function public.firm_overview() returns table(id uuid, name text, logo_url text, owner_email text, phone text, city text, status text, created_at timestamptz, users bigint, clients bigint, invoiced numeric, outstanding numeric)
language sql stable security definer set search_path=public as $$
  select f.id, f.name, f.logo_url, f.owner_email, f.phone, f.city, f.status, f.created_at,
    (select count(*) from public.profiles p where p.firm_id=f.id),
    (select count(*) from public.clients c where c.firm_id=f.id),
    (select coalesce(sum(total),0) from public.invoices i where i.firm_id=f.id and i.status<>'cancelled'),
    (select coalesce(sum(total-amount_paid),0) from public.invoices i where i.firm_id=f.id and i.status not in ('cancelled','paid'))
  from public.firms f where public.is_super_admin() order by f.created_at desc $$;

-- firm guards in existing RPCs
create or replace function public.client_lookup() returns table(id uuid, client_code text, name text) language sql stable security definer set search_path=public as $$
  select id, client_code, name from public.clients where status='active' and firm_id=public.current_firm_id()
    and (public.is_finance() or public.is_cashier() or assigned_staff=auth.uid()) order by name $$;

create or replace function public.generate_recurring_jobs(_upto date) returns integer language plpgsql security definer set search_path=public as $$
declare cs record; ps date; pe date; step interval; n int := 0; svc record; lbl text;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  for cs in select * from public.client_services where status='active' and firm_id=public.current_firm_id() loop
    select * into svc from public.services where id=cs.service_id;
    if cs.frequency='one_time' then
      insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (cs.client_id, cs.service_id, cs.id, svc.name, cs.start_date, cs.start_date, cs.agreed_fee, cs.start_date + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      continue;
    end if;
    step := case cs.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months' else interval '1 year' end;
    ps := date_trunc('month', cs.start_date)::date;
    while ps <= _upto and (cs.end_date is null or ps <= cs.end_date) loop
      pe := (ps + step - interval '1 day')::date;
      lbl := case cs.frequency when 'monthly' then to_char(ps,'Mon YYYY') when 'yearly' then 'FY ' || to_char(ps,'YYYY') else to_char(ps,'Mon YYYY') || ' – ' || to_char(pe,'Mon YYYY') end;
      insert into public.jobs(client_id, service_id, client_service_id, title, period_start, period_end, fee, due_date, assigned_staff, created_by)
      values (cs.client_id, cs.service_id, cs.id, svc.name || ' – ' || lbl, ps, pe, cs.agreed_fee, pe + cs.due_days, cs.assigned_staff, auth.uid())
      on conflict do nothing;
      if found then n := n + 1; end if;
      ps := (ps + step)::date;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.firm_guard(_tbl text, _id uuid) returns void language plpgsql stable security definer set search_path=public as $$
declare ok boolean;
begin
  execute format('select exists(select 1 from public.%I where id=$1 and firm_id=public.current_firm_id())', _tbl) into ok using _id;
  if not ok then raise exception 'Record not found in this firm'; end if;
end $$;

create or replace function public.validate_allocation() returns trigger language plpgsql security definer set search_path=public as $$
declare p record; inv record; palloc numeric; ipaid numeric;
begin
  select * into p from public.payments where id=new.payment_id for update;
  select * into inv from public.invoices where id=new.invoice_id for update;
  if p.firm_id <> inv.firm_id or (auth.uid() is not null and p.firm_id is distinct from public.current_firm_id()) then raise exception 'Record not found in this firm'; end if;
  if p.status='reversed' then raise exception 'Payment % is reversed', p.payment_code; end if;
  if inv.status in ('cancelled','draft') then raise exception 'Invoice % is not open for allocation', inv.invoice_no; end if;
  if p.client_id <> inv.client_id then raise exception 'Payment and invoice belong to different clients'; end if;
  select coalesce(sum(amount),0) into palloc from public.payment_allocations where payment_id=p.id and not reversed;
  select coalesce(sum(amount),0) into ipaid from public.payment_allocations where invoice_id=inv.id and not reversed;
  if palloc + new.amount > p.amount then raise exception 'Allocation exceeds available payment amount (available %)', p.amount - palloc; end if;
  if ipaid + new.amount > inv.total then raise exception 'Allocation exceeds invoice % outstanding (outstanding %)', inv.invoice_no, inv.total - ipaid; end if;
  new.firm_id := p.firm_id;
  return new;
end $$;

create or replace function public.cancel_invoice(_invoice_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('invoices', _invoice_id);
  if coalesce(trim(_reason),'')='' then raise exception 'Reason is required'; end if;
  if exists(select 1 from public.payment_allocations where invoice_id=_invoice_id and not reversed) then raise exception 'Reverse allocations on this invoice first'; end if;
  update public.invoices set status='cancelled', cancel_reason=_reason where id=_invoice_id;
  update public.jobs set financial_status='open' where id in (select job_id from public.invoice_items where invoice_id=_invoice_id);
end $$;

create or replace function public.reverse_allocation(_allocation_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('payment_allocations', _allocation_id);
  update public.payment_allocations set reversed=true, reversed_at=now() where id=_allocation_id and not reversed;
  insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'allocation_reversed','payment_allocations',_allocation_id::text,_reason);
end $$;

create or replace function public.reverse_payment(_payment_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('payments', _payment_id);
  if coalesce(trim(_reason),'') = '' then raise exception 'Reason is required'; end if;
  if exists(select 1 from public.payments where id=_payment_id and status='reversed') then raise exception 'Already reversed'; end if;
  update public.payments set status='reversed' where id=_payment_id;
  for r in select id from public.payment_allocations where payment_id=_payment_id and not reversed loop
    update public.payment_allocations set reversed=true, reversed_at=now() where id=r.id;
  end loop;
  insert into public.payment_reversals(payment_id, reason, reversed_by) values (_payment_id, _reason, auth.uid());
  perform public.recalc_payment(_payment_id);
end $$;

create or replace function public.update_job_status(_job_id uuid, _status text, _reason text) returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.firm_guard('jobs', _job_id);
  if not (public.is_finance() or exists(select 1 from public.jobs where id=_job_id and assigned_staff=auth.uid())) then raise exception 'Not authorised'; end if;
  perform set_config('app.status_reason', coalesce(_reason,''), true);
  update public.jobs set status=_status where id=_job_id;
end $$;

create or replace function public.allocate_payment(_payment_id uuid, _allocations jsonb) returns void language plpgsql security definer set search_path=public as $$
declare a jsonb;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('payments', _payment_id);
  for a in select * from jsonb_array_elements(_allocations) loop
    if (a->>'amount')::numeric > 0 then
      insert into public.payment_allocations(payment_id, invoice_id, amount, allocated_by) values (_payment_id, (a->>'invoice_id')::uuid, (a->>'amount')::numeric, auth.uid());
    end if;
  end loop;
end $$;

create or replace function public.create_invoice(_client_id uuid, _job_ids uuid[], _invoice_date date, _due_date date, _discount numeric, _discount_reason text, _tax_rate numeric, _notes text, _extra_desc text, _extra_amount numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare inv_id uuid; sub numeric := 0; j record; tax numeric; tot numeric;
begin
  if not public.is_finance() then raise exception 'Not authorised'; end if;
  perform public.firm_guard('clients', _client_id);
  insert into public.invoices(client_id, invoice_date, due_date, notes, created_by) values (_client_id, _invoice_date, _due_date, _notes, auth.uid()) returning id into inv_id;
  for j in select * from public.jobs where id = any(coalesce(_job_ids,'{}')) loop
    if j.client_id <> _client_id then raise exception 'Job % belongs to another client', j.job_code; end if;
    if j.status='cancelled' then raise exception 'Job % is cancelled', j.job_code; end if;
    if exists(select 1 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.job_id=j.id and i.status<>'cancelled') then raise exception 'Job % is already invoiced', j.job_code; end if;
    insert into public.invoice_items(invoice_id, job_id, description, amount) values (inv_id, j.id, j.title, j.net_amount);
    sub := sub + j.net_amount;
  end loop;
  if coalesce(_extra_amount,0) > 0 then
    insert into public.invoice_items(invoice_id, description, amount) values (inv_id, coalesce(nullif(_extra_desc,''),'Professional fees'), _extra_amount);
    sub := sub + _extra_amount;
  end if;
  if sub <= 0 then raise exception 'Invoice must have at least one item'; end if;
  if coalesce(_discount,0) > sub then raise exception 'Discount cannot exceed subtotal'; end if;
  tax := round((sub - coalesce(_discount,0)) * coalesce(_tax_rate,0) / 100, 2);
  tot := sub - coalesce(_discount,0) + tax;
  update public.invoices set subtotal=sub, discount=coalesce(_discount,0), tax_rate=coalesce(_tax_rate,0), tax_amount=tax, total=tot,
    description=(select string_agg(description, ', ') from public.invoice_items where invoice_id=inv_id) where id=inv_id;
  if coalesce(_discount,0) > 0 then
    insert into public.discounts(invoice_id, original_amount, discount_amount, net_amount, reason, approved_by) values (inv_id, sub, _discount, sub-_discount, _discount_reason, auth.uid());
  end if;
  update public.jobs set financial_status='invoiced' where id = any(coalesce(_job_ids,'{}'));
  return inv_id;
end $$;

-- avatars storage policies
create policy "avatars public read" on storage.objects for select using (bucket_id='avatars');
create policy "avatars auth upload" on storage.objects for insert to authenticated with check (bucket_id='avatars');
create policy "avatars auth update" on storage.objects for update to authenticated using (bucket_id='avatars');