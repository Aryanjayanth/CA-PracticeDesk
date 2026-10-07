-- ==============================================================================
-- CA PracticeDesk — Reset / Clear All Test Data Script
-- Preserves: Super Admin (platform_admins), Firms, Users, Roles & Permissions, Master Services
-- Wipes: All test clients, jobs, payments, invoices, expenses & transactional ledger
-- ==============================================================================

do $$
declare
  r record;
begin
  -- 1. Wipe Financial Allocations & Reversals
  delete from public.payment_allocations;
  delete from public.payment_reversals;
  
  -- 2. Wipe Invoices & Line Items
  delete from public.invoice_items;
  delete from public.invoices;

  -- 3. Wipe Payments
  delete from public.payments;

  -- 4. Wipe Job Clearing & Status Logs
  delete from public.job_clearing;
  delete from public.job_status_history;

  -- 5. Wipe Expenses
  delete from public.expenses;

  -- 6. Wipe Jobs
  delete from public.jobs;

  -- 7. Wipe Client Assignments & Clients
  delete from public.client_services;
  delete from public.client_contacts;
  delete from public.clients;

  -- 8. Wipe Bank Transactions & Audit Logs
  delete from public.bank_transactions;
  delete from public.discounts;
  delete from public.audit_logs where action not in ('role_permission_set', 'system_init');

  -- 9. Reset Sequential Document Counters in doc_sequences (if present)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'doc_sequences') then
    update public.doc_sequences set current_val = 0;
  end if;

  -- 10. Reset Postgres Sequences back to 1
  for r in (
    select sequence_name 
    from information_schema.sequences 
    where sequence_schema = 'public' 
      and sequence_name in ('client_seq', 'job_seq', 'invoice_seq', 'payment_seq', 'expense_seq', 'service_seq')
  ) loop
    execute format('alter sequence public.%I restart with 1;', r.sequence_name);
  end loop;

  raise notice 'All test transaction data successfully purged. Super Admin, Roles, and Settings preserved.';
end $$;
