-- ========================================================
-- Migration: Auto-Invoicing & Linked Status Enhancement
-- ========================================================

-- 1. Add auto_invoice columns
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE public.client_services ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS auto_invoice boolean NOT NULL DEFAULT false;

-- 2. Update generate_recurring_jobs to inherit auto_invoice from client_services
CREATE OR REPLACE FUNCTION public.generate_recurring_jobs(_upto date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  cs record;
  ps date;
  pe date;
  step interval;
  n int := 0;
  svc record;
  lbl text;
BEGIN
  IF NOT public.is_finance() THEN RAISE EXCEPTION 'Not authorised'; END IF;
  FOR cs IN
    SELECT cs.*, c.name AS client_name, s.name AS service_name, s.due_days AS svc_due_days, s.auto_invoice AS svc_auto_invoice
    FROM public.client_services cs
    JOIN public.clients c ON c.id = cs.client_id
    JOIN public.services s ON s.id = cs.service_id
    WHERE cs.status = 'active' AND (cs.end_date IS NULL OR cs.end_date >= cs.start_date)
  LOOP
    ps := cs.start_date;
    step := CASE cs.frequency
      WHEN 'monthly' THEN interval '1 month'
      WHEN 'quarterly' THEN interval '3 month'
      WHEN 'half_yearly' THEN interval '6 month'
      WHEN 'yearly' THEN interval '1 year'
      ELSE interval '1 month'
    END;

    WHILE ps <= _upto AND (cs.end_date IS NULL OR ps <= cs.end_date) LOOP
      pe := (ps + step - interval '1 day')::date;
      IF pe > _upto THEN EXIT; END IF;

      lbl := cs.service_name || ' – ' || to_char(ps, 'Mon YYYY');

      IF NOT EXISTS (
        SELECT 1 FROM public.jobs
        WHERE client_service_id = cs.id AND period_start = ps
      ) THEN
        INSERT INTO public.jobs(
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
          status,
          financial_status,
          auto_invoice
        ) VALUES (
          cs.firm_id,
          cs.client_id,
          cs.service_id,
          cs.id,
          lbl,
          ps,
          pe,
          cs.agreed_fee,
          0,
          (pe + COALESCE(cs.due_days, 20)),
          cs.assigned_staff,
          'pending',
          'open',
          COALESCE(cs.auto_invoice, false)
        );
        n := n + 1;
      END IF;

      ps := (ps + step)::date;
    END LOOP;
  END LOOP;
  RETURN n;
END;
$$;

-- 3. Auto-invoice generation helper function
CREATE OR REPLACE FUNCTION public.auto_invoice_job(_job_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  j record;
  inv_id uuid;
  item_desc text;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = _job_id;
  IF j.id IS NULL OR j.financial_status <> 'open' OR j.net_amount <= 0 THEN
    RETURN NULL;
  END IF;

  -- Ensure not already invoiced
  IF EXISTS (
    SELECT 1 FROM public.invoice_items ii
    JOIN public.invoices i ON i.id = ii.invoice_id
    WHERE ii.job_id = j.id AND i.status <> 'cancelled'
  ) THEN
    UPDATE public.jobs SET financial_status = 'invoiced' WHERE id = _job_id;
    RETURN NULL;
  END IF;

  item_desc := j.title;

  INSERT INTO public.invoices (
    firm_id,
    client_id,
    invoice_date,
    due_date,
    notes,
    description,
    subtotal,
    discount,
    tax_rate,
    tax_amount,
    total,
    amount_paid,
    status,
    created_by
  ) VALUES (
    COALESCE(j.firm_id, public.current_firm_id()),
    j.client_id,
    current_date,
    current_date + 15,
    'Auto-generated invoice on completion of job ' || j.job_code,
    item_desc,
    j.net_amount,
    0,
    0,
    0,
    j.net_amount,
    0,
    'unpaid',
    COALESCE(auth.uid(), j.created_by)
  ) RETURNING id INTO inv_id;

  INSERT INTO public.invoice_items (
    firm_id,
    invoice_id,
    job_id,
    description,
    amount
  ) VALUES (
    COALESCE(j.firm_id, public.current_firm_id()),
    inv_id,
    j.id,
    item_desc,
    j.net_amount
  );

  UPDATE public.jobs
  SET financial_status = 'invoiced'
  WHERE id = _job_id;

  RETURN inv_id;
END;
$$;

-- 4. Update update_job_status to trigger auto-invoice on completion
CREATE OR REPLACE FUNCTION public.update_job_status(_job_id uuid, _status text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  j record;
BEGIN
  PERFORM public.firm_guard('jobs', _job_id);
  IF NOT (public.is_finance() OR EXISTS(SELECT 1 FROM public.jobs WHERE id = _job_id AND assigned_staff = auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  PERFORM set_config('app.status_reason', COALESCE(_reason, ''), true);
  UPDATE public.jobs SET status = _status WHERE id = _job_id;

  IF _status = 'completed' THEN
    SELECT * INTO j FROM public.jobs WHERE id = _job_id;
    IF j.auto_invoice AND j.financial_status = 'open' THEN
      PERFORM public.auto_invoice_job(_job_id);
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_invoice_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_job_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_jobs(date) TO authenticated;
