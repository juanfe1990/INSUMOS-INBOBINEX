-- =====================================================================
-- Pedidos históricos DENTRO del Estado de resultados (decisión del dueño, 2026-11-17;
-- reemplaza la exclusión de 20261117010000).
--  - Ventas: orders.subtotal de los históricos, por fecha de factura (ambas bases).
--  - Costo de ventas: orders.historical_cost (el "Costo sin IVA" del Excel), porque esas
--    ventas no pasaron por el Kardex. No se toca el inventario.
--  - Se informan aparte: revenue_historical y cost_historical.
-- =====================================================================
DO $mig$
DECLARE d text; n text;
  pairs text[][] := ARRAY[
    ARRAY['AND NOT o.is_historical AND (p_client', 'AND (p_client'],
    ARRAY[E'  v_cost_sales numeric := 0;\n', E'  v_cost_sales numeric := 0;\n  v_rev_hist numeric := 0;\n  v_cost_hist numeric := 0;\n'],
    ARRAY['v_cost_sales := v_cost_film + v_cost_cores + v_cost_products;',
          E'SELECT COALESCE(SUM(subtotal) FILTER (WHERE is_historical), 0), COALESCE(SUM(historical_cost) FILTER (WHERE is_historical), 0)\n    INTO v_rev_hist, v_cost_hist FROM public.orders WHERE id = ANY(v_orders);\n  v_cost_sales := v_cost_film + v_cost_cores + v_cost_products + v_cost_hist;'],
    ARRAY['''revenue_products'', v_rev_products,', '''revenue_products'', v_rev_products, ''revenue_historical'', v_rev_hist,'],
    ARRAY['''cost_products'', v_cost_products,', '''cost_products'', v_cost_products, ''cost_historical'', v_cost_hist,']
  ];
  i int;
BEGIN
  d := pg_get_functiondef('public.income_statement(date,date,text,uuid,numeric)'::regprocedure);
  n := d;
  FOR i IN 1 .. array_length(pairs, 1) LOOP
    IF (length(n) - length(replace(n, pairs[i][1], ''))) / length(pairs[i][1]) <> 1 THEN
      RAISE EXCEPTION 'income_statement: el texto % no aparece exactamente una vez', i;
    END IF;
    n := replace(n, pairs[i][1], pairs[i][2]);
  END LOOP;
  EXECUTE n;
END $mig$;
