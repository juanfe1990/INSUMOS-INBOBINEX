-- =====================================================================
-- DESPERDICIOS / MERMAS DE INVENTARIO
-- Documento fuente: waste_records (fecha, producto, cantidad, costo, causa,
-- pedido de producción opcional, responsable). Cada registro descuenta stock
-- y deja Kardex 'merma_desperdicio' con waste_record_id. No se borra: se ANULA
-- (devuelve el stock y deja un Kardex de reverso NEGATIVO del mismo tipo, así
-- el P&G suma neto).
--   kind: bobina (kg) | core (und) | material_core (kg) | insumo (unidad del producto)
--   Roles: admin todo · operario bobina/core/material_core (planta) · vendedor insumo
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.waste_reason AS ENUM (
    'refile',            -- Refile / bordes del corte
    'arranque',          -- Arranque / cambio de bobina / calibración
    'rollo_defectuoso',  -- Rollo defectuoso / reproceso
    'rotura',            -- Rotura de película
    'core_danado',       -- Core dañado / mal armado
    'dano_bodega',       -- Daño en bodega o transporte
    'obsoleto',          -- Vencido / obsoleto
    'otro'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.waste_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_date date NOT NULL DEFAULT current_date,
  kind text NOT NULL CHECK (kind IN ('bobina', 'core', 'material_core', 'insumo')),
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,                       -- snapshot (el producto puede borrarse luego)
  unit text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL DEFAULT 0,          -- costo promedio al momento del registro
  total_cost numeric NOT NULL DEFAULT 0,
  reason public.waste_reason NOT NULL DEFAULT 'otro',
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,   -- desperdicio de producción de un pedido
  notes text,
  status text NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'anulado')),
  annulled_at timestamptz,
  annulled_by uuid REFERENCES public.profiles(id),
  annul_reason text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS waste_records_date_idx ON public.waste_records (waste_date DESC);
CREATE INDEX IF NOT EXISTS waste_records_order_idx ON public.waste_records (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS waste_records_raw_idx ON public.waste_records (raw_material_id) WHERE raw_material_id IS NOT NULL;

ALTER TABLE public.waste_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waste_records_select ON public.waste_records;
CREATE POLICY waste_records_select ON public.waste_records
  FOR SELECT TO authenticated
  USING (public.current_user_role() IN ('admin', 'operario', 'vendedor'));
-- Sin políticas de escritura: solo vía RPC (register_waste / annul_waste)

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS waste_record_id uuid REFERENCES public.waste_records(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inventory_transactions_waste_idx
  ON public.inventory_transactions (waste_record_id) WHERE waste_record_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- register_waste: descuenta stock + documento + Kardex, atómico
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_waste(
  p_kind text,
  p_ref_id uuid,
  p_quantity numeric,
  p_reason public.waste_reason DEFAULT 'otro',
  p_order_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_date date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_name text;
  v_unit text;
  v_stock numeric;
  v_cost numeric;
  v_id uuid;
  v_order public.orders%ROWTYPE;
  v_date date := COALESCE(p_date, current_date);
BEGIN
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sesión requerida'; END IF;
  IF p_kind NOT IN ('bobina', 'core', 'material_core', 'insumo') THEN
    RAISE EXCEPTION 'Tipo de producto no válido: %', p_kind;
  END IF;
  IF v_role = 'operario' AND p_kind = 'insumo' THEN
    RAISE EXCEPTION 'Los operarios registran desperdicio de bobinas, cores y material de cores';
  END IF;
  IF v_role = 'vendedor' AND p_kind <> 'insumo' THEN
    RAISE EXCEPTION 'Los vendedores solo registran mermas de otros inventarios';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor a 0'; END IF;
  IF p_kind = 'core' AND p_quantity <> trunc(p_quantity) THEN
    RAISE EXCEPTION 'Los cores se registran en unidades enteras';
  END IF;
  IF v_date > current_date THEN RAISE EXCEPTION 'La fecha no puede ser futura'; END IF;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado'; END IF;
    IF v_order.status = 'cancelado' THEN RAISE EXCEPTION 'El pedido #% está cancelado', v_order.order_number; END IF;
  END IF;

  -- Bloquear la fila del producto, validar stock y descontar
  IF p_kind = 'bobina' THEN
    SELECT name, 'kg', current_stock_kg, cost_per_kg INTO v_name, v_unit, v_stock, v_cost
      FROM public.raw_materials WHERE id = p_ref_id FOR UPDATE;
  ELSIF p_kind = 'core' THEN
    SELECT name || ' (' || trim_scale(length_cm) || ' cm)', 'und', current_stock_units, standard_cost
      INTO v_name, v_unit, v_stock, v_cost
      FROM public.core_specifications WHERE id = p_ref_id FOR UPDATE;
  ELSIF p_kind = 'material_core' THEN
    SELECT name, 'kg', current_stock_kg, cost_per_kg INTO v_name, v_unit, v_stock, v_cost
      FROM public.core_materials WHERE id = p_ref_id FOR UPDATE;
  ELSE
    SELECT name, unit, current_stock, avg_cost INTO v_name, v_unit, v_stock, v_cost
      FROM public.inventory_items WHERE id = p_ref_id FOR UPDATE;
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF p_quantity > v_stock THEN
    RAISE EXCEPTION 'Stock insuficiente de "%": hay % % y se registran % % de desperdicio',
      v_name, ROUND(v_stock, 2), v_unit, ROUND(p_quantity, 2), v_unit;
  END IF;

  IF p_kind = 'bobina' THEN
    UPDATE public.raw_materials SET current_stock_kg = current_stock_kg - p_quantity, updated_at = now() WHERE id = p_ref_id;
  ELSIF p_kind = 'core' THEN
    UPDATE public.core_specifications SET current_stock_units = current_stock_units - p_quantity::integer, updated_at = now() WHERE id = p_ref_id;
  ELSIF p_kind = 'material_core' THEN
    UPDATE public.core_materials SET current_stock_kg = current_stock_kg - p_quantity, updated_at = now() WHERE id = p_ref_id;
  ELSE
    UPDATE public.inventory_items SET current_stock = current_stock - p_quantity, updated_at = now() WHERE id = p_ref_id;
  END IF;

  INSERT INTO public.waste_records
    (waste_date, kind, raw_material_id, core_id, core_material_id, inventory_item_id, item_name, unit,
     quantity, unit_cost, total_cost, reason, order_id, notes, created_by)
  VALUES
    (v_date, p_kind,
     CASE WHEN p_kind = 'bobina' THEN p_ref_id END,
     CASE WHEN p_kind = 'core' THEN p_ref_id END,
     CASE WHEN p_kind = 'material_core' THEN p_ref_id END,
     CASE WHEN p_kind = 'insumo' THEN p_ref_id END,
     v_name, v_unit, p_quantity, COALESCE(v_cost, 0), ROUND(p_quantity * COALESCE(v_cost, 0), 2),
     COALESCE(p_reason, 'otro'), p_order_id, NULLIF(trim(p_notes), ''), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.inventory_transactions
    (movement_type, raw_material_id, core_id, core_material_id, inventory_item_id,
     quantity, unit_cost, total_cost, order_id, waste_record_id, notes, created_by)
  VALUES
    ('merma_desperdicio',
     CASE WHEN p_kind = 'bobina' THEN p_ref_id END,
     CASE WHEN p_kind = 'core' THEN p_ref_id END,
     CASE WHEN p_kind = 'material_core' THEN p_ref_id END,
     CASE WHEN p_kind = 'insumo' THEN p_ref_id END,
     p_quantity, COALESCE(v_cost, 0), ROUND(p_quantity * COALESCE(v_cost, 0), 2), p_order_id, v_id,
     'Desperdicio: ' || replace(COALESCE(p_reason, 'otro')::text, '_', ' ')
       || CASE WHEN p_order_id IS NOT NULL THEN ' · pedido #' || v_order.order_number ELSE '' END
       || COALESCE(' · ' || NULLIF(trim(p_notes), ''), ''),
     auth.uid());

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.register_waste(text, uuid, numeric, public.waste_reason, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_waste(text, uuid, numeric, public.waste_reason, uuid, text, date) TO authenticated;

-- ---------------------------------------------------------------------
-- annul_waste (solo admin): devuelve el stock y deja reverso negativo
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.annul_waste(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_w public.waste_records%ROWTYPE;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede anular desperdicios';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación';
  END IF;

  SELECT * INTO v_w FROM public.waste_records WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registro no encontrado'; END IF;
  IF v_w.status = 'anulado' THEN RAISE EXCEPTION 'El registro ya está anulado'; END IF;

  IF v_w.kind = 'bobina' THEN
    IF v_w.raw_material_id IS NULL THEN RAISE EXCEPTION 'La bobina ya no existe: no se puede devolver el stock'; END IF;
    UPDATE public.raw_materials SET current_stock_kg = current_stock_kg + v_w.quantity, updated_at = now() WHERE id = v_w.raw_material_id;
  ELSIF v_w.kind = 'core' THEN
    IF v_w.core_id IS NULL THEN RAISE EXCEPTION 'El core ya no existe: no se puede devolver el stock'; END IF;
    UPDATE public.core_specifications SET current_stock_units = current_stock_units + v_w.quantity::integer, updated_at = now() WHERE id = v_w.core_id;
  ELSIF v_w.kind = 'material_core' THEN
    IF v_w.core_material_id IS NULL THEN RAISE EXCEPTION 'El material ya no existe: no se puede devolver el stock'; END IF;
    UPDATE public.core_materials SET current_stock_kg = current_stock_kg + v_w.quantity, updated_at = now() WHERE id = v_w.core_material_id;
  ELSE
    IF v_w.inventory_item_id IS NULL THEN RAISE EXCEPTION 'El producto ya no existe: no se puede devolver el stock'; END IF;
    UPDATE public.inventory_items SET current_stock = current_stock + v_w.quantity, updated_at = now() WHERE id = v_w.inventory_item_id;
  END IF;

  UPDATE public.waste_records
     SET status = 'anulado', annulled_at = now(), annulled_by = auth.uid(), annul_reason = trim(p_reason)
   WHERE id = v_w.id;

  INSERT INTO public.inventory_transactions
    (movement_type, raw_material_id, core_id, core_material_id, inventory_item_id,
     quantity, unit_cost, total_cost, order_id, waste_record_id, notes, created_by)
  VALUES
    ('merma_desperdicio', v_w.raw_material_id, v_w.core_id, v_w.core_material_id, v_w.inventory_item_id,
     -v_w.quantity, v_w.unit_cost, -v_w.total_cost, v_w.order_id, v_w.id,
     'Anulación de desperdicio: ' || trim(p_reason), auth.uid());
END;
$function$;

REVOKE ALL ON FUNCTION public.annul_waste(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.annul_waste(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------
-- register_inventory_exit: la merma de insumos pasa por register_waste
-- (documento con causa y anulación), el resto sigue igual
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_inventory_exit(
  p_item_id uuid,
  p_movement text,
  p_quantity numeric,
  p_notes text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_item public.inventory_items%ROWTYPE;
  v_label text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'Solo administradores o vendedores pueden registrar salidas de inventario';
  END IF;
  IF p_movement NOT IN ('salida_venta', 'consumo_interno', 'merma_desperdicio') THEN
    RAISE EXCEPTION 'Tipo de salida no válido';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  IF p_movement = 'merma_desperdicio' THEN
    PERFORM public.register_waste('insumo', p_item_id, p_quantity, 'otro', NULL, p_notes, NULL);
    RETURN (SELECT current_stock FROM public.inventory_items WHERE id = p_item_id);
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF p_quantity > v_item.current_stock THEN
    RAISE EXCEPTION 'Stock insuficiente de "%": hay % % y se solicitan %',
      v_item.name, v_item.current_stock, v_item.unit, p_quantity;
  END IF;

  v_label := CASE p_movement WHEN 'salida_venta' THEN 'Venta' ELSE 'Consumo interno' END;

  UPDATE public.inventory_items
     SET current_stock = current_stock - p_quantity, updated_at = now()
   WHERE id = v_item.id;

  INSERT INTO public.inventory_transactions
    (movement_type, inventory_item_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES (p_movement::public.inventory_movement_type, v_item.id, p_quantity, v_item.avg_cost,
          ROUND(p_quantity * v_item.avg_cost, 2),
          COALESCE(NULLIF(trim(p_notes), ''), v_label), auth.uid());

  RETURN v_item.current_stock - p_quantity;
END;
$$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.waste_records;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Reportes: mermas netas con detalle por causa (income_statement) y
-- bloque 'waste' en financial_dashboard
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.income_statement(
  p_from date,
  p_to date,
  p_basis text DEFAULT 'despacho',
  p_client uuid DEFAULT NULL,
  p_tax_rate numeric DEFAULT 0.35
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_orders uuid[];
  v_revenue numeric := 0;
  v_rev_stretch numeric := 0;
  v_rev_products numeric := 0;
  v_orders_count integer := 0;
  v_cost_film numeric := 0;
  v_cost_cores numeric := 0;
  v_cost_products numeric := 0;
  v_cost_sales numeric := 0;
  v_mermas numeric := 0;
  v_mermas_by_reason jsonb := '[]'::jsonb;
  v_consumo numeric := 0;
  v_gross numeric;
  v_opex jsonb := '[]'::jsonb;
  v_opex_total numeric := 0;
  v_nonop jsonb := '[]'::jsonb;
  v_nonop_total numeric := 0;
  v_fin_total numeric := 0;
  v_other_income numeric := 0;
  v_cash_adj_loss numeric := 0;
  v_operating numeric;
  v_pretax numeric;
  v_tax numeric;
  v_clients jsonb := '[]'::jsonb;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede consultar el estado de resultados';
  END IF;

  -- Pedidos del periodo
  SELECT array_agg(o.id), COUNT(*), COALESCE(SUM(o.subtotal), 0)
    INTO v_orders, v_orders_count, v_revenue
    FROM public.orders o
   WHERE o.status <> 'cancelado'
     AND (p_client IS NULL OR o.client_id = p_client)
     AND CASE WHEN p_basis = 'pedido'
              THEN o.created_at::date BETWEEN p_from AND p_to
              ELSE o.shipped_at IS NOT NULL AND o.shipped_at::date BETWEEN p_from AND p_to END;
  v_orders := COALESCE(v_orders, '{}');

  SELECT COALESCE(SUM(subtotal), 0) INTO v_rev_stretch FROM public.order_items WHERE order_id = ANY(v_orders);
  SELECT COALESCE(SUM(subtotal), 0) INTO v_rev_products FROM public.order_products WHERE order_id = ANY(v_orders);

  -- Costo de ventas: lo consumido por esos mismos pedidos (principio de asociación)
  SELECT COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'consumo_pedido' AND raw_material_id IS NOT NULL), 0),
         COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'consumo_pedido' AND core_id IS NOT NULL), 0),
         COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'salida_venta'), 0)
    INTO v_cost_film, v_cost_cores, v_cost_products
    FROM public.inventory_transactions
   WHERE order_id = ANY(v_orders) AND movement_type IN ('consumo_pedido', 'salida_venta');
  v_cost_sales := v_cost_film + v_cost_cores + v_cost_products;

  -- Ventas por cliente (top 10)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.revenue DESC), '[]'::jsonb) INTO v_clients FROM (
    SELECT c.business_name AS name, SUM(o.subtotal) AS revenue, COUNT(*) AS orders
      FROM public.orders o JOIN public.clients c ON c.id = o.client_id
     WHERE o.id = ANY(v_orders)
     GROUP BY c.business_name ORDER BY SUM(o.subtotal) DESC LIMIT 10
  ) x;

  IF p_client IS NULL THEN
    -- Otros costos: mermas y consumo interno de inventario del periodo
    -- Mermas NETAS: cada desperdicio suma y su anulación (reverso negativo) resta
    SELECT COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'merma_desperdicio'), 0),
           COALESCE(SUM(abs(total_cost)) FILTER (WHERE movement_type = 'consumo_interno'), 0)
      INTO v_mermas, v_consumo
      FROM public.inventory_transactions
     WHERE created_at::date BETWEEN p_from AND p_to AND movement_type IN ('merma_desperdicio', 'consumo_interno');

    SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'amount', amt) ORDER BY amt DESC), '[]'::jsonb)
      INTO v_mermas_by_reason
      FROM (SELECT COALESCE(w.reason::text, 'otro') AS reason, SUM(t.total_cost) AS amt
              FROM public.inventory_transactions t
              LEFT JOIN public.waste_records w ON w.id = t.waste_record_id
             WHERE t.movement_type = 'merma_desperdicio' AND t.created_at::date BETWEEN p_from AND p_to
             GROUP BY 1 HAVING SUM(t.total_cost) <> 0) x;

    -- Gastos causados (gasto = valor - abono a capital), por grupo y categoría
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'puc', puc_code, 'amount', amt) ORDER BY amt DESC), '[]'::jsonb),
           COALESCE(SUM(amt), 0)
      INTO v_opex, v_opex_total
      FROM (SELECT c.name, c.puc_code, SUM(e.amount - e.principal_amount) AS amt
              FROM public.expenses e JOIN public.expense_categories c ON c.id = e.category_id
             WHERE e.status <> 'anulado' AND e.due_date BETWEEN p_from AND p_to AND c.expense_group = 'operacional'
             GROUP BY c.name, c.puc_code HAVING SUM(e.amount - e.principal_amount) <> 0) t;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', name, 'puc', puc_code, 'group', grp, 'amount', amt) ORDER BY amt DESC), '[]'::jsonb),
           COALESCE(SUM(amt) FILTER (WHERE grp = 'no_operacional'), 0),
           COALESCE(SUM(amt) FILTER (WHERE grp = 'financiero'), 0)
      INTO v_nonop, v_nonop_total, v_fin_total
      FROM (SELECT c.name, c.puc_code, c.expense_group::text AS grp, SUM(e.amount - e.principal_amount) AS amt
              FROM public.expenses e JOIN public.expense_categories c ON c.id = e.category_id
             WHERE e.status <> 'anulado' AND e.due_date BETWEEN p_from AND p_to AND c.expense_group <> 'operacional'
             GROUP BY c.name, c.puc_code, c.expense_group HAVING SUM(e.amount - e.principal_amount) <> 0) t;

    -- Otros ingresos y faltantes/sobrantes de caja (tesorería)
    SELECT COALESCE(SUM(amount) FILTER (WHERE movement_type = 'otro_ingreso' OR (movement_type = 'ajuste' AND direction = 'ingreso')), 0),
           COALESCE(SUM(amount) FILTER (WHERE movement_type = 'otro_egreso' OR (movement_type = 'ajuste' AND direction = 'egreso')), 0)
      INTO v_other_income, v_cash_adj_loss
      FROM public.treasury_movements
     WHERE movement_date BETWEEN p_from AND p_to AND movement_type IN ('otro_ingreso', 'otro_egreso', 'ajuste');
  END IF;

  v_gross := v_revenue - v_cost_sales - v_mermas - v_consumo;
  v_operating := v_gross - v_opex_total;
  v_pretax := v_operating + v_other_income - v_nonop_total - v_fin_total - v_cash_adj_loss;
  v_tax := GREATEST(round(v_pretax * COALESCE(p_tax_rate, 0)), 0);

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to, 'basis', p_basis, 'client_filtered', p_client IS NOT NULL,
    'orders_count', v_orders_count,
    'revenue', v_revenue, 'revenue_stretch', v_rev_stretch, 'revenue_products', v_rev_products,
    'cost_film', v_cost_film, 'cost_cores', v_cost_cores, 'cost_products', v_cost_products, 'cost_sales', v_cost_sales,
    'mermas', v_mermas, 'mermas_by_reason', v_mermas_by_reason, 'consumo_interno', v_consumo,
    'gross_profit', v_gross,
    'opex', v_opex, 'opex_total', v_opex_total,
    'operating_profit', v_operating,
    'other_income', v_other_income,
    'non_operating', v_nonop, 'non_operating_total', v_nonop_total, 'financial_total', v_fin_total,
    'cash_adjustments', v_cash_adj_loss,
    'pretax_profit', v_pretax, 'tax_rate', p_tax_rate, 'income_tax', v_tax,
    'net_profit', v_pretax - v_tax,
    'top_clients', v_clients
  );
END;
$$;

-- ------------------------------------------------------------
-- Panel financiero: indicadores de liquidez, actividad, rentabilidad y controles
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financial_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_prev_month date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_res jsonb;
  v_cash jsonb; v_receivables jsonb; v_payables jsonb; v_expenses jsonb; v_inventory jsonb;
  v_sales jsonb; v_activity jsonb; v_production jsonb; v_controls jsonb; v_waste jsonb;
  v_sales90 numeric; v_cost90 numeric; v_purch90 numeric;
  v_ar numeric; v_ap numeric; v_inv numeric;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede consultar los indicadores';
  END IF;

  -- Efectivo y equivalentes
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(current_balance) FILTER (WHERE is_active), 0),
    'cash', COALESCE(SUM(current_balance) FILTER (WHERE is_active AND account_type = 'caja_general'), 0),
    'banks', COALESCE(SUM(current_balance) FILTER (WHERE is_active AND account_type = 'banco'), 0),
    'petty', COALESCE(SUM(current_balance) FILTER (WHERE is_active AND account_type = 'caja_menor'), 0),
    'petty_fund', COALESCE(SUM(petty_cash_fund) FILTER (WHERE is_active AND account_type = 'caja_menor'), 0),
    'negative_accounts', COALESCE(jsonb_agg(name) FILTER (WHERE is_active AND current_balance < 0), '[]'::jsonb),
    'accounts', COALESCE(jsonb_agg(jsonb_build_object('name', name, 'type', account_type, 'balance', current_balance, 'color', color)
                                    ORDER BY account_type, name) FILTER (WHERE is_active), '[]'::jsonb)
  ) INTO v_cash FROM public.treasury_accounts;

  -- Cuentas por cobrar
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(total_amount - paid_amount), 0),
    'overdue', COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE due_date < v_today), 0),
    'overdue_30', COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE due_date < v_today - 30), 0),
    'due_7', COALESCE(SUM(total_amount - paid_amount) FILTER (WHERE due_date BETWEEN v_today AND v_today + 7), 0),
    'overdue_count', COUNT(*) FILTER (WHERE due_date < v_today)
  ) INTO v_receivables
  FROM public.orders WHERE status <> 'cancelado' AND total_amount - paid_amount > 0;
  v_ar := (v_receivables->>'total')::numeric;

  v_receivables := v_receivables || jsonb_build_object('over_credit', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('name', c.business_name, 'balance', b.bal, 'limit', c.credit_limit))
      FROM (SELECT client_id, SUM(total_amount - paid_amount) AS bal FROM public.orders
             WHERE status <> 'cancelado' GROUP BY client_id) b
      JOIN public.clients c ON c.id = b.client_id
     WHERE c.credit_limit IS NOT NULL AND b.bal > c.credit_limit), '[]'::jsonb));

  -- Cuentas por pagar
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(total - paid_amount), 0),
    'overdue', COALESCE(SUM(total - paid_amount) FILTER (WHERE due_date < v_today), 0),
    'due_7', COALESCE(SUM(total - paid_amount) FILTER (WHERE due_date BETWEEN v_today AND v_today + 7), 0),
    'due_15', COALESCE(SUM(total - paid_amount) FILTER (WHERE due_date <= v_today + 15), 0),
    'overdue_count', COUNT(*) FILTER (WHERE due_date < v_today)
  ) INTO v_payables
  FROM public.purchase_invoices WHERE status IN ('pendiente', 'parcial');
  v_ap := (v_payables->>'total')::numeric;

  -- Gastos fijos / obligaciones
  SELECT jsonb_build_object(
    'pending_month', COALESCE(SUM(amount) FILTER (WHERE period_month = v_month), 0),
    'overdue', COALESCE(SUM(amount) FILTER (WHERE due_date < v_today), 0),
    'overdue_count', COUNT(*) FILTER (WHERE due_date < v_today),
    'due_15', COALESCE(SUM(amount) FILTER (WHERE due_date <= v_today + 15), 0)
  ) INTO v_expenses
  FROM public.expenses WHERE status = 'pendiente';
  v_expenses := v_expenses || jsonb_build_object('fixed_monthly', COALESCE((
    SELECT SUM(amount * CASE frequency WHEN 'quincenal' THEN 2 WHEN 'mensual' THEN 1 WHEN 'bimestral' THEN 0.5
                                       WHEN 'trimestral' THEN 1.0/3 WHEN 'semestral' THEN 1.0/6 WHEN 'anual' THEN 1.0/12 ELSE 0 END)
      FROM public.recurring_expenses WHERE is_active), 0));

  -- Inventario valorizado
  SELECT jsonb_build_object(
    'film', COALESCE((SELECT SUM(current_stock_kg * cost_per_kg) FROM public.raw_materials), 0),
    'core_material', COALESCE((SELECT SUM(current_stock_kg * cost_per_kg) FROM public.core_materials), 0),
    'cores', COALESCE((SELECT SUM(current_stock_units * standard_cost) FROM public.core_specifications), 0),
    'items', COALESCE((SELECT SUM(current_stock * avg_cost) FROM public.inventory_items WHERE is_active), 0),
    'low_stock', (SELECT COUNT(*) FROM public.raw_materials WHERE current_stock_kg <= min_stock_alert_kg)
               + (SELECT COUNT(*) FROM public.core_materials WHERE current_stock_kg <= min_stock_alert_kg)
               + (SELECT COUNT(*) FROM public.core_specifications WHERE current_stock_units <= COALESCE(min_stock_alert_units, 0))
               + (SELECT COUNT(*) FROM public.inventory_items WHERE is_active AND current_stock <= min_stock_alert),
    'low_stock_names', COALESCE((
       SELECT jsonb_agg(n) FROM (
         SELECT name AS n FROM public.raw_materials WHERE current_stock_kg <= min_stock_alert_kg
         UNION ALL SELECT name FROM public.core_materials WHERE current_stock_kg <= min_stock_alert_kg
         UNION ALL SELECT name FROM public.core_specifications WHERE current_stock_units <= COALESCE(min_stock_alert_units, 0)
         UNION ALL SELECT name FROM public.inventory_items WHERE is_active AND current_stock <= min_stock_alert
         LIMIT 12) z), '[]'::jsonb)
  ) INTO v_inventory;
  v_inv := (v_inventory->>'film')::numeric + (v_inventory->>'core_material')::numeric
         + (v_inventory->>'cores')::numeric + (v_inventory->>'items')::numeric;
  v_inventory := v_inventory || jsonb_build_object('total', v_inv);

  -- Ventas (por fecha de pedido, sin IVA)
  SELECT jsonb_build_object(
    'month', COALESCE(SUM(subtotal) FILTER (WHERE created_at >= v_month), 0),
    'prev_month', COALESCE(SUM(subtotal) FILTER (WHERE created_at >= v_prev_month AND created_at < v_month), 0),
    'prev_month_same_day', COALESCE(SUM(subtotal) FILTER (
        WHERE created_at >= v_prev_month AND created_at < v_prev_month + (v_today - v_month) + 1), 0),
    'orders_month', COUNT(*) FILTER (WHERE created_at >= v_month),
    'orders_prev_month', COUNT(*) FILTER (WHERE created_at >= v_prev_month AND created_at < v_month),
    'last_90', COALESCE(SUM(subtotal) FILTER (WHERE created_at >= v_today - 90), 0),
    'active_clients_90', COUNT(DISTINCT client_id) FILTER (WHERE created_at >= v_today - 90)
  ) INTO v_sales
  FROM public.orders WHERE status <> 'cancelado' AND created_at >= v_prev_month - interval '70 days';
  v_sales90 := (v_sales->>'last_90')::numeric;

  v_sales := v_sales || jsonb_build_object('top_client_share_90', COALESCE((
    SELECT MAX(s) / NULLIF(v_sales90, 0) FROM (
      SELECT SUM(subtotal) AS s FROM public.orders
       WHERE status <> 'cancelado' AND created_at >= v_today - 90 GROUP BY client_id) t), 0),
    'top_client_90', (SELECT c.business_name FROM public.orders o JOIN public.clients c ON c.id = o.client_id
                       WHERE o.status <> 'cancelado' AND o.created_at >= v_today - 90
                       GROUP BY c.business_name ORDER BY SUM(o.subtotal) DESC LIMIT 1));

  -- Actividad (rotaciones en días, base últimos 90 días)
  SELECT COALESCE(SUM(abs(total_cost)), 0) INTO v_cost90 FROM public.inventory_transactions
   WHERE created_at >= v_today - 90 AND movement_type IN ('consumo_pedido', 'salida_venta');
  SELECT COALESCE(SUM(total), 0) INTO v_purch90 FROM public.purchase_invoices
   WHERE status <> 'anulada' AND issue_date >= v_today - 90;
  v_activity := jsonb_build_object(
    'dso', CASE WHEN v_sales90 > 0 THEN round(v_ar / (v_sales90 * 1.19 / 90)) END,   -- cartera incluye IVA
    'dpo', CASE WHEN v_purch90 > 0 THEN round(v_ap / (v_purch90 / 90)) END,
    'dio', CASE WHEN v_cost90 > 0 THEN round(v_inv / (v_cost90 / 90)) END,
    'cost_90', v_cost90, 'purchases_90', v_purch90
  );

  -- Producción
  SELECT jsonb_build_object(
    'queue', COUNT(*) FILTER (WHERE status = 'en_cola'),
    'winding', COUNT(*) FILTER (WHERE status = 'en_embobinado'),
    'ready', COUNT(*) FILTER (WHERE status = 'listo_despacho'),
    'late', COUNT(*) FILTER (WHERE status IN ('en_cola', 'en_embobinado', 'listo_despacho') AND delivery_date < v_today),
    'due_today', COUNT(*) FILTER (WHERE status IN ('en_cola', 'en_embobinado', 'listo_despacho') AND delivery_date = v_today)
  ) INTO v_production FROM public.orders;

  -- Desperdicio (Kardex neto: anulaciones restan)
  SELECT jsonb_build_object(
    'cost_month', COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'merma_desperdicio' AND created_at >= v_month), 0),
    'cost_prev_month', COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'merma_desperdicio'
                                                          AND created_at >= v_prev_month AND created_at < v_month), 0),
    'film_kg_month', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'merma_desperdicio' AND raw_material_id IS NOT NULL
                                                       AND created_at >= v_month), 0),
    'film_used_kg_month', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'consumo_pedido' AND raw_material_id IS NOT NULL
                                                            AND created_at >= v_month), 0),
    'film_kg_90', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'merma_desperdicio' AND raw_material_id IS NOT NULL
                                                    AND created_at >= v_today - 90), 0),
    'film_used_kg_90', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'consumo_pedido' AND raw_material_id IS NOT NULL
                                                         AND created_at >= v_today - 90), 0)
  ) INTO v_waste
  FROM public.inventory_transactions
  WHERE created_at >= LEAST(v_prev_month, v_today - 90) AND movement_type IN ('merma_desperdicio', 'consumo_pedido');
  v_waste := v_waste || jsonb_build_object(
    'records_month', (SELECT COUNT(*) FROM public.waste_records WHERE status = 'activo' AND waste_date >= v_month),
    'top_reason_month', (SELECT reason FROM public.waste_records WHERE status = 'activo' AND waste_date >= v_month
                          GROUP BY reason ORDER BY SUM(total_cost) DESC LIMIT 1));

  -- Controles de tesorería
  v_controls := jsonb_build_object(
    'cash_accounts_without_closing_yesterday', COALESCE((
      SELECT jsonb_agg(a.name) FROM public.treasury_accounts a
       WHERE a.is_active AND a.account_type IN ('caja_general', 'caja_menor')
         AND EXISTS (SELECT 1 FROM public.treasury_movements m WHERE m.account_id = a.id)
         AND NOT EXISTS (SELECT 1 FROM public.daily_closings d WHERE d.account_id = a.id AND d.closing_date >= v_today - 1)), '[]'::jsonb),
    'closing_differences_30', COALESCE((SELECT COUNT(*) FROM public.daily_closings
                                         WHERE closing_date >= v_today - 30 AND difference <> 0), 0),
    'egresos_without_support_30', COALESCE((SELECT COUNT(*) FROM public.treasury_movements
                                             WHERE direction = 'egreso' AND support_path IS NULL
                                               AND movement_type IN ('pago_proveedor', 'pago_gasto', 'otro_egreso')
                                               AND movement_date >= v_today - 30), 0),
    'banks_reconciliation', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', a.name,
               'last', (SELECT MAX(statement_date) FROM public.bank_reconciliations r WHERE r.account_id = a.id),
               'unreconciled', (SELECT COUNT(*) FROM public.treasury_movements m WHERE m.account_id = a.id AND NOT m.reconciled),
               'oldest_unreconciled', (SELECT MIN(movement_date) FROM public.treasury_movements m WHERE m.account_id = a.id AND NOT m.reconciled)))
        FROM public.treasury_accounts a WHERE a.is_active AND a.account_type = 'banco'), '[]'::jsonb),
    'payments_without_account_30', COALESCE((SELECT COUNT(*) FROM public.customer_payments WHERE account_id IS NULL AND payment_date >= v_today - 30), 0)
                                   + COALESCE((SELECT COUNT(*) FROM public.supplier_payments WHERE account_id IS NULL AND payment_date >= v_today - 30), 0)
  );

  v_res := jsonb_build_object(
    'generated_at', now(),
    'cash', v_cash, 'receivables', v_receivables, 'payables', v_payables, 'expenses', v_expenses,
    'inventory', v_inventory, 'sales', v_sales, 'activity', v_activity, 'production', v_production, 'waste', v_waste,
    'controls', v_controls,
    'pnl_month', public.income_statement(v_month, v_today, 'pedido', NULL, 0.35),
    'pnl_prev_month', public.income_statement(v_prev_month, (v_month - 1), 'pedido', NULL, 0.35)
  );
  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.income_statement(date, date, text, uuid, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.financial_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.income_statement(date, date, text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.financial_dashboard() TO authenticated;

-- ---------------------------------------------------------------------
-- Los movimientos de Kardex de un desperdicio no se borran (se anula el registro)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_protect_waste_kardex()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.waste_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este movimiento pertenece a un registro de desperdicio: anúlalo desde Inventarios → Desperdicios';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_waste_kardex ON public.inventory_transactions;
CREATE TRIGGER tr_protect_waste_kardex
  BEFORE DELETE ON public.inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_waste_kardex();
REVOKE ALL ON FUNCTION public.fn_protect_waste_kardex() FROM PUBLIC, anon, authenticated;
