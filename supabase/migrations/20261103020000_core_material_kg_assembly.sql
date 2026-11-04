-- ============================================================
-- CORES MANEJADOS POR PESO (KG) + ARMADO POR MEDIDA
--
-- Flujo:
--   1. Compra: el proveedor vende cartón para cores por kg y costo/kg
--      → entra a core_materials (kg, costo promedio ponderado por kg).
--   2. Armado (mano de obra): los operarios unen piezas para formar
--      medidas (15, 30, 45, 50, 60 cm...). RPC register_core_assembly:
--      descuenta kg del material y suma unidades a core_specifications.
--      Costo unitario = kg por core * costo/kg + mano de obra por core.
--   3. Pedido: al pasar a 'listo_despacho' se descuenta 1 core por rollo
--      (sin cambios en fn_descontar_inventario_despacho).
-- ============================================================

ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'consumo_armado_core';

-- ---------- Material de cores (kg) ----------
CREATE TABLE IF NOT EXISTS public.core_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  current_stock_kg numeric NOT NULL DEFAULT 0 CHECK (current_stock_kg >= 0),
  cost_per_kg numeric NOT NULL DEFAULT 0 CHECK (cost_per_kg >= 0),
  min_stock_alert_kg numeric NOT NULL DEFAULT 20,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.core_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leer material de cores" ON public.core_materials
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin crea material de cores" ON public.core_materials
  FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin edita material de cores" ON public.core_materials
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin elimina material de cores" ON public.core_materials
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

-- ---------- Enlaces ----------
ALTER TABLE public.core_specifications
  ADD COLUMN IF NOT EXISTS core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labor_cost_per_unit numeric NOT NULL DEFAULT 0 CHECK (labor_cost_per_unit >= 0);

COMMENT ON COLUMN public.core_specifications.standard_cost IS
  'Costo promedio ponderado por core armado (material + mano de obra). Se recalcula en cada armado.';
COMMENT ON COLUMN public.core_specifications.weight_grams IS
  'Peso promedio del core armado (g). Convierte kg de material <-> unidades.';

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_invoice_items
  ADD COLUMN IF NOT EXISTS core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_core_material ON public.inventory_transactions(core_material_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_core_material ON public.purchase_invoice_items(core_material_id);
CREATE INDEX IF NOT EXISTS idx_core_specifications_core_material ON public.core_specifications(core_material_id);

-- ---------- Datos iniciales: un material por defecto enlazado a las medidas existentes ----------
INSERT INTO public.core_materials (name, notes)
SELECT 'Cartón para cores', 'Material creado automáticamente al pasar los cores a manejo por kg'
WHERE NOT EXISTS (SELECT 1 FROM public.core_materials);

UPDATE public.core_specifications
   SET core_material_id = (SELECT id FROM public.core_materials ORDER BY created_at LIMIT 1)
 WHERE core_material_id IS NULL;

-- ============================================================
-- RPC: Armado de cores (admin y operario)
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_core_assembly(
  p_core_id uuid,
  p_units integer,
  p_kg_used numeric DEFAULT NULL,
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

  SELECT * INTO v_mat FROM public.core_materials WHERE id = v_core.core_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material de cores no encontrado'; END IF;

  IF p_kg_used IS NOT NULL THEN
    IF p_kg_used <= 0 THEN RAISE EXCEPTION 'Los kilos consumidos deben ser mayores a 0'; END IF;
    v_kg := p_kg_used;
  ELSE
    IF COALESCE(v_core.weight_grams, 0) <= 0 THEN
      RAISE EXCEPTION 'La medida "%" no tiene peso promedio definido; indica los kilos consumidos.', v_core.name;
    END IF;
    v_kg := ROUND(v_core.weight_grams * p_units / 1000.0, 3);
  END IF;

  IF v_kg > v_mat.current_stock_kg THEN
    RAISE EXCEPTION 'Material insuficiente en "%": hay % kg y se requieren % kg',
      v_mat.name, ROUND(v_mat.current_stock_kg, 2), ROUND(v_kg, 2);
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

  -- Kardex: salida de kg de material
  INSERT INTO public.inventory_transactions
    (movement_type, core_material_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('consumo_armado_core', v_mat.id, v_kg, v_mat.cost_per_kg, ROUND(v_material_cost, 2),
          v_note || ' — ' || p_units || ' cores de ' || v_core.length_cm || ' cm', auth.uid());

  -- Kardex: entrada de cores armados (material + mano de obra)
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

-- ============================================================
-- RPC: Ajuste de stock del material de cores (conteo físico, solo admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_core_material_stock(
  p_material_id uuid,
  p_new_stock_kg numeric,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mat public.core_materials%ROWTYPE;
  v_diff numeric;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede ajustar el inventario';
  END IF;
  IF p_new_stock_kg IS NULL OR p_new_stock_kg < 0 THEN
    RAISE EXCEPTION 'El stock debe ser 0 o mayor';
  END IF;

  SELECT * INTO v_mat FROM public.core_materials WHERE id = p_material_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Material de cores no encontrado'; END IF;

  v_diff := p_new_stock_kg - v_mat.current_stock_kg;
  IF v_diff = 0 THEN RETURN; END IF;

  UPDATE public.core_materials
     SET current_stock_kg = p_new_stock_kg, updated_at = now()
   WHERE id = v_mat.id;

  -- quantity con signo: positivo = sobrante, negativo = faltante
  INSERT INTO public.inventory_transactions
    (movement_type, core_material_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('ajuste_manual', v_mat.id, v_diff, v_mat.cost_per_kg, ROUND(v_diff * v_mat.cost_per_kg, 2),
          COALESCE(NULLIF(trim(p_notes), ''), 'Ajuste por conteo físico') || ' (' || ROUND(v_mat.current_stock_kg, 2)
            || ' → ' || ROUND(p_new_stock_kg, 2) || ' kg)', auth.uid());
END;
$$;

-- ============================================================
-- Facturas de compra: las líneas "core" ahora son kg de material
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_purchase_invoice(p_invoice jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_id uuid;
  v_supplier public.suppliers%ROWTYPE;
  v_item jsonb;
  v_type public.purchase_item_type;
  v_qty numeric;
  v_cost numeric;
  v_subtotal numeric := 0;
  v_issue date;
  v_due date;
  v_raw public.raw_materials%ROWTYPE;
  v_cmat public.core_materials%ROWTYPE;
  v_invoice_number text;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar facturas de compra';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La factura debe tener al menos una línea';
  END IF;

  SELECT * INTO v_supplier FROM public.suppliers WHERE id = (p_invoice->>'supplier_id')::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proveedor no encontrado';
  END IF;

  v_invoice_number := NULLIF(trim(p_invoice->>'invoice_number'), '');
  IF v_invoice_number IS NULL THEN
    RAISE EXCEPTION 'El número de factura es obligatorio';
  END IF;

  v_issue := COALESCE(NULLIF(p_invoice->>'issue_date', '')::date, current_date);
  v_due := COALESCE(NULLIF(p_invoice->>'due_date', '')::date, v_issue + v_supplier.payment_terms_days);

  SELECT COALESCE(SUM((i->>'quantity')::numeric * (i->>'unit_cost')::numeric), 0)
    INTO v_subtotal FROM jsonb_array_elements(p_items) i;

  INSERT INTO public.purchase_invoices
    (supplier_id, invoice_number, cufe, issue_date, due_date, subtotal, tax_amount, withholding_amount, notes)
  VALUES
    (v_supplier.id, v_invoice_number, NULLIF(trim(p_invoice->>'cufe'), ''), v_issue, v_due, v_subtotal,
     COALESCE((p_invoice->>'tax_amount')::numeric, 0),
     COALESCE((p_invoice->>'withholding_amount')::numeric, 0),
     NULLIF(trim(p_invoice->>'notes'), ''))
  RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_type := (v_item->>'item_type')::public.purchase_item_type;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Cada línea debe tener cantidad mayor a 0'; END IF;
    IF v_cost IS NULL OR v_cost < 0 THEN RAISE EXCEPTION 'Cada línea debe tener un costo válido'; END IF;

    IF v_type = 'bobina' THEN
      SELECT * INTO v_raw FROM public.raw_materials WHERE id = (v_item->>'raw_material_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Bobina madre no encontrada en una línea de la factura'; END IF;

      INSERT INTO public.purchase_invoice_items
        (invoice_id, item_type, raw_material_id, description, quantity, unit, unit_cost)
      VALUES (v_invoice_id, v_type, v_raw.id, COALESCE(NULLIF(trim(v_item->>'description'), ''), v_raw.name), v_qty, 'kg', v_cost);

      -- Costo promedio ponderado por kg
      UPDATE public.raw_materials
         SET cost_per_kg = CASE WHEN current_stock_kg + v_qty > 0
                                THEN ROUND((current_stock_kg * cost_per_kg + v_qty * v_cost) / (current_stock_kg + v_qty), 2)
                                ELSE v_cost END,
             current_stock_kg = current_stock_kg + v_qty,
             updated_at = now()
       WHERE id = v_raw.id;

      INSERT INTO public.inventory_transactions
        (movement_type, raw_material_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('entrada_compra', v_raw.id, v_qty, v_cost, v_qty * v_cost, v_invoice_id,
              'Compra factura ' || v_invoice_number || ' — ' || v_supplier.business_name, auth.uid());

    ELSIF v_type = 'core' THEN
      -- Material de cores comprado por kg
      SELECT * INTO v_cmat FROM public.core_materials WHERE id = (v_item->>'core_material_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Material de cores no encontrado en una línea de la factura'; END IF;

      INSERT INTO public.purchase_invoice_items
        (invoice_id, item_type, core_material_id, description, quantity, unit, unit_cost)
      VALUES (v_invoice_id, v_type, v_cmat.id, COALESCE(NULLIF(trim(v_item->>'description'), ''), v_cmat.name), v_qty, 'kg', v_cost);

      UPDATE public.core_materials
         SET cost_per_kg = CASE WHEN current_stock_kg + v_qty > 0
                                THEN ROUND((current_stock_kg * cost_per_kg + v_qty * v_cost) / (current_stock_kg + v_qty), 2)
                                ELSE v_cost END,
             current_stock_kg = current_stock_kg + v_qty,
             updated_at = now()
       WHERE id = v_cmat.id;

      INSERT INTO public.inventory_transactions
        (movement_type, core_material_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('entrada_compra', v_cmat.id, v_qty, v_cost, v_qty * v_cost, v_invoice_id,
              'Compra factura ' || v_invoice_number || ' — ' || v_supplier.business_name, auth.uid());

    ELSE
      IF NULLIF(trim(v_item->>'description'), '') IS NULL THEN
        RAISE EXCEPTION 'Las líneas de tipo "otro" requieren descripción';
      END IF;
      INSERT INTO public.purchase_invoice_items
        (invoice_id, item_type, description, quantity, unit, unit_cost)
      VALUES (v_invoice_id, v_type, trim(v_item->>'description'), v_qty,
              COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'und'), v_cost);
    END IF;
  END LOOP;

  RETURN v_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.annul_purchase_invoice(p_invoice_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv public.purchase_invoices%ROWTYPE;
  v_item public.purchase_invoice_items%ROWTYPE;
  v_note text;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede anular facturas';
  END IF;

  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura no encontrada'; END IF;
  IF v_inv.status = 'anulada' THEN RAISE EXCEPTION 'La factura ya está anulada'; END IF;
  IF v_inv.paid_amount > 0 THEN
    RAISE EXCEPTION 'La factura tiene pagos registrados; elimínalos antes de anularla';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación';
  END IF;

  v_note := 'Anulación factura ' || v_inv.invoice_number || ': ' || trim(p_reason);

  FOR v_item IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = p_invoice_id LOOP
    IF v_item.item_type = 'bobina' AND v_item.raw_material_id IS NOT NULL THEN
      UPDATE public.raw_materials
         SET current_stock_kg = GREATEST(0, current_stock_kg - v_item.quantity), updated_at = now()
       WHERE id = v_item.raw_material_id;
      INSERT INTO public.inventory_transactions
        (movement_type, raw_material_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.raw_material_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, v_note, auth.uid());
    ELSIF v_item.item_type = 'core' AND v_item.core_material_id IS NOT NULL THEN
      UPDATE public.core_materials
         SET current_stock_kg = GREATEST(0, current_stock_kg - v_item.quantity), updated_at = now()
       WHERE id = v_item.core_material_id;
      INSERT INTO public.inventory_transactions
        (movement_type, core_material_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.core_material_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, v_note, auth.uid());
    ELSIF v_item.item_type = 'core' AND v_item.core_id IS NOT NULL THEN
      -- Líneas antiguas (cores comprados por unidad)
      UPDATE public.core_specifications
         SET current_stock_units = GREATEST(0, current_stock_units - v_item.quantity::integer), updated_at = now()
       WHERE id = v_item.core_id;
      INSERT INTO public.inventory_transactions
        (movement_type, core_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.core_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, v_note, auth.uid());
    END IF;
  END LOOP;

  UPDATE public.purchase_invoices
     SET status = 'anulada', annulled_reason = trim(p_reason), updated_at = now()
   WHERE id = p_invoice_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_core_material_stock(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_core_assembly(uuid, integer, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_core_material_stock(uuid, numeric, text) TO authenticated;

-- Realtime para el panel de inventario
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'core_materials') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.core_materials;
  END IF;
END $$;
