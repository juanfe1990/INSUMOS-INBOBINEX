-- =====================================================================
-- Pedidos HISTÓRICOS (cargados desde "ARCHIVO PARA CARGAR JUANES.xlsx")
--  - invoice_number: número de factura ("FE 310"); útil también para la factura electrónica.
--  - is_historical: no pasaron por el sistema (sin stretch ni inventario).
--    * Cuentan en cartera (CxC) y en las estadísticas de clientes.
--    * NO cuentan en el Estado de resultados (decisión del dueño, 2026-11-17).
--  - historical_cost / historical_description: costo sin IVA y descripción tal como venían.
-- Los pagos históricos se registran en customer_payments SIN account_id (no mueven
-- caja ni bancos: ese dinero entró antes del sistema) y no disparan la alerta de
-- "pagos sin cuenta" del Dashboard.
-- =====================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS historical_cost numeric,
  ADD COLUMN IF NOT EXISTS historical_description text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_invoice_number_key ON public.orders (invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_is_historical_idx ON public.orders (is_historical) WHERE is_historical;

DO $mig$
DECLARE d text; n text; a text; b text;
BEGIN
  -- Estado de resultados: excluir pedidos históricos
  d := pg_get_functiondef('public.income_statement(date,date,text,uuid,numeric)'::regprocedure);
  a := 'AND (p_client IS NULL OR o.client_id = p_client)';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'income_statement: no se encontró el filtro de pedidos';
  END IF;
  EXECUTE replace(d, a, 'AND NOT o.is_historical ' || a);

  -- Dashboard: los pagos históricos (sin cuenta) no son alerta
  d := pg_get_functiondef('public.financial_dashboard()'::regprocedure);
  a := 'FROM public.customer_payments WHERE account_id IS NULL AND payment_date >= v_today - 30';
  b := a || ' AND order_id NOT IN (SELECT id FROM public.orders WHERE is_historical)';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'financial_dashboard: no se encontró el control de pagos sin cuenta'; END IF;
  EXECUTE replace(d, a, b);
END $mig$;
