-- Add OTP support to firm_invites
alter table public.firm_invites add column if not exists otp_code text;
alter table public.firm_invites add column if not exists otp_expires_at timestamptz default (now() + interval '7 days');
