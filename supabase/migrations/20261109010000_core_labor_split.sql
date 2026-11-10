-- =====================================================================
-- Mano de obra de cores separada en dos oficios:
--   1) Armado (labor_cost_per_unit): quien une las piezas para formar la medida.
--   2) Corte de cartón (cardboard_cut_cost_per_unit): solo para medidas que llevan
--      una parte de cartón y el resto de plega (has_cardboard_part = true).
-- Costo de un core = material (peso × costo/kg) + armado + (corte de cartón si aplica).
-- Cada armado deja un registro en core_assembly_labor con lo que corresponde
-- pagar a cada oficio (base para liquidar a los trabajadores).
-- =====================================================================

ALTER TABLE public.core_specifications
  ADD COLUMN IF NOT EXISTS has_cardboard_part boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cardboard_cut_cost_per_unit numeric NOT NULL DEFAULT 0
    CHECK (cardboard_cut_cost_per_unit >= 0);

COMMENT ON COLUMN public.core_specifications.labor_cost_per_unit IS 'Mano de obra de ARMADO por core (COP)';
COMMENT ON COLUMN public.core_specifications.has_cardboard_part IS 'La medida lleva una parte de cartón (el resto es plega)';
COMMENT ON COLUMN public.core_specifications.cardboard_cut_cost_per_unit IS 'Mano de obra de CORTE DE CARTÓN por core (solo si has_cardboard_part)';

-- Registro de mano de obra por armado (documento para liquidar pagos)
CREATE TABLE IF NOT EXISTS public.core_assembly_labor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_date date NOT NULL DEFAULT current_date,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  core_name text NOT NULL,                       -- snapshot (la medida puede borrarse)
  length_cm numeric NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  assembly_cost_per_unit numeric NOT NULL DEFAULT 0,
  assembly_total numeric NOT NULL DEFAULT 0,
  has_cardboard_part boolean NOT NULL DEFAULT false,
  cardboard_cut_cost_per_unit numeric NOT NULL DEFAULT 0,
  cardboard_cut_total numeric NOT NULL DEFAULT 0,
  material_cost numeric NOT NULL DEFAULT 0,
  kg_used numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS core_assembly_labor_date_idx ON public.core_assembly_labor (assembly_date DESC);

ALTER TABLE public.core_assembly_labor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS core_assembly_labor_select ON public.core_assembly_labor;
CREATE POLICY core_assembly_labor_select ON public.core_assembly_labor
  FOR SELECT TO authenticated USING (public.current_user_role() = 'admin');
-- Sin escritura directa: solo la RPC register_core_assembly

-- ---------------------------------------------------------------------
-- register_core_assembly: suma el corte de cartón al costo y registra la mano de obra
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_core_assembly(
  p_core_id uuid,
  p_units integer,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET timezone TO 'America/Bogota'
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_core public.core_specifications%ROWTYPE;
  v_mat public.core_materials%ROWTYPE;
  v_kg numeric;
  v_material_cost numeric;
  v_assembly numeric;
  v_cut_unit numeric;
  v_cut numeric;
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

  v_kg := ROUND(v_core.weight_grams * p_units / 1000.0, 3);
  IF v_kg > v_mat.current_stock_kg THEN
    RAISE EXCEPTION 'Material insuficiente en "%": hay % kg y se requieren % kg (% cores x % g)',
      v_mat.name, ROUND(v_mat.current_stock_kg, 2), ROUND(v_kg, 2), p_units, v_core.weight_grams;
  END IF;

  v_material_cost := v_kg * v_mat.cost_per_kg;
  v_assembly := p_units * v_core.labor_cost_per_unit;
  v_cut_unit := CASE WHEN v_core.has_cardboard_part THEN v_core.cardboard_cut_cost_per_unit ELSE 0 END;
  v_cut := p_units * v_cut_unit;
  v_unit_cost := ROUND((v_material_cost + v_assembly + v_cut) / p_units, 2);
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
          v_note || ' — ' || p_units || ' cores de ' || trim_scale(v_core.length_cm) || ' cm x ' || v_core.weight_grams || ' g',
          auth.uid());

  INSERT INTO public.inventory_transactions
    (movement_type, core_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('produccion_core', v_core.id, p_units, v_unit_cost, ROUND(v_material_cost + v_assembly + v_cut, 2),
          v_note || ' — ' || ROUND(v_kg, 2) || ' kg de material + armado $' || ROUND(v_assembly)
            || CASE WHEN v_cut > 0 THEN ' + corte de cartón $' || ROUND(v_cut) ELSE '' END,
          auth.uid());

  INSERT INTO public.core_assembly_labor
    (core_id, core_name, length_cm, units, assembly_cost_per_unit, assembly_total,
     has_cardboard_part, cardboard_cut_cost_per_unit, cardboard_cut_total, material_cost, kg_used, notes, created_by)
  VALUES
    (v_core.id, v_core.name, v_core.length_cm, p_units, v_core.labor_cost_per_unit, ROUND(v_assembly, 2),
     v_core.has_cardboard_part, v_cut_unit, ROUND(v_cut, 2), ROUND(v_material_cost, 2), v_kg,
     NULLIF(trim(p_notes), ''), auth.uid());

  RETURN jsonb_build_object(
    'units', p_units,
    'kg_used', v_kg,
    'unit_cost', v_unit_cost,
    'assembly_total', ROUND(v_assembly, 2),
    'cardboard_cut_total', ROUND(v_cut, 2),
    'new_stock_units', v_core.current_stock_units + p_units,
    'material_stock_kg', v_mat.current_stock_kg - v_kg
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, text) TO authenticated;
