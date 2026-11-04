-- ============================================================
-- GASTOS FIJOS Y RECURRENTES (base para la futura contabilidad)
--
--   expense_categories  → categoría con cuenta PUC y grupo (operacional / no operacional / financiero)
--   recurring_expenses  → plantilla del gasto fijo: se configura UNA vez (valor, frecuencia, día de pago)
--   expenses            → cada ocurrencia (causación) del gasto: se genera por mes desde la plantilla
--                         o se registra como gasto ocasional; se marca pagada con fecha/medio/referencia.
--
-- Créditos: amount = cuota total; principal_amount = abono a capital (NO es gasto, reduce la deuda
-- en la cuenta 2105); el resto (amount - principal_amount) son intereses = gasto financiero.
-- ============================================================

CREATE TYPE public.expense_group AS ENUM ('operacional', 'no_operacional', 'financiero');
CREATE TYPE public.expense_frequency AS ENUM ('quincenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual', 'unico');
CREATE TYPE public.expense_status AS ENUM ('pendiente', 'pagado', 'anulado');

-- ---------- Categorías ----------
CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  expense_group public.expense_group NOT NULL DEFAULT 'operacional',
  puc_code text,                 -- cuenta del PUC colombiano (para causación contable futura)
  description text,
  color text NOT NULL DEFAULT '#3F8346',
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.expense_categories (name, expense_group, puc_code, description, color, display_order) VALUES
  ('Nómina', 'operacional', '5105', 'Salarios, seguridad social (PILA), prestaciones y auxilios', '#2E4040', 1),
  ('Arriendo', 'operacional', '5120', 'Arrendamiento de bodega, planta u oficina', '#3F8346', 2),
  ('Servicios públicos', 'operacional', '5135', 'Energía, agua, gas, internet y telefonía', '#0EA5E9', 3),
  ('Créditos', 'financiero', '5305', 'Cuotas de préstamos: intereses (gasto 5305) + abono a capital (2105)', '#7C3AED', 4),
  ('Industria y comercio', 'operacional', '5115', 'ICA, avisos y tableros y otros impuestos', '#DC2626', 5),
  ('Transporte general', 'operacional', '5135', 'Fletes, acarreos, combustible y peajes', '#F59E0B', 6),
  ('Mantenimientos', 'operacional', '5145', 'Mantenimiento de máquinas, vehículos e instalaciones', '#0D9488', 7),
  ('Insumos y suministros', 'operacional', '5195', 'Consumo interno: papelería, aseo, cafetería, EPP', '#64748B', 8),
  ('Gastos no operacionales', 'no_operacional', '5315', 'Gastos bancarios, multas, donaciones y extraordinarios', '#949E97', 9);

-- ---------- Plantillas de gastos fijos ----------
CREATE TABLE public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  payee_name text,                                     -- beneficiario (si no es proveedor registrado)
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount >= 0),         -- valor (estimado si is_variable)
  is_variable boolean NOT NULL DEFAULT false,          -- ej. servicios públicos: se confirma el valor real cada mes
  frequency public.expense_frequency NOT NULL DEFAULT 'mensual',
  due_day integer NOT NULL DEFAULT 5 CHECK (due_day BETWEEN 1 AND 31),
  start_date date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  end_date date,
  -- Créditos
  installments_total integer CHECK (installments_total > 0),
  principal_amount numeric NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (principal_amount <= amount)
);

-- ---------- Gastos (ocurrencias) ----------
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_id uuid REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
  description text NOT NULL,
  payee_name text,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  period_month date NOT NULL,                          -- primer día del mes al que corresponde
  due_date date NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),         -- total a pagar
  principal_amount numeric NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),  -- créditos: abono a capital
  installment_number integer,                          -- créditos: número de cuota
  status public.expense_status NOT NULL DEFAULT 'pendiente',
  paid_date date,
  payment_method public.payment_method,
  reference text,                                      -- comprobante / soporte
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (principal_amount <= amount),
  CHECK (status <> 'pagado' OR paid_date IS NOT NULL),
  CHECK (period_month = date_trunc('month', period_month)::date)
);

-- Una plantilla genera como máximo una ocurrencia por fecha de vencimiento
CREATE UNIQUE INDEX expenses_recurring_due_unique ON public.expenses(recurring_id, due_date) WHERE recurring_id IS NOT NULL;
CREATE INDEX idx_expenses_period ON public.expenses(period_month);
CREATE INDEX idx_expenses_status_due ON public.expenses(status, due_date);
CREATE INDEX idx_expenses_category ON public.expenses(category_id);

-- ---------- RLS: solo administración ----------
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin gestiona categorias de gasto" ON public.expense_categories
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona gastos fijos" ON public.recurring_expenses
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona gastos" ON public.expenses
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');

-- ============================================================
-- RPC: genera (idempotente) los gastos del mes a partir de las plantillas activas
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_recurring_expenses(p_month date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_month date := date_trunc('month', p_month)::date;
  v_last date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_tpl public.recurring_expenses%ROWTYPE;
  v_due date;
  v_dues date[];
  v_step integer;
  v_months integer;
  v_count integer := 0;
  v_done integer;
  v_inserted integer;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede generar gastos';
  END IF;

  FOR v_tpl IN
    SELECT * FROM public.recurring_expenses
     WHERE is_active
       AND start_date <= v_last
       AND (end_date IS NULL OR end_date >= v_month)
  LOOP
    v_dues := ARRAY[]::date[];
    v_months := (extract(year FROM v_month) - extract(year FROM v_tpl.start_date)) * 12
              + (extract(month FROM v_month) - extract(month FROM v_tpl.start_date));
    v_step := CASE v_tpl.frequency
                WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3
                WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 1 END;

    IF v_tpl.frequency = 'quincenal' THEN
      v_dues := ARRAY[v_month + 14, v_last];
    ELSIF v_tpl.frequency = 'unico' THEN
      IF v_months = 0 THEN v_dues := ARRAY[LEAST(v_month + v_tpl.due_day - 1, v_last)]; END IF;
    ELSIF v_months % v_step = 0 THEN
      v_dues := ARRAY[LEAST(v_month + v_tpl.due_day - 1, v_last)];
    END IF;

    FOREACH v_due IN ARRAY v_dues LOOP
      -- No generar antes del inicio ni después del fin de la plantilla
      CONTINUE WHEN v_due < v_tpl.start_date OR (v_tpl.end_date IS NOT NULL AND v_due > v_tpl.end_date);

      -- Créditos: no pasar del número de cuotas pactado
      SELECT count(*) INTO v_done FROM public.expenses
       WHERE recurring_id = v_tpl.id AND status <> 'anulado' AND due_date < v_due;
      CONTINUE WHEN v_tpl.installments_total IS NOT NULL AND v_done >= v_tpl.installments_total;

      INSERT INTO public.expenses
        (recurring_id, category_id, description, payee_name, supplier_id, period_month, due_date,
         amount, principal_amount, installment_number, created_by)
      VALUES
        (v_tpl.id, v_tpl.category_id, v_tpl.name, v_tpl.payee_name, v_tpl.supplier_id, v_month, v_due,
         v_tpl.amount, v_tpl.principal_amount,
         CASE WHEN v_tpl.installments_total IS NOT NULL THEN v_done + 1 END,
         auth.uid())
      ON CONFLICT (recurring_id, due_date) WHERE recurring_id IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_count := v_count + v_inserted;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_recurring_expenses(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_recurring_expenses(date) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public' AND tablename = 'expenses') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
  END IF;
END $$;
