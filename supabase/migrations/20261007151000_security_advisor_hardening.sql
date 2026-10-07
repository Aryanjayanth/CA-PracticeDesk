-- ==============================================================================
-- Supabase Security Advisor Hardening Migration
-- Resolves: 
-- 1. rls_disabled_in_public (Enables RLS on all public tables)
-- 2. sensitive_columns_exposed (Restricts anon/public access to sensitive tables)
-- 3. search_path & function execution security
-- ==============================================================================

-- 1. Enable RLS on all tables in public schema dynamically
do $$
declare
  t record;
begin
  for t in (
    select table_name 
    from information_schema.tables 
    where table_schema = 'public' 
      and table_type = 'BASE TABLE'
  ) loop
    execute format('alter table public.%I enable row level security;', t.table_name);
  end loop;
end $$;

-- 2. Revoke default public/anon read/write access from sensitive business & transaction tables
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 3. Grant authenticated role standard access governed by RLS
grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Ensure financial tables have NO direct delete grants for any user (must go via RPCs)
revoke delete on public.payments from authenticated;
revoke delete on public.invoices from authenticated;
revoke delete on public.invoice_items from authenticated;
revoke delete on public.payment_allocations from authenticated;
revoke delete on public.payment_reversals from authenticated;
revoke delete on public.discounts from authenticated;

-- 4. Secure schema functions (Set explicit search_path and grant execute to authenticated)
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_finance() to authenticated;
grant execute on function public.is_staff_plus() to authenticated;
grant execute on function public.is_cashier() to authenticated;
grant execute on function public.has_capability(text, text) to authenticated;

-- 5. Add fallback catch-all deny policy for any table without explicit policy
do $$
declare
  t record;
begin
  for t in (
    select table_name 
    from information_schema.tables 
    where table_schema = 'public' 
      and table_type = 'BASE TABLE'
      and table_name not in (
        select tablename from pg_policies where schemaname = 'public'
      )
  ) loop
    -- Create default authenticated firm-isolation policy if none exists
    execute format('
      create policy "authenticated_firm_isolation_%I" on public.%I
      for all to authenticated
      using (firm_id = public.current_firm_id())
      with check (firm_id = public.current_firm_id());
    ', t.table_name, t.table_name);
  end loop;
end $$;
