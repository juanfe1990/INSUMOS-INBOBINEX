-- ============================================================
-- INVENTARIO GENERAL: cintas, cartón industrial, papel burbuja, etc.
--   inventory_categories → agrupan los productos (pestañas en el panel)
--   inventory_items      → producto con unidad, stock, costo promedio y alerta
-- Entradas: factura de compra (línea 'insumo') o ajuste por conteo (admin).
-- Salidas: venta, consumo interno o merma (RPC register_inventory_exit).
-- ============================================================

ALTER TYPE public.purchase_item_type ADD VALUE IF NOT EXISTS 'insumo';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'salida_venta';
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'consumo_interno';

-- ---------- Categorías ----------
CREATE TABLE IF NOT EXISTS public.inventory_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leer categorias inventario" ON public.inventory_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gestiona categorias inventario" ON public.inventory_categories
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');

-- ---------- Productos ----------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.inventory_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  sku text UNIQUE,
  unit text NOT NULL DEFAULT 'und',              -- und, rollo, caja, paquete, lámina, kg, metro...
  current_stock numeric NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  avg_cost numeric NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),   -- costo promedio ponderado por unidad
  sale_price numeric CHECK (sale_price >= 0),    -- precio de venta sugerido (opcional)
  min_stock_alert numeric NOT NULL DEFAULT 0 CHECK (min_stock_alert >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items(category_id);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leer productos inventario" ON public.inventory_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin crea productos inventario" ON public.inventory_items
  FOR INSERT TO authenticated WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin edita productos inventario" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin elimina productos inventario" ON public.inventory_items
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

-- ---------- Enlaces con Kardex y facturas ----------
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_invoice_items
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item ON public.inventory_transactions(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoice_items_item ON public.purchase_invoice_items(inventory_item_id);

-- ---------- Categorías iniciales ----------
INSERT INTO public.inventory_categories (name, display_order) VALUES
  ('Cintas', 1),
  ('Cartón industrial', 2),
  ('Papel burbuja', 3),
  ('Zuncho y grapas', 4),
  ('Bolsas', 5),
  ('Otros insumos', 99)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- RPC: Salida de inventario (venta, consumo interno, merma) — admin y vendedor
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_inventory_exit(
  p_item_id uuid,
  p_movement text,
  p_quantity numeric,
  p_notes text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_item public.inventory_items%ROWTYPE;
  v_label text;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'Solo administradores o vendedores pueden registrar salidas de inventario';
  END IF;
  IF p_movement NOT IN ('salida_venta', 'consumo_interno', 'merma_desperdicio') THEN
    RAISE EXCEPTION 'Tipo de salida no válido';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
  IF p_quantity > v_item.current_stock THEN
    RAISE EXCEPTION 'Stock insuficiente de "%": hay % % y se solicitan %',
      v_item.name, v_item.current_stock, v_item.unit, p_quantity;
  END IF;

  v_label := CASE p_movement
               WHEN 'salida_venta' THEN 'Venta'
               WHEN 'consumo_interno' THEN 'Consumo interno'
               ELSE 'Merma' END;

  UPDATE public.inventory_items
     SET current_stock = current_stock - p_quantity, updated_at = now()
   WHERE id = v_item.id;

  INSERT INTO public.inventory_transactions
    (movement_type, inventory_item_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES (p_movement::public.inventory_movement_type, v_item.id, p_quantity, v_item.avg_cost,
          ROUND(p_quantity * v_item.avg_cost, 2),
          COALESCE(NULLIF(trim(p_notes), ''), v_label), auth.uid());

  RETURN v_item.current_stock - p_quantity;
END;
$$;

-- ============================================================
-- RPC: Ajuste por conteo físico (solo admin). Si sube el stock y se indica
-- costo unitario, recalcula el costo promedio (útil para el inventario inicial).
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_inventory_item_stock(
  p_item_id uuid,
  p_new_stock numeric,
  p_unit_cost numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item public.inventory_items%ROWTYPE;
  v_diff numeric;
  v_cost numeric;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede ajustar el inventario';
  END IF;
  IF p_new_stock IS NULL OR p_new_stock < 0 THEN
    RAISE EXCEPTION 'El stock debe ser 0 o mayor';
  END IF;
  IF p_unit_cost IS NOT NULL AND p_unit_cost < 0 THEN
    RAISE EXCEPTION 'El costo no puede ser negativo';
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  v_diff := p_new_stock - v_item.current_stock;
  IF v_diff = 0 THEN RETURN; END IF;

  v_cost := CASE WHEN v_diff > 0 AND p_unit_cost IS NOT NULL THEN p_unit_cost ELSE v_item.avg_cost END;

  UPDATE public.inventory_items
     SET avg_cost = CASE WHEN v_diff > 0 AND p_unit_cost IS NOT NULL AND p_new_stock > 0
                         THEN ROUND((v_item.current_stock * v_item.avg_cost + v_diff * p_unit_cost) / p_new_stock, 2)
                         ELSE avg_cost END,
         current_stock = p_new_stock,
         updated_at = now()
   WHERE id = v_item.id;

  -- quantity con signo: positivo = sobrante/entrada, negativo = faltante
  INSERT INTO public.inventory_transactions
    (movement_type, inventory_item_id, quantity, unit_cost, total_cost, notes, created_by)
  VALUES ('ajuste_manual', v_item.id, v_diff, v_cost, ROUND(v_diff * v_cost, 2),
          COALESCE(NULLIF(trim(p_notes), ''), 'Ajuste por conteo físico') || ' (' || v_item.current_stock
            || ' → ' || p_new_stock || ' ' || v_item.unit || ')', auth.uid());
END;
$$;

-- ============================================================
-- Facturas de compra: nueva línea 'insumo' (producto del inventario general)
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
  v_inv public.inventory_items%ROWTYPE;
  v_invoice_number text;
  v_note text;
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
  v_note := 'Compra factura ' || v_invoice_number || ' — ' || v_supplier.business_name;

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

      UPDATE public.raw_materials
         SET cost_per_kg = CASE WHEN current_stock_kg + v_qty > 0
                                THEN ROUND((current_stock_kg * cost_per_kg + v_qty * v_cost) / (current_stock_kg + v_qty), 2)
                                ELSE v_cost END,
             current_stock_kg = current_stock_kg + v_qty,
             updated_at = now()
       WHERE id = v_raw.id;

      INSERT INTO public.inventory_transactions
        (movement_type, raw_material_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('entrada_compra', v_raw.id, v_qty, v_cost, v_qty * v_cost, v_invoice_id, v_note, auth.uid());

    ELSIF v_type = 'core' THEN
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
      VALUES ('entrada_compra', v_cmat.id, v_qty, v_cost, v_qty * v_cost, v_invoice_id, v_note, auth.uid());

    ELSIF v_type = 'insumo' THEN
      SELECT * INTO v_inv FROM public.inventory_items WHERE id = (v_item->>'inventory_item_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Producto de inventario no encontrado en una línea de la factura'; END IF;

      INSERT INTO public.purchase_invoice_items
        (invoice_id, item_type, inventory_item_id, description, quantity, unit, unit_cost)
      VALUES (v_invoice_id, v_type, v_inv.id, COALESCE(NULLIF(trim(v_item->>'description'), ''), v_inv.name),
              v_qty, v_inv.unit, v_cost);

      UPDATE public.inventory_items
         SET avg_cost = CASE WHEN current_stock + v_qty > 0
                             THEN ROUND((current_stock * avg_cost + v_qty * v_cost) / (current_stock + v_qty), 2)
                             ELSE v_cost END,
             current_stock = current_stock + v_qty,
             updated_at = now()
       WHERE id = v_inv.id;

      INSERT INTO public.inventory_transactions
        (movement_type, inventory_item_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('entrada_compra', v_inv.id, v_qty, v_cost, v_qty * v_cost, v_invoice_id, v_note, auth.uid());

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
      UPDATE public.core_specifications
         SET current_stock_units = GREATEST(0, current_stock_units - v_item.quantity::integer), updated_at = now()
       WHERE id = v_item.core_id;
      INSERT INTO public.inventory_transactions
        (movement_type, core_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.core_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, v_note, auth.uid());
    ELSIF v_item.item_type = 'insumo' AND v_item.inventory_item_id IS NOT NULL THEN
      UPDATE public.inventory_items
         SET current_stock = GREATEST(0, current_stock - v_item.quantity), updated_at = now()
       WHERE id = v_item.inventory_item_id;
      INSERT INTO public.inventory_transactions
        (movement_type, inventory_item_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.inventory_item_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, v_note, auth.uid());
    END IF;
  END LOOP;

  UPDATE public.purchase_invoices
     SET status = 'anulada', annulled_reason = trim(p_reason), updated_at = now()
   WHERE id = p_invoice_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.register_inventory_exit(uuid, text, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_inventory_item_stock(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_inventory_exit(uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_stock(uuid, numeric, numeric, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'inventory_items') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'inventory_categories') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_categories;
    END IF;
  END IF;
END $$;
