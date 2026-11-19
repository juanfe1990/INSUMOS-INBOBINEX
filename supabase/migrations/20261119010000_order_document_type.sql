-- =====================================================================
-- Tipo de documento del pedido: FACTURA (electrónica) o REMISIÓN.
--  - orders.document_type ∈ 'factura' | 'remision' (por defecto factura).
--  - create_order lo recibe en p_order->>'document_type'.
--  - income_statement y clients_dashboard reciben p_documents:
--      'todos' (facturados y remisionados) | 'factura' (solo facturados) | 'remision' (solo remisionados).
--    El filtro aplica a las VENTAS (pedidos) y su costo; gastos, mermas y tesorería no tienen
--    tipo de documento y se muestran completos.
-- =====================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'factura'
  CHECK (document_type IN ('factura', 'remision'));

CREATE INDEX IF NOT EXISTS orders_document_type_idx ON public.orders (document_type);

-- ---------- create_order: guarda el tipo de documento ----------
DO $mig$
DECLARE d text; a text; b text;
BEGIN
  d := pg_get_functiondef('public.create_order(jsonb,jsonb,jsonb)'::regprocedure);
  a := 'subtotal, apply_vat, vat_rate, tax_amount, total_amount, payment_terms_days, due_date)';
  b := 'v_subtotal, v_apply_vat, v_vat_rate, v_tax, v_subtotal + v_tax, v_terms, v_delivery + v_terms)';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 OR (length(d) - length(replace(d, b, ''))) / length(b) <> 1 THEN
    RAISE EXCEPTION 'create_order: no se encontró el INSERT de orders';
  END IF;
  d := replace(d, a, 'subtotal, apply_vat, vat_rate, tax_amount, total_amount, payment_terms_days, due_date, document_type)');
  d := replace(d, b, 'v_subtotal, v_apply_vat, v_vat_rate, v_tax, v_subtotal + v_tax, v_terms, v_delivery + v_terms,'
                     || ' CASE WHEN p_order->>''document_type'' = ''remision'' THEN ''remision'' ELSE ''factura'' END)');
  EXECUTE d;
END $mig$;

-- ---------- income_statement(..., p_documents) ----------
DO $mig$
DECLARE d text; a text;
BEGIN
  d := pg_get_functiondef('public.income_statement(date,date,text,uuid,numeric)'::regprocedure);
  a := 'p_tax_rate numeric DEFAULT 0.35)';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'income_statement: firma no encontrada'; END IF;
  d := replace(d, a, 'p_tax_rate numeric DEFAULT 0.35, p_documents text DEFAULT ''todos''::text)');
  a := 'AND (p_client IS NULL OR o.client_id = p_client)';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'income_statement: filtro de cliente'; END IF;
  d := replace(d, a, a || E'\n     AND (COALESCE(p_documents, ''todos'') = ''todos'' OR o.document_type = p_documents)');
  a := '''from'', p_from, ''to'', p_to,';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'income_statement: retorno'; END IF;
  d := replace(d, a, a || ' ''documents'', COALESCE(p_documents, ''todos''),');
  DROP FUNCTION public.income_statement(date, date, text, uuid, numeric);
  EXECUTE d;
END $mig$;
REVOKE ALL ON FUNCTION public.income_statement(date, date, text, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.income_statement(date, date, text, uuid, numeric, text) TO authenticated;

-- ---------- clients_dashboard(p_from, p_to, p_documents) ----------
DO $mig$
DECLARE d text; a text; f text := ' AND (COALESCE(p_documents, ''todos'') = ''todos'' OR document_type = p_documents)';
BEGIN
  d := pg_get_functiondef('public.clients_dashboard(date,date)'::regprocedure);
  a := 'clients_dashboard(p_from date, p_to date)';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'clients_dashboard: firma'; END IF;
  d := replace(d, a, 'clients_dashboard(p_from date, p_to date, p_documents text DEFAULT ''todos''::text)');
  -- pedidos del periodo
  a := 'WHERE o.status <> ''cancelado'' AND o.created_at::date BETWEEN p_from AND p_to;';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'clients_dashboard: v_ids'; END IF;
  d := replace(d, a, 'WHERE o.status <> ''cancelado'' AND o.created_at::date BETWEEN p_from AND p_to'
                     || ' AND (COALESCE(p_documents, ''todos'') = ''todos'' OR o.document_type = p_documents);');
  -- periodo anterior
  a := 'WHERE status <> ''cancelado'' AND created_at::date BETWEEN v_prev_from AND v_prev_to;';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'clients_dashboard: previo'; END IF;
  d := replace(d, a, 'WHERE status <> ''cancelado'' AND created_at::date BETWEEN v_prev_from AND v_prev_to' || f || ';');
  -- cartera abierta
  a := 'WHERE status <> ''cancelado'' AND total_amount - paid_amount > 0)';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'clients_dashboard: cartera'; END IF;
  d := replace(d, a, 'WHERE status <> ''cancelado'' AND total_amount - paid_amount > 0' || f || ')');
  -- cobrado: solo pagos de pedidos del tipo elegido
  a := 'AND NOT cp.is_historical)';
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'clients_dashboard: cobrado'; END IF;
  d := replace(d, a, 'AND NOT cp.is_historical AND (COALESCE(p_documents, ''todos'') = ''todos'' OR'
                     || ' EXISTS (SELECT 1 FROM public.orders od WHERE od.id = cp.order_id AND od.document_type = p_documents)))');
  a := '''from'', p_from, ''to'', p_to, ''summary''';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'clients_dashboard: retorno'; END IF;
  d := replace(d, a, '''from'', p_from, ''to'', p_to, ''documents'', COALESCE(p_documents, ''todos''), ''summary''');
  DROP FUNCTION public.clients_dashboard(date, date);
  EXECUTE d;
END $mig$;
REVOKE ALL ON FUNCTION public.clients_dashboard(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clients_dashboard(date, date, text) TO authenticated;
