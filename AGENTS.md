# PracticeDesk — System Architecture & Rules

## Architecture rules
- All business rules (allocation limits, auto-close, reversal, recurring de-dup, invoice totals) live in Postgres triggers/RPCs; the UI calls RPCs and never writes financial totals directly — why: rules must hold regardless of client.
- Role permissions are enforced via `user_roles` + RLS helper functions (`is_finance`, `is_manager`, `is_cashier`); UI role checks are cosmetic only — why: cashier/staff isolation must not depend on hidden screens.
- Financial tables have no DELETE grants; corrections are cancel/reverse RPCs — why: no permanent financial deletion.
- Overdue status for jobs/invoices is derived at read time from due dates, not stored — why: avoids scheduled jobs.
- tsconfig relaxes noPropertyAccessFromIndexSignature/exactOptionalPropertyTypes/noUncheckedIndexedAccess/noImplicitReturns — why: keep form/record code readable.
- Multi-tenant: every business table has firm_id defaulting to current_firm_id() with a RESTRICTIVE RLS policy; super admins (platform_admins) act inside one firm via profiles.acting_firm_id — why: hard data isolation between firms without changing every query.
- Firm users join only via firm_invites consumed in handle_new_user (never signup metadata) — why: signup metadata is user-controlled.
- Avatars/logos are stored as small resized data URLs in text columns — why: public storage buckets are blocked.
- Recurring jobs are generated daily for all active firms by a pg_cron job calling generate_recurring_jobs_all (also on app open) — why: jobs must appear without anyone opening the app.
- Auto-invoicing: When a job is marked completed with auto_invoice enabled, public.auto_invoice_job RPC runs as security definer to generate the invoice and link invoice_items without exposing direct invoice creation grants to staff — why: maintains strict finance isolation while automating billing.
