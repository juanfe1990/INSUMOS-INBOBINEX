-- ============================================================
-- REPORTES FINANCIEROS
--   income_statement(...)   → Estado de resultados (P&G) por causación, con filtros
--   financial_dashboard()   → Indicadores financieros y datos para alertas tempranas
-- Solo admin. Todo se calcula desde los documentos fuente (pedidos, Kardex, gastos, tesorería).
-- ============================================================

-- ------------------------------------------------------------
-- Estado de resultados
--   p_basis: 'despacho' (ventas reconocidas al enviar el pedido) | 'pedido' (fecha de creación)
--   p_client: filtra ventas y costo de ventas por cliente (los gastos de la empresa se omiten)
--   p_tax_rate: tasa para la provisión de impuesto de renta (informativa)
-- ------------------------------------------------------------
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
    SELECT COALESCE(SUM(abs(total_cost)) FILTER (WHERE movement_type = 'merma_desperdicio'), 0),
           COALESCE(SUM(abs(total_cost)) FILTER (WHERE movement_type = 'consumo_interno'), 0)
      INTO v_mermas, v_consumo
      FROM public.inventory_transactions
     WHERE created_at::date BETWEEN p_from AND p_to AND movement_type IN ('merma_desperdicio', 'consumo_interno');

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
    'mermas', v_mermas, 'consumo_interno', v_consumo,
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
  v_sales jsonb; v_activity jsonb; v_production jsonb; v_controls jsonb;
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
    'inventory', v_inventory, 'sales', v_sales, 'activity', v_activity, 'production', v_production,
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
