-- =====================================================================
-- Trabajadores: los CORES NO SE DIVIDEN, se divide el DINERO (pedido del dueño, 2026-11-19).
--  Ej.: Juan y Juliana arman 200 cores de 12,5 a $100 → cada uno queda con 200 cores
--  y $10.000 (=$20.000 / 2). Antes se repartían los cores (100 y 100).
--  - worker_earnings.shared_with: entre cuántas personas se repartió el valor de la línea
--    (units sigue siendo el total de cores del trabajo; amount = parte del dinero).
--  - fn_create_worker_earnings: ignora "units" por persona (compatibilidad con la app 1.3.0)
--    y reparte el valor total en partes iguales (el residuo de pesos va a los primeros).
--  - reassign_worker_earning: reparte el dinero en partes iguales, o por "amount" si se indica
--    para TODAS las personas (debe sumar el valor de la línea).
--  - add_worker_earnings: trabajo manual para VARIAS personas (partes iguales o valores propios).
-- =====================================================================
ALTER TABLE public.worker_earnings
  ADD COLUMN IF NOT EXISTS shared_with integer NOT NULL DEFAULT 1 CHECK (shared_with >= 1);

-- Personas únicas y activas de una lista jsonb [{worker_id, ...}]
CREATE OR REPLACE FUNCTION public.fn_worker_ids(p_people jsonb, p_label text)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_ids uuid[] := '{}'; v_p jsonb; v_id uuid; v_w public.workers%ROWTYPE;
BEGIN
  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(p_people, '[]'::jsonb)) LOOP
    v_id := (v_p->>'worker_id')::uuid;
    SELECT * INTO v_w FROM public.workers WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION '%: persona no encontrada', p_label; END IF;
    IF NOT v_w.is_active THEN RAISE EXCEPTION '%: % está inactivo(a)', p_label, v_w.full_name; END IF;
    IF NOT v_id = ANY(v_ids) THEN v_ids := v_ids || v_id; END IF;
  END LOOP;
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_worker_ids(jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_create_worker_earnings(p_kind text, p_people jsonb, p_total_units integer, p_rate numeric,
                                                            p_date date, p_labor_id uuid, p_core_id uuid, p_description text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_label text := CASE p_kind WHEN 'armado' THEN 'Armado' ELSE 'Corte de cartón' END;
  v_ids uuid[] := public.fn_worker_ids(p_people, v_label);
  v_n integer := COALESCE(array_length(v_ids, 1), 0);
  v_total numeric := ROUND(p_total_units * p_rate);
  v_base numeric; v_rest numeric; i integer;
BEGIN
  IF v_n = 0 THEN
    INSERT INTO public.worker_earnings
      (worker_id, work_date, kind, assembly_labor_id, core_id, description, units, rate, amount, shared_with, created_by)
    VALUES (NULL, p_date, p_kind, p_labor_id, p_core_id, v_label || ' — ' || p_description,
            p_total_units, p_rate, v_total, 1, auth.uid());
    RETURN;
  END IF;

  v_base := floor(v_total / v_n);
  v_rest := v_total - v_base * v_n;
  FOR i IN 1 .. v_n LOOP
    INSERT INTO public.worker_earnings
      (worker_id, work_date, kind, assembly_labor_id, core_id, description, units, rate, amount, shared_with, created_by)
    VALUES (v_ids[i], p_date, p_kind, p_labor_id, p_core_id, v_label || ' — ' || p_description,
            p_total_units, p_rate, v_base + CASE WHEN i <= v_rest THEN 1 ELSE 0 END, v_n, auth.uid());
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_create_worker_earnings(text, jsonb, integer, numeric, date, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reassign_worker_earning(p_id uuid, p_splits jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_e public.worker_earnings%ROWTYPE;
  v_ids uuid[];
  v_n integer;
  v_custom boolean;
  v_sum numeric := 0;
  v_base numeric; v_rest numeric; v_amt numeric; i integer;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede asignar trabajos'; END IF;
  SELECT * INTO v_e FROM public.worker_earnings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea no encontrada'; END IF;
  IF v_e.payment_id IS NOT NULL THEN RAISE EXCEPTION 'La línea ya está pagada: anula el pago primero'; END IF;
  IF jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) = 0 THEN RAISE EXCEPTION 'Indica al menos una persona'; END IF;

  v_ids := public.fn_worker_ids(p_splits, 'Asignar');
  v_n := array_length(v_ids, 1);
  IF v_n <> jsonb_array_length(p_splits) THEN RAISE EXCEPTION 'Hay personas repetidas'; END IF;
  v_custom := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_splits) s WHERE NULLIF(s->>'amount', '') IS NULL);

  IF v_custom THEN
    SELECT SUM(ROUND((s->>'amount')::numeric)) INTO v_sum FROM jsonb_array_elements(p_splits) s;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_splits) s WHERE (s->>'amount')::numeric <= 0) THEN
      RAISE EXCEPTION 'Cada persona debe recibir un valor mayor a 0';
    END IF;
    IF v_sum <> ROUND(v_e.amount) THEN
      RAISE EXCEPTION 'La suma ($%) debe ser igual al valor de la línea ($%)', v_sum, ROUND(v_e.amount);
    END IF;
  END IF;

  v_base := floor(ROUND(v_e.amount) / v_n);
  v_rest := ROUND(v_e.amount) - v_base * v_n;
  FOR i IN 1 .. v_n LOOP
    v_amt := CASE WHEN v_custom THEN ROUND((p_splits->(i - 1)->>'amount')::numeric)
                  ELSE v_base + CASE WHEN i <= v_rest THEN 1 ELSE 0 END END;
    INSERT INTO public.worker_earnings
      (worker_id, work_date, kind, assembly_labor_id, core_id, description, units, rate, amount, shared_with, created_by, created_at)
    VALUES (v_ids[i], v_e.work_date, v_e.kind, v_e.assembly_labor_id, v_e.core_id, v_e.description,
            v_e.units, v_e.rate, v_amt, v_e.shared_with * v_n, v_e.created_by, v_e.created_at);
  END LOOP;
  DELETE FROM public.worker_earnings WHERE id = v_e.id;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_worker_earning(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_worker_earning(uuid, jsonb) TO authenticated;

-- Trabajo manual (servicios u otros) para una o varias personas
CREATE OR REPLACE FUNCTION public.add_worker_earnings(p_workers jsonb, p_date date, p_kind text, p_description text,
                                                      p_amount numeric, p_units numeric DEFAULT NULL, p_rate numeric DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Bogota'
AS $$
DECLARE
  v_ids uuid[];
  v_n integer;
  v_total numeric := ROUND(p_amount);
  v_custom boolean;
  v_sum numeric;
  v_base numeric; v_rest numeric; v_amt numeric; i integer;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede registrar trabajos'; END IF;
  IF p_kind NOT IN ('armado', 'corte_carton', 'servicio') THEN RAISE EXCEPTION 'Tipo de trabajo no válido'; END IF;
  IF v_total IS NULL OR v_total <= 0 THEN RAISE EXCEPTION 'El valor debe ser mayor a 0'; END IF;
  IF NULLIF(trim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Describe el trabajo'; END IF;
  IF jsonb_typeof(p_workers) <> 'array' OR jsonb_array_length(p_workers) = 0 THEN RAISE EXCEPTION 'Elige al menos una persona'; END IF;

  v_ids := public.fn_worker_ids(p_workers, 'Trabajo');
  v_n := array_length(v_ids, 1);
  IF v_n <> jsonb_array_length(p_workers) THEN RAISE EXCEPTION 'Hay personas repetidas'; END IF;
  v_custom := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_workers) s WHERE NULLIF(s->>'amount', '') IS NULL);
  IF v_custom THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_workers) s WHERE (s->>'amount')::numeric <= 0) THEN
      RAISE EXCEPTION 'Cada persona debe recibir un valor mayor a 0';
    END IF;
    SELECT SUM(ROUND((s->>'amount')::numeric)) INTO v_sum FROM jsonb_array_elements(p_workers) s;
    IF v_sum <> v_total THEN RAISE EXCEPTION 'La suma por persona ($%) debe ser igual al total ($%)', v_sum, v_total; END IF;
  END IF;

  v_base := floor(v_total / v_n);
  v_rest := v_total - v_base * v_n;
  FOR i IN 1 .. v_n LOOP
    v_amt := CASE WHEN v_custom THEN ROUND((p_workers->(i - 1)->>'amount')::numeric)
                  ELSE v_base + CASE WHEN i <= v_rest THEN 1 ELSE 0 END END;
    INSERT INTO public.worker_earnings (worker_id, work_date, kind, description, units, rate, amount, shared_with, created_by)
    VALUES (v_ids[i], COALESCE(p_date, current_date), p_kind, trim(p_description), p_units, p_rate, v_amt, v_n, auth.uid());
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.add_worker_earnings(jsonb, date, text, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_worker_earnings(jsonb, date, text, text, numeric, numeric, numeric) TO authenticated;
