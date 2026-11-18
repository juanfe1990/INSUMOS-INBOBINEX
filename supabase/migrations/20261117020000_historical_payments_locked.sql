-- =====================================================================
-- Pagos históricos (facturas que ya venían PAGADAS en el Excel)
--  - Ese dinero ya entró antes del sistema: NO deben volver a registrar ingreso.
--  - Se marcan is_historical y quedan BLOQUEADOS (no se editan ni se borran), así
--    nadie les asigna una cuenta de caja/banco por error.
--  - No cuentan como "cobrado" en Cuentas por Cobrar ni en las estadísticas.
--  - Las facturas históricas PENDIENTES siguen en cartera y se cobran normal
--    (con cuenta): ese sí es dinero que entra ahora.
-- =====================================================================
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false;

UPDATE public.customer_payments cp
   SET is_historical = true
  FROM public.orders o
 WHERE o.id = cp.order_id AND o.is_historical AND cp.account_id IS NULL AND cp.reference LIKE 'Histórico %';

CREATE OR REPLACE FUNCTION public.fn_protect_historical_payments()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.is_historical THEN
    RAISE EXCEPTION 'Este pago es histórico (la factura ya venía pagada): no se modifica ni se le asigna cuenta, para no registrar el ingreso dos veces';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_historical_payments ON public.customer_payments;
CREATE TRIGGER tr_protect_historical_payments
  BEFORE UPDATE OR DELETE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_protect_historical_payments();
REVOKE ALL ON FUNCTION public.fn_protect_historical_payments() FROM PUBLIC, anon, authenticated;

-- Estadísticas de clientes: "cobrado en el periodo" sin los pagos históricos
DO $mig$
DECLARE d text; a text;
BEGIN
  d := pg_get_functiondef('public.clients_dashboard(date,date)'::regprocedure);
  a := 'WHERE cp.payment_date BETWEEN p_from AND p_to';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'clients_dashboard: no se encontró el cálculo de cobrado'; END IF;
  EXECUTE replace(d, a, a || ' AND NOT cp.is_historical');
END $mig$;
