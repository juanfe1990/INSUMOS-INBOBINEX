-- =====================================================================
-- Dashboard → Indicadores y alertas POR RANGO DE FECHAS.
--   financial_dashboard(p_from date, p_to date, p_documents text)
--   - Indicadores del periodo (ventas, P&G, márgenes, desperdicio, rotaciones): entre p_from y p_to,
--     comparados con el periodo anterior de la misma duración.
--   - Saldos (caja/bancos, CxC, CxP, gastos pendientes): A LA FECHA DE CORTE p_to.
--   - Inventario, producción y controles: siempre A HOY (no hay foto histórica del stock).
--   - p_documents: 'todos' | 'factura' | 'remision' (aplica a ventas, cartera y P&G de ventas).
--   - Se conservan las claves JSON de la versión anterior (month/prev_month/_90 = periodo/periodo anterior).
-- =====================================================================
DROP FUNCTION IF EXISTS public.financial_dashboard();

CREATE OR REPLACE FUNCTION public.financial_dashboard(p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_documents text DEFAULT 'todos')
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET "TimeZone" TO 'America/Bogota'
AS $function$
DECLARE
  v_today date := current_date;
  v_to date := LEAST(COALESCE(p_to, current_date), current_date);
  v_from date;
  v_days integer;
  v_months integer;
  v_pfrom date; v_pto date;
  v_doc text := COALESCE(NULLIF(p_documents, ''), 'todos');
  v_res jsonb;
  v_cash jsonb; v_receivables jsonb; v_payables jsonb; v_expenses jsonb; v_inventory jsonb;
  v_sales jsonb; v_activity jsonb; v_production jsonb; v_controls jsonb; v_waste jsonb;
  v_sales_p numeric; v_sales_tax_p numeric; v_cost_p numeric; v_purch_p numeric;
  v_ar numeric; v_ap numeric; v_inv numeric;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede consultar los indicadores';
  END IF;
  IF v_doc NOT IN ('todos', 'factura', 'remision') THEN RAISE EXCEPTION 'Filtro de documento inválido'; END IF;
  v_from := COALESCE(p_from, date_trunc('month', v_to)::date);
  IF v_from > v_to THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;
  v_days := (v_to - v_from) + 1;
  v_pto := v_from - 1;
  v_pfrom := v_from - v_days;
  -- Periodos que empiezan el día 1: se comparan con los mismos días de los meses anteriores
  -- (ej. 1–19 nov vs 1–19 oct; jul–sep vs abr–jun).
  IF v_from = date_trunc('month', v_from)::date THEN
    v_months := (extract(year FROM v_to)::int * 12 + extract(month FROM v_to)::int)
              - (extract(year FROM v_from)::int * 12 + extract(month FROM v_from)::int) + 1;
    v_pfrom := (v_from - make_interval(months => v_months))::date;
    IF v_to = (date_trunc('month', v_to) + interval '1 month - 1 day')::date THEN
      v_pto := v_from - 1;
    ELSE
      v_pto := LEAST((v_pfrom + make_interval(months => v_months - 1) + make_interval(days => extract(day FROM v_to)::int - 1))::date,
                     (v_pfrom + make_interval(months => v_months) - interval '1 day')::date);
    END IF;
  END IF;

  -- ---------- Caja y bancos al corte: saldo actual menos lo movido después de v_to ----------
  WITH bal AS (
    SELECT a.id, a.name, a.account_type, a.color, a.petty_cash_fund,
           a.current_balance - COALESCE((SELECT SUM(CASE WHEN m.direction = 'ingreso' THEN m.amount ELSE -m.amount END)
                                           FROM public.treasury_movements m
                                          WHERE m.account_id = a.id AND m.movement_date > v_to), 0) AS balance
      FROM public.treasury_accounts a WHERE a.is_active
  )
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(balance), 0),
    'cash', COALESCE(SUM(balance) FILTER (WHERE account_type = 'caja_general'), 0),
    'banks', COALESCE(SUM(balance) FILTER (WHERE account_type = 'banco'), 0),
    'petty', COALESCE(SUM(balance) FILTER (WHERE account_type = 'caja_menor'), 0),
    'petty_fund', COALESCE(SUM(petty_cash_fund) FILTER (WHERE account_type = 'caja_menor'), 0),
    'negative_accounts', COALESCE(jsonb_agg(name) FILTER (WHERE balance < 0), '[]'::jsonb),
    'accounts', COALESCE(jsonb_agg(jsonb_build_object('name', name, 'type', account_type, 'balance', balance, 'color', color)
                                    ORDER BY account_type, name), '[]'::jsonb)
  ) INTO v_cash FROM bal;

  -- ---------- Cuentas por cobrar al corte ----------
  WITH ar AS (
    SELECT o.client_id, o.due_date,
           o.total_amount - COALESCE((SELECT SUM(cp.amount + cp.withholding_amount) FROM public.customer_payments cp
                                       WHERE cp.order_id = o.id AND cp.payment_date <= v_to), 0) AS bal
      FROM public.orders o
     WHERE o.status <> 'cancelado' AND o.created_at::date <= v_to
       AND (v_doc = 'todos' OR o.document_type = v_doc)
  )
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(bal) FILTER (WHERE bal > 0), 0),
    'overdue', COALESCE(SUM(bal) FILTER (WHERE bal > 0 AND due_date < v_to), 0),
    'overdue_30', COALESCE(SUM(bal) FILTER (WHERE bal > 0 AND due_date < v_to - 30), 0),
    'due_7', COALESCE(SUM(bal) FILTER (WHERE bal > 0 AND due_date BETWEEN v_to AND v_to + 7), 0),
    'overdue_count', COUNT(*) FILTER (WHERE bal > 0 AND due_date < v_to),
    'over_credit', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', c.business_name, 'balance', b.s, 'limit', c.credit_limit))
        FROM (SELECT client_id, SUM(bal) AS s FROM ar GROUP BY client_id) b
        JOIN public.clients c ON c.id = b.client_id
       WHERE c.credit_limit IS NOT NULL AND b.s > c.credit_limit), '[]'::jsonb)
  ) INTO v_receivables FROM ar;
  v_ar := (v_receivables->>'total')::numeric;

  -- ---------- Cuentas por pagar al corte ----------
  WITH ap AS (
    SELECT i.due_date,
           i.total - COALESCE((SELECT SUM(sp.amount) FROM public.supplier_payments sp
                                WHERE sp.invoice_id = i.id AND sp.payment_date <= v_to), 0) AS bal
      FROM public.purchase_invoices i
     WHERE i.status <> 'anulada' AND i.issue_date <= v_to
  )
  SELECT jsonb_build_object(
    'total', COALESCE(SUM(bal) FILTER (WHERE bal > 0), 0),
    'overdue', COALESCE(SUM(bal) FILTER (WHERE bal > 0 AND due_date < v_to), 0),
    'due_7', COALESCE(SUM(bal) FILTER (WHERE bal > 0 AND due_date BETWEEN v_to AND v_to + 7), 0),
    'due_15', COALESCE(SUM(bal) FILTER (WHERE bal > 0 AND due_date <= v_to + 15), 0),
    'overdue_count', COUNT(*) FILTER (WHERE bal > 0 AND due_date < v_to)
  ) INTO v_payables FROM ap;
  v_ap := (v_payables->>'total')::numeric;

  -- ---------- Gastos pendientes al corte ----------
  SELECT jsonb_build_object(
    'pending_month', COALESCE(SUM(amount) FILTER (WHERE due_date BETWEEN v_from AND v_to), 0),
    'overdue', COALESCE(SUM(amount) FILTER (WHERE due_date < v_to), 0),
    'overdue_count', COUNT(*) FILTER (WHERE due_date < v_to),
    'due_15', COALESCE(SUM(amount) FILTER (WHERE due_date <= v_to + 15), 0)
  ) INTO v_expenses
  FROM public.expenses
  WHERE status <> 'anulado' AND (status = 'pendiente' OR (status = 'pagado' AND paid_date > v_to));
  v_expenses := v_expenses || jsonb_build_object('fixed_monthly', COALESCE((
    SELECT SUM(amount * CASE frequency WHEN 'quincenal' THEN 2 WHEN 'mensual' THEN 1 WHEN 'bimestral' THEN 0.5
                                       WHEN 'trimestral' THEN 1.0/3 WHEN 'semestral' THEN 1.0/6 WHEN 'anual' THEN 1.0/12 ELSE 0 END)
      FROM public.recurring_expenses WHERE is_active), 0));

  -- ---------- Inventario (a hoy) ----------
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

  -- ---------- Ventas del periodo vs. periodo anterior ----------
  SELECT jsonb_build_object(
    'month', COALESCE(SUM(subtotal) FILTER (WHERE created_at::date BETWEEN v_from AND v_to), 0),
    'prev_month', COALESCE(SUM(subtotal) FILTER (WHERE created_at::date BETWEEN v_pfrom AND v_pto), 0),
    'prev_month_same_day', COALESCE(SUM(subtotal) FILTER (WHERE created_at::date BETWEEN v_pfrom AND v_pto), 0),
    'orders_month', COUNT(*) FILTER (WHERE created_at::date BETWEEN v_from AND v_to),
    'orders_prev_month', COUNT(*) FILTER (WHERE created_at::date BETWEEN v_pfrom AND v_pto),
    'last_90', COALESCE(SUM(subtotal) FILTER (WHERE created_at::date BETWEEN v_from AND v_to), 0),
    'active_clients_90', COUNT(DISTINCT client_id) FILTER (WHERE created_at::date BETWEEN v_from AND v_to)
  ) INTO v_sales
  FROM public.orders
  WHERE status <> 'cancelado' AND created_at::date BETWEEN v_pfrom AND v_to
    AND (v_doc = 'todos' OR document_type = v_doc);
  v_sales_p := (v_sales->>'month')::numeric;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_sales_tax_p FROM public.orders
   WHERE status <> 'cancelado' AND created_at::date BETWEEN v_from AND v_to AND (v_doc = 'todos' OR document_type = v_doc);

  v_sales := v_sales || jsonb_build_object('top_client_share_90', COALESCE((
    SELECT MAX(s) / NULLIF(v_sales_p, 0) FROM (
      SELECT SUM(subtotal) AS s FROM public.orders
       WHERE status <> 'cancelado' AND created_at::date BETWEEN v_from AND v_to AND (v_doc = 'todos' OR document_type = v_doc)
       GROUP BY client_id) t), 0),
    'top_client_90', (SELECT c.business_name FROM public.orders o JOIN public.clients c ON c.id = o.client_id
                       WHERE o.status <> 'cancelado' AND o.created_at::date BETWEEN v_from AND v_to
                         AND (v_doc = 'todos' OR o.document_type = v_doc)
                       GROUP BY c.business_name ORDER BY SUM(o.subtotal) DESC LIMIT 1));

  -- ---------- Rotaciones (días) sobre la duración del periodo ----------
  SELECT COALESCE(SUM(abs(total_cost)), 0) INTO v_cost_p FROM public.inventory_transactions
   WHERE created_at::date BETWEEN v_from AND v_to AND movement_type IN ('consumo_pedido', 'salida_venta');
  SELECT COALESCE(SUM(total), 0) INTO v_purch_p FROM public.purchase_invoices
   WHERE status <> 'anulada' AND issue_date BETWEEN v_from AND v_to;
  v_activity := jsonb_build_object(
    'dso', CASE WHEN v_sales_tax_p > 0 THEN round(v_ar / (v_sales_tax_p / v_days)) END,
    'dpo', CASE WHEN v_purch_p > 0 THEN round(v_ap / (v_purch_p / v_days)) END,
    'dio', CASE WHEN v_cost_p > 0 THEN round(v_inv / (v_cost_p / v_days)) END,
    'cost_90', v_cost_p, 'purchases_90', v_purch_p
  );

  -- ---------- Producción (a hoy) ----------
  SELECT jsonb_build_object(
    'queue', COUNT(*) FILTER (WHERE status = 'en_cola'),
    'winding', COUNT(*) FILTER (WHERE status = 'en_embobinado'),
    'ready', COUNT(*) FILTER (WHERE status = 'listo_despacho'),
    'late', COUNT(*) FILTER (WHERE status IN ('en_cola', 'en_embobinado', 'listo_despacho') AND delivery_date < v_today),
    'due_today', COUNT(*) FILTER (WHERE status IN ('en_cola', 'en_embobinado', 'listo_despacho') AND delivery_date = v_today)
  ) INTO v_production FROM public.orders;

  -- ---------- Desperdicio del periodo ----------
  SELECT jsonb_build_object(
    'cost_month', COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'merma_desperdicio' AND created_at::date BETWEEN v_from AND v_to), 0),
    'cost_prev_month', COALESCE(SUM(total_cost) FILTER (WHERE movement_type = 'merma_desperdicio' AND created_at::date BETWEEN v_pfrom AND v_pto), 0),
    'film_kg_month', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'merma_desperdicio' AND raw_material_id IS NOT NULL
                                                       AND created_at::date BETWEEN v_from AND v_to), 0),
    'film_used_kg_month', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'consumo_pedido' AND raw_material_id IS NOT NULL
                                                            AND created_at::date BETWEEN v_from AND v_to), 0),
    'film_kg_90', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'merma_desperdicio' AND raw_material_id IS NOT NULL
                                                    AND created_at::date BETWEEN v_from AND v_to), 0),
    'film_used_kg_90', COALESCE(SUM(quantity) FILTER (WHERE movement_type = 'consumo_pedido' AND raw_material_id IS NOT NULL
                                                         AND created_at::date BETWEEN v_from AND v_to), 0)
  ) INTO v_waste
  FROM public.inventory_transactions
  WHERE created_at::date BETWEEN v_pfrom AND v_to AND movement_type IN ('merma_desperdicio', 'consumo_pedido');
  v_waste := v_waste || jsonb_build_object(
    'records_month', (SELECT COUNT(*) FROM public.waste_records WHERE status = 'activo' AND waste_date BETWEEN v_from AND v_to),
    'top_reason_month', (SELECT reason FROM public.waste_records WHERE status = 'activo' AND waste_date BETWEEN v_from AND v_to
                          GROUP BY reason ORDER BY SUM(total_cost) DESC LIMIT 1));

  -- ---------- Controles de tesorería (a hoy) ----------
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
    'payments_without_account_30', COALESCE((SELECT COUNT(*) FROM public.customer_payments WHERE account_id IS NULL AND NOT is_historical AND payment_date >= v_today - 30), 0)
                                   + COALESCE((SELECT COUNT(*) FROM public.supplier_payments WHERE account_id IS NULL AND payment_date >= v_today - 30), 0)
  );

  v_res := jsonb_build_object(
    'generated_at', now(),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_days, 'prev_from', v_pfrom, 'prev_to', v_pto,
                                 'is_today', v_to = v_today, 'documents', v_doc),
    'cash', v_cash, 'receivables', v_receivables, 'payables', v_payables, 'expenses', v_expenses,
    'inventory', v_inventory, 'sales', v_sales, 'activity', v_activity, 'production', v_production, 'waste', v_waste,
    'controls', v_controls,
    'pnl_month', public.income_statement(v_from, v_to, 'pedido', NULL, 0.35, v_doc),
    'pnl_prev_month', public.income_statement(v_pfrom, v_pto, 'pedido', NULL, 0.35, v_doc)
  );
  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.financial_dashboard(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_dashboard(date, date, text) TO authenticated;
