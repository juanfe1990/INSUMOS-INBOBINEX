-- =====================================================================
-- Trabajadores, trabajo causado por persona y pagos (ver 20261109020000)
-- =====================================================================

-- ---------- Personas ----------
CREATE TABLE IF NOT EXISTS public.workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  document_id text UNIQUE,                       -- cédula / NIT (tercero para la contabilidad)
  phone text,
  work_type text NOT NULL DEFAULT 'cores' CHECK (work_type IN ('cores', 'servicios', 'ambos')),
  bank_name text,
  bank_account text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workers_select ON public.workers;
CREATE POLICY workers_select ON public.workers
  FOR SELECT TO authenticated USING (public.current_user_role() IN ('admin', 'operario'));
DROP POLICY IF EXISTS workers_admin ON public.workers;
CREATE POLICY workers_admin ON public.workers
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- ---------- Pagos (uno por persona; batch_id agrupa los pagados juntos) ----------
CREATE TABLE IF NOT EXISTS public.worker_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE RESTRICT,
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL CHECK (amount > 0),
  account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  method public.payment_method NOT NULL DEFAULT 'transferencia',
  reference text,
  notes text,
  period_from date,
  period_to date,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_payments_batch_idx ON public.worker_payments (batch_id);
CREATE INDEX IF NOT EXISTS worker_payments_date_idx ON public.worker_payments (payment_date DESC);

ALTER TABLE public.worker_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_payments_select ON public.worker_payments;
CREATE POLICY worker_payments_select ON public.worker_payments
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');
-- Escritura solo por RPC (pay_worker_earnings / annul_worker_payment_batch)

-- ---------- Trabajo causado por persona ----------
CREATE TABLE IF NOT EXISTS public.worker_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid REFERENCES public.workers(id) ON DELETE RESTRICT,   -- NULL = sin asignar
  work_date date NOT NULL DEFAULT current_date,
  kind text NOT NULL CHECK (kind IN ('armado', 'corte_carton', 'servicio')),
  assembly_labor_id uuid REFERENCES public.core_assembly_labor(id) ON DELETE SET NULL,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  description text NOT NULL,
  units numeric CHECK (units IS NULL OR units > 0),
  rate numeric CHECK (rate IS NULL OR rate >= 0),
  amount numeric NOT NULL CHECK (amount >= 0),
  payment_id uuid REFERENCES public.worker_payments(id) ON DELETE SET NULL,   -- NULL = por pagar
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_earnings_pending_idx ON public.worker_earnings (work_date) WHERE payment_id IS NULL;
CREATE INDEX IF NOT EXISTS worker_earnings_worker_idx ON public.worker_earnings (worker_id);
CREATE INDEX IF NOT EXISTS worker_earnings_payment_idx ON public.worker_earnings (payment_id);

ALTER TABLE public.worker_earnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_earnings_select ON public.worker_earnings;
CREATE POLICY worker_earnings_select ON public.worker_earnings
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');
-- Escritura solo por RPC

-- ---------- Tesorería: el pago crea / borra su egreso ----------
ALTER TABLE public.treasury_movements
  ADD COLUMN IF NOT EXISTS worker_payment_id uuid UNIQUE REFERENCES public.worker_payments(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.fn_sync_worker_payment_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'America/Bogota'
AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.treasury_movements WHERE worker_payment_id = OLD.id;
    RETURN OLD;
  END IF;
  SELECT full_name INTO v_name FROM public.workers WHERE id = NEW.worker_id;
  INSERT INTO public.treasury_movements
    (account_id, movement_date, direction, movement_type, amount, description, third_party, reference, worker_payment_id, created_by)
  VALUES
    (NEW.account_id, NEW.payment_date, 'egreso', 'pago_mano_obra', NEW.amount,
     'Pago mano de obra' || CASE WHEN NEW.period_from IS NOT NULL
                                 THEN ' ' || to_char(NEW.period_from, 'DD/MM') ||
                                      CASE WHEN NEW.period_to IS DISTINCT FROM NEW.period_from
                                           THEN ' a ' || to_char(NEW.period_to, 'DD/MM') ELSE '' END
                                 ELSE '' END,
     v_name, NEW.reference, NEW.id, COALESCE(auth.uid(), NEW.created_by));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_worker_payment_treasury ON public.worker_payments;
CREATE TRIGGER tr_sync_worker_payment_treasury
  AFTER INSERT OR DELETE ON public.worker_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_worker_payment_treasury();
REVOKE ALL ON FUNCTION public.fn_sync_worker_payment_treasury() FROM PUBLIC, anon, authenticated;

-- ---------- Helper: crea las líneas de un oficio repartidas entre personas ----------
-- p_people = [{worker_id, units}] (puede venir vacío -> una línea "sin asignar")
CREATE OR REPLACE FUNCTION public.fn_create_worker_earnings(
  p_kind text, p_people jsonb, p_total_units integer, p_rate numeric, p_date date,
  p_labor_id uuid, p_core_id uuid, p_description text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_p jsonb;
  v_sum numeric := 0;
  v_units numeric;
  v_worker public.workers%ROWTYPE;
  v_label text := CASE p_kind WHEN 'armado' THEN 'Armado' ELSE 'Corte de cartón' END;
BEGIN
  IF COALESCE(jsonb_array_length(p_people), 0) = 0 THEN
    INSERT INTO public.worker_earnings
      (worker_id, work_date, kind, assembly_labor_id, core_id, description, units, rate, amount, created_by)
    VALUES (NULL, p_date, p_kind, p_labor_id, p_core_id, v_label || ' — ' || p_description,
            p_total_units, p_rate, ROUND(p_total_units * p_rate), auth.uid());
    RETURN;
  END IF;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    v_units := (v_p->>'units')::numeric;
    IF v_units IS NULL OR v_units <= 0 OR v_units <> trunc(v_units) THEN
      RAISE EXCEPTION '%: cada persona debe tener una cantidad entera de cores mayor a 0', v_label;
    END IF;
    SELECT * INTO v_worker FROM public.workers WHERE id = (v_p->>'worker_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION '%: persona no encontrada', v_label; END IF;
    IF NOT v_worker.is_active THEN RAISE EXCEPTION '%: % está inactivo(a)', v_label, v_worker.full_name; END IF;
    v_sum := v_sum + v_units;
    INSERT INTO public.worker_earnings
      (worker_id, work_date, kind, assembly_labor_id, core_id, description, units, rate, amount, created_by)
    VALUES (v_worker.id, p_date, p_kind, p_labor_id, p_core_id, v_label || ' — ' || p_description,
            v_units, p_rate, ROUND(v_units * p_rate), auth.uid());
  END LOOP;

  IF v_sum <> p_total_units THEN
    RAISE EXCEPTION '%: la suma de cores por persona (%) debe ser igual a los cores armados (%)', v_label, v_sum, p_total_units;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_create_worker_earnings(text, jsonb, integer, numeric, date, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------- Armado de cores con las personas que trabajaron ----------
-- p_workers = [{worker_id, trade: 'armado'|'corte_carton', units}]
-- Sin personas de un oficio, su línea queda "sin asignar" (el admin la asigna en la web).
DROP FUNCTION IF EXISTS public.register_core_assembly(uuid, integer, text);

CREATE OR REPLACE FUNCTION public.register_core_assembly(
  p_core_id uuid,
  p_units integer,
  p_notes text DEFAULT NULL,
  p_workers jsonb DEFAULT NULL,
  p_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'America/Bogota'
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_core public.core_specifications%ROWTYPE;
  v_mat public.core_materials%ROWTYPE;
  v_date date := COALESCE(p_date, current_date);
  v_kg numeric;
  v_material_cost numeric;
  v_assembly numeric;
  v_cut_unit numeric;
  v_cut numeric;
  v_unit_cost numeric;
  v_new_avg numeric;
  v_note text;
  v_labor_id uuid;
  v_desc text;
  v_workers jsonb := COALESCE(p_workers, '[]'::jsonb);
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operario') THEN
    RAISE EXCEPTION 'Solo administradores u operarios pueden registrar armado de cores';
  END IF;
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'La cantidad de cores debe ser mayor a 0';
  END IF;
  IF jsonb_typeof(v_workers) <> 'array' THEN RAISE EXCEPTION 'Formato de personas inválido'; END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'La fecha del armado no puede ser futura'; END IF;
  IF v_date < current_date - 31 THEN RAISE EXCEPTION 'La fecha del armado no puede tener más de 31 días'; END IF;

  SELECT * INTO v_core FROM public.core_specifications WHERE id = p_core_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Medida de core no encontrada'; END IF;
  IF v_core.core_material_id IS NULL THEN
    RAISE EXCEPTION 'La medida "%" no tiene material de cores asignado. Asígnalo en Inventarios.', v_core.name;
  END IF;
  IF COALESCE(v_core.weight_grams, 0) <= 0 THEN
    RAISE EXCEPTION 'La medida "%" no tiene peso promedio del core armado. Defínelo en Inventarios.', v_core.name;
  END IF;

  SELECT * INTO v_mat FROM public.core_materials WHERE id = v_core.core_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material de cores no encontrado'; END IF;

  v_kg := ROUND(v_core.weight_grams * p_units / 1000.0, 3);
  IF v_kg > v_mat.current_stock_kg THEN
    RAISE EXCEPTION 'Material insuficiente en "%": hay % kg y se requieren % kg (% cores x % g)',
      v_mat.name, ROUND(v_mat.current_stock_kg, 2), ROUND(v_kg, 2), p_units, v_core.weight_grams;
  END IF;

  v_material_cost := v_kg * v_mat.cost_per_kg;
  v_assembly := p_units * v_core.labor_cost_per_unit;
  v_cut_unit := CASE WHEN v_core.has_cardboard_part THEN v_core.cardboard_cut_cost_per_unit ELSE 0 END;
  v_cut := p_units * v_cut_unit;
  v_unit_cost := ROUND((v_material_cost + v_assembly + v_cut) / p_units, 2);
  v_new_avg := CASE WHEN v_core.current_stock_units > 0
                    THEN ROUND((v_core.current_stock_units * v_core.standard_cost + p_units * v_unit_cost)
                               / (v_core.current_stock_units + p_units), 2)
                    ELSE v_unit_cost END;
  v_note := COALESCE(NULLIF(trim(p_notes), ''), 'Armado de cores');

  UPDATE public.core_materials
     SET current_stock_kg = current_stock_kg - v_kg, updated_at = now()
   WHERE id = v_mat.id;

  UPDATE public.core_specifications
     SET current_stock_units = current_stock_units + p_units,
         standard_cost = v_new_avg,
         updated_at = now()
   WHERE id = v_core.id;

  INSERT INTO public.inventory_transactions
    (movement_type, core_material_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('consumo_armado_core', v_mat.id, v_kg, v_mat.cost_per_kg, ROUND(v_material_cost, 2),
          v_note || ' — ' || p_units || ' cores de ' || trim_scale(v_core.length_cm) || ' cm x ' || v_core.weight_grams || ' g',
          auth.uid());

  INSERT INTO public.inventory_transactions
    (movement_type, core_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('produccion_core', v_core.id, p_units, v_unit_cost, ROUND(v_material_cost + v_assembly + v_cut, 2),
          v_note || ' — ' || ROUND(v_kg, 2) || ' kg de material + armado $' || ROUND(v_assembly)
            || CASE WHEN v_cut > 0 THEN ' + corte de cartón $' || ROUND(v_cut) ELSE '' END,
          auth.uid());

  INSERT INTO public.core_assembly_labor
    (assembly_date, core_id, core_name, length_cm, units, assembly_cost_per_unit, assembly_total,
     has_cardboard_part, cardboard_cut_cost_per_unit, cardboard_cut_total, material_cost, kg_used, notes, created_by)
  VALUES
    (v_date, v_core.id, v_core.name, v_core.length_cm, p_units, v_core.labor_cost_per_unit, ROUND(v_assembly, 2),
     v_core.has_cardboard_part, v_cut_unit, ROUND(v_cut, 2), ROUND(v_material_cost, 2), v_kg,
     NULLIF(trim(p_notes), ''), auth.uid())
  RETURNING id INTO v_labor_id;

  -- Trabajo causado por persona
  v_desc := p_units || ' cores de ' || trim_scale(v_core.length_cm) || ' cm (' || v_core.name || ')';
  IF v_core.labor_cost_per_unit > 0 THEN
    PERFORM public.fn_create_worker_earnings('armado',
      COALESCE((SELECT jsonb_agg(w) FROM jsonb_array_elements(v_workers) w WHERE COALESCE(w->>'trade', 'armado') = 'armado'), '[]'::jsonb),
      p_units, v_core.labor_cost_per_unit, v_date, v_labor_id, v_core.id, v_desc);
  END IF;
  IF v_cut_unit > 0 THEN
    PERFORM public.fn_create_worker_earnings('corte_carton',
      COALESCE((SELECT jsonb_agg(w) FROM jsonb_array_elements(v_workers) w WHERE w->>'trade' = 'corte_carton'), '[]'::jsonb),
      p_units, v_cut_unit, v_date, v_labor_id, v_core.id, v_desc);
  END IF;

  RETURN jsonb_build_object(
    'units', p_units,
    'kg_used', v_kg,
    'unit_cost', v_unit_cost,
    'assembly_total', ROUND(v_assembly, 2),
    'cardboard_cut_total', ROUND(v_cut, 2),
    'new_stock_units', v_core.current_stock_units + p_units,
    'material_stock_kg', v_mat.current_stock_kg - v_kg,
    'unassigned', (SELECT COUNT(*) FROM public.worker_earnings WHERE assembly_labor_id = v_labor_id AND worker_id IS NULL)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_core_assembly(uuid, integer, text, jsonb, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, text, jsonb, date) TO authenticated;

-- ---------- Trabajo manual (servicios u otros) ----------
CREATE OR REPLACE FUNCTION public.add_worker_earning(
  p_worker_id uuid, p_date date, p_kind text, p_description text, p_amount numeric,
  p_units numeric DEFAULT NULL, p_rate numeric DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'America/Bogota'
AS $$
DECLARE v_id uuid;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede registrar trabajos'; END IF;
  IF p_kind NOT IN ('armado', 'corte_carton', 'servicio') THEN RAISE EXCEPTION 'Tipo de trabajo no válido'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workers WHERE id = p_worker_id AND is_active) THEN
    RAISE EXCEPTION 'Persona no encontrada o inactiva';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El valor debe ser mayor a 0'; END IF;
  IF NULLIF(trim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Describe el trabajo'; END IF;
  INSERT INTO public.worker_earnings (worker_id, work_date, kind, description, units, rate, amount, created_by)
  VALUES (p_worker_id, COALESCE(p_date, current_date), p_kind, trim(p_description), p_units, p_rate, ROUND(p_amount), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.add_worker_earning(uuid, date, text, text, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_worker_earning(uuid, date, text, text, numeric, numeric, numeric) TO authenticated;

-- ---------- Asignar / repartir una línea por pagar entre personas ----------
-- p_splits = [{worker_id, units}] (líneas con unidades) o [{worker_id, amount}] (servicios)
CREATE OR REPLACE FUNCTION public.reassign_worker_earning(p_id uuid, p_splits jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_e public.worker_earnings%ROWTYPE;
  v_s jsonb;
  v_sum numeric := 0;
  v_part numeric;
  v_n integer := 0;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede asignar trabajos'; END IF;
  SELECT * INTO v_e FROM public.worker_earnings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Línea no encontrada'; END IF;
  IF v_e.payment_id IS NOT NULL THEN RAISE EXCEPTION 'La línea ya está pagada: anula el pago primero'; END IF;
  IF jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) = 0 THEN RAISE EXCEPTION 'Indica al menos una persona'; END IF;

  FOR v_s IN SELECT * FROM jsonb_array_elements(p_splits) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.workers WHERE id = (v_s->>'worker_id')::uuid AND is_active) THEN
      RAISE EXCEPTION 'Persona no encontrada o inactiva';
    END IF;
    v_part := CASE WHEN v_e.units IS NOT NULL THEN (v_s->>'units')::numeric ELSE (v_s->>'amount')::numeric END;
    IF v_part IS NULL OR v_part <= 0 THEN RAISE EXCEPTION 'Cada persona debe tener una cantidad mayor a 0'; END IF;
    IF v_e.units IS NOT NULL AND v_part <> trunc(v_part) THEN RAISE EXCEPTION 'Los cores deben ser enteros'; END IF;
    v_sum := v_sum + v_part;
  END LOOP;

  IF v_e.units IS NOT NULL AND v_sum <> v_e.units THEN
    RAISE EXCEPTION 'La suma (%) debe ser igual a los cores de la línea (%)', v_sum, v_e.units;
  END IF;
  IF v_e.units IS NULL AND ROUND(v_sum) <> ROUND(v_e.amount) THEN
    RAISE EXCEPTION 'La suma ($%) debe ser igual al valor de la línea ($%)', ROUND(v_sum), ROUND(v_e.amount);
  END IF;

  FOR v_s IN SELECT * FROM jsonb_array_elements(p_splits) LOOP
    INSERT INTO public.worker_earnings
      (worker_id, work_date, kind, assembly_labor_id, core_id, description, units, rate, amount, created_by, created_at)
    VALUES
      ((v_s->>'worker_id')::uuid, v_e.work_date, v_e.kind, v_e.assembly_labor_id, v_e.core_id, v_e.description,
       CASE WHEN v_e.units IS NOT NULL THEN (v_s->>'units')::numeric END, v_e.rate,
       CASE WHEN v_e.units IS NOT NULL THEN ROUND((v_s->>'units')::numeric * v_e.rate) ELSE ROUND((v_s->>'amount')::numeric) END,
       v_e.created_by, v_e.created_at);
    v_n := v_n + 1;
  END LOOP;
  DELETE FROM public.worker_earnings WHERE id = v_e.id;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_worker_earning(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_worker_earning(uuid, jsonb) TO authenticated;

-- ---------- Eliminar una línea por pagar (error de registro) ----------
CREATE OR REPLACE FUNCTION public.delete_worker_earning(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede eliminar trabajos'; END IF;
  DELETE FROM public.worker_earnings WHERE id = p_id AND payment_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'No se puede eliminar: no existe o ya está pagada'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_worker_earning(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_worker_earning(uuid) TO authenticated;

-- ---------- Pagar líneas (un día, una semana o todo lo pendiente) ----------
-- Divide por persona: un worker_payments (y un egreso de tesorería) por cada una.
CREATE OR REPLACE FUNCTION public.pay_worker_earnings(
  p_earning_ids uuid[],
  p_account_id uuid,
  p_date date DEFAULT NULL,
  p_method public.payment_method DEFAULT 'transferencia',
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'America/Bogota'
AS $$
DECLARE
  v_batch uuid := gen_random_uuid();
  v_date date := COALESCE(p_date, current_date);
  v_count integer;
  v_unassigned integer;
  v_paid integer;
  r record;
  v_payment uuid;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede pagar'; END IF;
  IF p_earning_ids IS NULL OR cardinality(p_earning_ids) = 0 THEN RAISE EXCEPTION 'Selecciona lo que vas a pagar'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.treasury_accounts WHERE id = p_account_id AND is_active) THEN
    RAISE EXCEPTION 'Elige la cuenta de la que sale el pago';
  END IF;

  PERFORM 1 FROM public.worker_earnings WHERE id = ANY(p_earning_ids) FOR UPDATE;
  SELECT COUNT(*), COUNT(*) FILTER (WHERE worker_id IS NULL), COUNT(*) FILTER (WHERE payment_id IS NOT NULL)
    INTO v_count, v_unassigned, v_paid
    FROM public.worker_earnings WHERE id = ANY(p_earning_ids);
  IF v_count <> cardinality(p_earning_ids) THEN RAISE EXCEPTION 'Algunas líneas ya no existen: recarga la página'; END IF;
  IF v_unassigned > 0 THEN RAISE EXCEPTION 'Hay % línea(s) sin asignar a una persona: asígnalas antes de pagar', v_unassigned; END IF;
  IF v_paid > 0 THEN RAISE EXCEPTION 'Hay % línea(s) que ya fueron pagadas: recarga la página', v_paid; END IF;

  FOR r IN
    SELECT e.worker_id, w.full_name, SUM(e.amount) AS amount, MIN(e.work_date) AS d1, MAX(e.work_date) AS d2, COUNT(*) AS n
      FROM public.worker_earnings e JOIN public.workers w ON w.id = e.worker_id
     WHERE e.id = ANY(p_earning_ids)
     GROUP BY e.worker_id, w.full_name
  LOOP
    IF r.amount <= 0 THEN CONTINUE; END IF;
    INSERT INTO public.worker_payments
      (batch_id, worker_id, payment_date, amount, account_id, method, reference, notes, period_from, period_to, created_by)
    VALUES
      (v_batch, r.worker_id, v_date, r.amount, p_account_id, COALESCE(p_method, 'transferencia'),
       NULLIF(trim(p_reference), ''), NULLIF(trim(p_notes), ''), r.d1, r.d2, auth.uid())
    RETURNING id INTO v_payment;
    UPDATE public.worker_earnings SET payment_id = v_payment
     WHERE id = ANY(p_earning_ids) AND worker_id = r.worker_id;
    v_lines := v_lines || jsonb_build_object('worker', r.full_name, 'amount', r.amount, 'lines', r.n);
    v_total := v_total + r.amount;
  END LOOP;

  RETURN jsonb_build_object('batch_id', v_batch, 'total', v_total, 'people', v_lines);
END;
$$;
REVOKE ALL ON FUNCTION public.pay_worker_earnings(uuid[], uuid, date, public.payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_worker_earnings(uuid[], uuid, date, public.payment_method, text, text) TO authenticated;

-- ---------- Anular un pago (lote completo): las líneas vuelven a "por pagar" ----------
-- Si algún egreso ya está conciliado en el banco, el bloqueo de tesorería lo impide.
CREATE OR REPLACE FUNCTION public.annul_worker_payment_batch(p_batch_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n integer;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Solo un administrador puede anular pagos'; END IF;
  DELETE FROM public.worker_payments WHERE batch_id = p_batch_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'Pago no encontrado'; END IF;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.annul_worker_payment_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annul_worker_payment_batch(uuid) TO authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_earnings;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;
