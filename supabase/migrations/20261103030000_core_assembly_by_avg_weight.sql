-- ============================================================
-- El armado de cores descuenta SIEMPRE kg = unidades x peso promedio del core armado.
-- Se elimina el parámetro p_kg_used (kg digitados a mano).
-- ============================================================

DROP FUNCTION IF EXISTS public.register_core_assembly(uuid, integer, numeric, text);

CREATE OR REPLACE FUNCTION public.register_core_assembly(
  p_core_id uuid,
  p_units integer,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_core public.core_specifications%ROWTYPE;
  v_mat public.core_materials%ROWTYPE;
  v_kg numeric;
  v_material_cost numeric;
  v_labor_cost numeric;
  v_unit_cost numeric;
  v_new_avg numeric;
  v_note text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'operario') THEN
    RAISE EXCEPTION 'Solo administradores u operarios pueden registrar armado de cores';
  END IF;
  IF p_units IS NULL OR p_units <= 0 THEN
    RAISE EXCEPTION 'La cantidad de cores debe ser mayor a 0';
  END IF;

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

  -- kg a descontar = unidades x peso promedio del core armado
  v_kg := ROUND(v_core.weight_grams * p_units / 1000.0, 3);

  IF v_kg > v_mat.current_stock_kg THEN
    RAISE EXCEPTION 'Material insuficiente en "%": hay % kg y se requieren % kg (% cores x % g)',
      v_mat.name, ROUND(v_mat.current_stock_kg, 2), ROUND(v_kg, 2), p_units, v_core.weight_grams;
  END IF;

  v_material_cost := v_kg * v_mat.cost_per_kg;
  v_labor_cost := p_units * v_core.labor_cost_per_unit;
  v_unit_cost := ROUND((v_material_cost + v_labor_cost) / p_units, 2);
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
          v_note || ' — ' || p_units || ' cores de ' || v_core.length_cm || ' cm x ' || v_core.weight_grams || ' g',
          auth.uid());

  INSERT INTO public.inventory_transactions
    (movement_type, core_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('produccion_core', v_core.id, p_units, v_unit_cost, ROUND(v_material_cost + v_labor_cost, 2),
          v_note || ' — ' || ROUND(v_kg, 2) || ' kg de material + mano de obra $' || ROUND(v_labor_cost), auth.uid());

  RETURN jsonb_build_object(
    'units', p_units,
    'kg_used', v_kg,
    'unit_cost', v_unit_cost,
    'new_stock_units', v_core.current_stock_units + p_units,
    'material_stock_kg', v_mat.current_stock_kg - v_kg
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, text) TO authenticated;
