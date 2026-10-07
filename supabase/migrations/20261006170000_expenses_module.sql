/* ==========================================================================
   Expenses module: one ledger for every kind of money the firm leaves, and a
   read-only view of it on the job's Payment Clearing screen.

   Why a "kind" column: the two cases behave differently and mixing them in one
   undifferentiated list makes the total meaningless. An overhead (rent,
   stationery) is the firm's own cost. A "tax" row is TDS deducted from a client
   and remitted to the government on their behalf, so it leaves the bank but was
   never the firm's money. A reimbursement is money paid out on a client's
   behalf and rebilled to them. Only overhead is a true cost, so the reporting
   groups by kind rather than pretending the sum is a single number.

   Two rules this file is responsible for:

   1. Expenses answer to the permission matrix, not to the old fixed roles. The
      job-payment workflow migration created these policies before role_permissions
      existed, so without this file the Expenses page would ignore the Admin's
      choices entirely.

   2. Expense amounts are masked server-side by expenses_list(), for the same
      reason payments and jobs are: RLS cannot hide a column, so a role that may
      see the record would otherwise still receive every amount.

   Deletion goes through delete_expense(id, reason) rather than a plain DELETE,
   because nothing references an expense row and no other table would leave a
   trace of its removal. A reason is mandatory and lands in audit_logs.

   Paste-safe: no line comments and no blank lines, because the Supabase SQL
   editor strips newlines and would otherwise swallow the rest of the script.
   ========================================================================== */
alter table public.expenses add column if not exists kind text not null default 'overhead';
alter table public.expenses drop constraint if exists expenses_kind_check;
alter table public.expenses add constraint expenses_kind_check check (kind in ('overhead','tax','reimbursement'));
create index if not exists expenses_job_idx2 on public.expenses(job_id);
create index if not exists expenses_kind_idx on public.expenses(firm_id, kind, expense_date desc);
drop policy if exists "expenses read" on public.expenses;
drop policy if exists "expenses write" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated using (public.has_capability('expenses','view'));
create policy "expenses ins" on public.expenses for insert to authenticated with check (public.has_capability('expenses','create'));
create policy "expenses upd" on public.expenses for update to authenticated using (public.has_capability('expenses','edit')) with check (public.has_capability('expenses','edit'));
/* A direct DELETE is never granted; the RPC below is the only route, so the
   mandatory reason cannot be bypassed. */
revoke delete on public.expenses from authenticated;
drop policy if exists "recurring_payments read" on public.recurring_payments;
drop policy if exists "recurring_payments write" on public.recurring_payments;
create policy "recurring_payments read" on public.recurring_payments for select to authenticated using (public.has_capability('recurring','view'));
create policy "recurring_payments ins" on public.recurring_payments for insert to authenticated with check (public.has_capability('recurring','create'));
create policy "recurring_payments upd" on public.recurring_payments for update to authenticated using (public.has_capability('recurring','edit')) with check (public.has_capability('recurring','edit'));
create or replace function public.expenses_list() returns table(id uuid, kind text, expense_date date, category text, description text, amount numeric, mode text, reference text, paid_to text, notes text, client_id uuid, client_name text, job_id uuid, job_code text, created_at timestamptz) language sql stable security definer set search_path=public as $$ select e.id, e.kind, e.expense_date, e.category, e.description, case when public.has_capability('expenses','amounts') then e.amount end, e.mode, e.reference, e.paid_to, e.notes, e.client_id, c.name, e.job_id, j.job_code, e.created_at from public.expenses e left join public.clients c on c.id=e.client_id left join public.jobs j on j.id=e.job_id where e.firm_id=public.current_firm_id() and public.has_capability('expenses','view') order by e.expense_date desc, e.created_at desc $$;
/* Read-only projection for the Payment Clearing screen. It reports what has been
   recorded against the job but deliberately does not feed job_clearing, so an
   expense can never move final_amount or the invoice total behind the user's back. */
create or replace function public.expenses_for_job(_job_id uuid) returns table(id uuid, kind text, category text, description text, amount numeric, mode text, paid_to text, reference text, expense_date date) language sql stable security definer set search_path=public as $$ select e.id, e.kind, e.category, e.description, case when public.has_capability('expenses','amounts') then e.amount end, e.mode, e.paid_to, e.reference, e.expense_date from public.expenses e where e.job_id=_job_id and e.firm_id=public.current_firm_id() and public.has_capability('expenses','view') order by e.expense_date desc $$;
create or replace function public.delete_expense(_expense_id uuid, _reason text) returns void language plpgsql security definer set search_path=public as $$ begin if not public.has_capability('expenses','delete') then raise exception 'Not authorised'; end if; if coalesce(btrim(_reason),'')='' then raise exception 'Reason is required'; end if; perform public.firm_guard('expenses', _expense_id); delete from public.expenses where id=_expense_id; insert into public.audit_logs(user_id, action, module, record_id, reason) values (auth.uid(),'expense_deleted','expenses',_expense_id::text,_reason); end $$;
grant execute on function public.expenses_list(), public.expenses_for_job(uuid), public.delete_expense(uuid, text) to authenticated;