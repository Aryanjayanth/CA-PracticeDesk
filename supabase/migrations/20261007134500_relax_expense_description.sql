-- Relax expense description requirement
alter table public.expenses alter column description drop not null;
alter table public.expenses alter column description set default '';
