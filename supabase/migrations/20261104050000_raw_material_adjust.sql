-- =====================================================================
-- Bobinas madre: las COMPRAS entran solo por factura de compra
-- (register_purchase_invoice: proveedor + CxP + Kardex + costo promedio).
-- Este RPC es para conteo físico / inventario inicial, de forma atómica
-- (antes el panel hacía UPDATE + INSERT por separado).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.adjust_raw_material_stock(
  p_raw_id uuid,
  p_new_stock_kg numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw public.raw_materials%ROWTYPE;
  v_diff numeric;
  v_cost numeric;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede ajustar el inventario';
  END IF;
  IF p_new_stock_kg IS NULL OR p_new_stock_kg < 0 THEN
    RAISE EXCEPTION 'El stock debe ser 0 o mayor';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'El costo no puede ser negativo';
  END IF;

  SELECT * INTO v_raw FROM public.raw_materials WHERE id = p_raw_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bobina madre no encontrada'; END IF;

  v_diff := p_new_stock_kg - v_raw.current_stock_kg;
  IF v_diff = 0 THEN RETURN; END IF;

  -- Costo de lo que entra: el digitado (inventario inicial) o el promedio actual.
  -- Si entra con costo propio, el promedio se recalcula ponderado.
  v_cost := COALESCE(p_unit_cost, v_raw.cost_per_kg);

  UPDATE public.raw_materials
     SET current_stock_kg = p_new_stock_kg,
         cost_per_kg = CASE
           WHEN v_diff > 0 AND p_unit_cost IS NOT NULL AND p_new_stock_kg > 0 THEN
             ROUND((v_raw.current_stock_kg * v_raw.cost_per_kg + v_diff * p_unit_cost) / p_new_stock_kg, 2)
           ELSE v_raw.cost_per_kg
         END,
         updated_at = now()
   WHERE id = v_raw.id;

  INSERT INTO public.inventory_transactions
    (movement_type, raw_material_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('ajuste_manual', v_raw.id, v_diff,
          CASE WHEN v_diff > 0 THEN v_cost ELSE v_raw.cost_per_kg END,
          ROUND(v_diff * CASE WHEN v_diff > 0 THEN v_cost ELSE v_raw.cost_per_kg END, 2),
          COALESCE(NULLIF(trim(p_notes), ''), 'Ajuste por conteo físico') || ' (' || ROUND(v_raw.current_stock_kg, 2)
            || ' → ' || ROUND(p_new_stock_kg, 2) || ' kg)',
          auth.uid());
END;
$function$;

REVOKE ALL ON FUNCTION public.adjust_raw_material_stock(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_raw_material_stock(uuid, numeric, numeric, text) TO authenticated;

-- Cores armados: vaciado / conteo atómico (las unidades normales entran por armado)
CREATE OR REPLACE FUNCTION public.adjust_core_stock(p_core_id uuid, p_new_units integer, p_notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_core public.core_specifications%ROWTYPE;
  v_diff integer;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede ajustar el inventario';
  END IF;
  IF p_new_units IS NULL OR p_new_units < 0 THEN
    RAISE EXCEPTION 'El stock debe ser 0 o mayor';
  END IF;

  SELECT * INTO v_core FROM public.core_specifications WHERE id = p_core_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Core no encontrado'; END IF;

  v_diff := p_new_units - v_core.current_stock_units;
  IF v_diff = 0 THEN RETURN; END IF;

  UPDATE public.core_specifications
     SET current_stock_units = p_new_units, updated_at = now()
   WHERE id = v_core.id;

  INSERT INTO public.inventory_transactions
    (movement_type, core_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('ajuste_manual', v_core.id, v_diff, v_core.standard_cost, ROUND(v_diff * v_core.standard_cost, 2),
          COALESCE(NULLIF(trim(p_notes), ''), 'Ajuste por conteo físico') || ' (' || v_core.current_stock_units
            || ' → ' || p_new_units || ' und)',
          auth.uid());
END;
$function$;

REVOKE ALL ON FUNCTION public.adjust_core_stock(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_core_stock(uuid, integer, text) TO authenticated;
