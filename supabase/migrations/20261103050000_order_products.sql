-- ============================================================
-- PEDIDOS CON CUALQUIER TIPO DE INVENTARIO
--   order_items     → stretch fabricado en planta: MÁXIMO 1 medida por pedido (índice único)
--   order_products  → productos que salen de bodega tal cual: insumos (cintas, cartón...),
--                     bobina madre (kg), cores armados (und) o material de cores (kg)
-- Un pedido sin stretch no pasa por planta: se crea y queda en 'listo_despacho'.
-- El inventario se descuenta al pasar a 'listo_despacho' (trigger existente, ampliado).
-- ============================================================

-- Regla "una sola medida por pedido" garantizada en la base
CREATE UNIQUE INDEX IF NOT EXISTS order_items_one_measure_per_order ON public.order_items(order_id);

CREATE TABLE IF NOT EXISTS public.order_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('insumo', 'bobina', 'core', 'material_core')),
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL,
  description text NOT NULL,
  unit text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_products_order ON public.order_products(order_id);

ALTER TABLE public.order_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin y Vendedor gestionan productos del pedido" ON public.order_products
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'vendedor'))
  WITH CHECK (public.current_user_role() IN ('admin', 'vendedor'));
CREATE POLICY "Operario consulta productos del pedido" ON public.order_products
  FOR SELECT TO authenticated USING (public.current_user_role() = 'operario');

-- ============================================================
-- RPC: crear pedido completo (atómico)
--   p_order   : { client_id, priority, delivery_date, delivery_address, notes }
--   p_stretch : null | { raw_material_id, core_id, quantity, weight_grams, unit_price }
--   p_products: [ { kind, ref_id, quantity, unit_price } ]
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_order(p_order jsonb, p_stretch jsonb, p_products jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_order public.orders%ROWTYPE;
  v_has_stretch boolean := p_stretch IS NOT NULL AND jsonb_typeof(p_stretch) = 'object';
  v_products jsonb := COALESCE(p_products, '[]'::jsonb);
  v_raw public.raw_materials%ROWTYPE;
  v_core public.core_specifications%ROWTYPE;
  v_qty integer;
  v_weight numeric;
  v_price numeric;
  v_film_kg numeric := 0;
  v_total numeric := 0;
  v_product_id uuid;
  v_line jsonb;
  v_kind text;
  v_ref uuid;
  v_lqty numeric;
  v_lprice numeric;
  v_desc text;
  v_unit text;
  v_stock numeric;
  v_used numeric;
  v_status public.order_status;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'Solo administradores o vendedores pueden crear pedidos';
  END IF;
  IF jsonb_typeof(v_products) <> 'array' THEN
    RAISE EXCEPTION 'Formato de productos inválido';
  END IF;
  IF NOT v_has_stretch AND jsonb_array_length(v_products) = 0 THEN
    RAISE EXCEPTION 'El pedido debe incluir el stretch a fabricar o al menos un producto';
  END IF;
  IF NULLIF(p_order->>'client_id', '') IS NULL THEN
    RAISE EXCEPTION 'Selecciona un cliente';
  END IF;

  -- ---------- Validación del stretch (medida única) ----------
  IF v_has_stretch THEN
    v_qty := (p_stretch->>'quantity')::integer;
    v_weight := (p_stretch->>'weight_grams')::numeric;
    v_price := COALESCE((p_stretch->>'unit_price')::numeric, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'La cantidad de rollos debe ser mayor a 0'; END IF;
    IF v_weight IS NULL OR v_weight <= 0 THEN RAISE EXCEPTION 'Indica el peso total por rollo'; END IF;

    SELECT * INTO v_raw FROM public.raw_materials WHERE id = (p_stretch->>'raw_material_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bobina madre no encontrada'; END IF;
    SELECT * INTO v_core FROM public.core_specifications WHERE id = (p_stretch->>'core_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Core no encontrado'; END IF;
    IF v_core.length_cm <> v_raw.width_cm THEN
      RAISE EXCEPTION 'El core (% cm) no coincide con el ancho de la bobina (% cm)', v_core.length_cm, v_raw.width_cm;
    END IF;
    IF v_weight <= v_core.weight_grams THEN
      RAISE EXCEPTION 'El peso por rollo (% g) debe ser mayor al peso del core (% g)', v_weight, v_core.weight_grams;
    END IF;
    v_film_kg := (v_weight - v_core.weight_grams) * v_qty / 1000.0;
    v_total := v_total + v_qty * v_price;
  END IF;

  -- ---------- Validación de stock de productos (acumulando lo que usa el stretch) ----------
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_products) LOOP
    v_kind := v_line->>'kind';
    v_ref := NULLIF(v_line->>'ref_id', '')::uuid;
    v_lqty := (v_line->>'quantity')::numeric;
    v_lprice := COALESCE((v_line->>'unit_price')::numeric, 0);
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Hay una línea de producto sin seleccionar'; END IF;
    IF v_lqty IS NULL OR v_lqty <= 0 THEN RAISE EXCEPTION 'Cada producto debe tener cantidad mayor a 0'; END IF;
    IF v_lprice < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;

    -- total solicitado de esa misma referencia en todas las líneas
    SELECT COALESCE(SUM((l->>'quantity')::numeric), 0) INTO v_used
      FROM jsonb_array_elements(v_products) l
     WHERE l->>'kind' = v_kind AND l->>'ref_id' = v_ref::text;

    IF v_kind = 'insumo' THEN
      SELECT current_stock, name, unit INTO v_stock, v_desc, v_unit FROM public.inventory_items WHERE id = v_ref;
    ELSIF v_kind = 'bobina' THEN
      SELECT current_stock_kg, name, 'kg' INTO v_stock, v_desc, v_unit FROM public.raw_materials WHERE id = v_ref;
      IF v_has_stretch AND v_ref = v_raw.id THEN v_used := v_used + v_film_kg; END IF;
    ELSIF v_kind = 'core' THEN
      SELECT current_stock_units, name, 'und' INTO v_stock, v_desc, v_unit FROM public.core_specifications WHERE id = v_ref;
      IF v_has_stretch AND v_ref = v_core.id THEN v_used := v_used + v_qty; END IF;
    ELSIF v_kind = 'material_core' THEN
      SELECT current_stock_kg, name, 'kg' INTO v_stock, v_desc, v_unit FROM public.core_materials WHERE id = v_ref;
    ELSE
      RAISE EXCEPTION 'Tipo de producto no válido: %', v_kind;
    END IF;
    IF NOT FOUND OR v_desc IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_used > v_stock THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % % y el pedido requiere %', v_desc, ROUND(v_stock, 2), v_unit, ROUND(v_used, 2);
    END IF;

    v_total := v_total + v_lqty * v_lprice;
  END LOOP;

  -- Stretch: cores y película (si no se validaron ya junto con productos)
  IF v_has_stretch THEN
    IF v_qty > v_core.current_stock_units THEN
      RAISE EXCEPTION 'No hay suficientes cores de % cm: disponibles %, solicitados %', v_core.length_cm, v_core.current_stock_units, v_qty;
    END IF;
    IF v_film_kg > v_raw.current_stock_kg THEN
      RAISE EXCEPTION 'Película insuficiente en "%": se requieren % kg y hay % kg', v_raw.name, ROUND(v_film_kg, 2), ROUND(v_raw.current_stock_kg, 2);
    END IF;
  END IF;

  -- ---------- Cabecera ----------
  INSERT INTO public.orders
    (client_id, created_by, priority, status, delivery_date, delivery_address, notes, total_amount)
  VALUES
    ((p_order->>'client_id')::uuid, auth.uid(),
     COALESCE(NULLIF(p_order->>'priority', ''), 'normal')::public.order_priority,
     'en_cola',
     (p_order->>'delivery_date')::date,
     COALESCE(p_order->>'delivery_address', ''),
     NULLIF(trim(p_order->>'notes'), ''),
     v_total)
  RETURNING * INTO v_order;

  -- ---------- Stretch (única medida) ----------
  IF v_has_stretch THEN
    SELECT id INTO v_product_id FROM public.products ORDER BY created_at LIMIT 1;
    IF v_product_id IS NULL THEN
      INSERT INTO public.products (name, slug, film_type)
      VALUES ('Bobina Vinipel Estándar', 'bobina-vinipel-estandar-' || extract(epoch FROM now())::bigint, 'manual')
      RETURNING id INTO v_product_id;
    END IF;

    INSERT INTO public.order_items
      (order_id, product_id, quantity, raw_material_id, core_id, custom_length_cm, custom_caliber_microns,
       weight_grams, core_weight_grams, unit_price, subtotal, notes)
    VALUES
      (v_order.id, v_product_id, v_qty, v_raw.id, v_core.id, v_raw.width_cm, v_raw.caliber_microns,
       v_weight, v_core.weight_grams, v_price, v_qty * v_price,
       'Stretch ' || initcap(v_raw.color) || ' · ' || v_raw.width_cm || ' cm · ' || v_raw.caliber_microns || ' µ');
  END IF;

  -- ---------- Productos ----------
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_products) LOOP
    v_kind := v_line->>'kind';
    v_ref := (v_line->>'ref_id')::uuid;
    IF v_kind = 'insumo' THEN
      INSERT INTO public.order_products (order_id, kind, inventory_item_id, description, unit, quantity, unit_price)
      SELECT v_order.id, v_kind, id, name, unit, (v_line->>'quantity')::numeric, COALESCE((v_line->>'unit_price')::numeric, 0)
        FROM public.inventory_items WHERE id = v_ref;
    ELSIF v_kind = 'bobina' THEN
      INSERT INTO public.order_products (order_id, kind, raw_material_id, description, unit, quantity, unit_price)
      SELECT v_order.id, v_kind, id, name || ' (bobina madre)', 'kg', (v_line->>'quantity')::numeric, COALESCE((v_line->>'unit_price')::numeric, 0)
        FROM public.raw_materials WHERE id = v_ref;
    ELSIF v_kind = 'core' THEN
      INSERT INTO public.order_products (order_id, kind, core_id, description, unit, quantity, unit_price)
      SELECT v_order.id, v_kind, id, name || ' (cores)', 'und', (v_line->>'quantity')::numeric, COALESCE((v_line->>'unit_price')::numeric, 0)
        FROM public.core_specifications WHERE id = v_ref;
    ELSE
      INSERT INTO public.order_products (order_id, kind, core_material_id, description, unit, quantity, unit_price)
      SELECT v_order.id, v_kind, id, name || ' (material cores)', 'kg', (v_line->>'quantity')::numeric, COALESCE((v_line->>'unit_price')::numeric, 0)
        FROM public.core_materials WHERE id = v_ref;
    END IF;
  END LOOP;

  -- Sin stretch no hay nada que fabricar: queda listo para despacho y el trigger descuenta el inventario
  v_status := 'en_cola';
  IF NOT v_has_stretch THEN
    UPDATE public.orders SET status = 'listo_despacho', completed_at = now(), updated_at = now()
     WHERE id = v_order.id;
    v_status := 'listo_despacho';
  END IF;

  RETURN jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number, 'status', v_status, 'total', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb) TO authenticated;

-- ============================================================
-- Trigger de despacho: además del stretch, descuenta los productos del pedido
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_descontar_inventario_despacho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_prod RECORD;
  v_film_kg numeric;
  v_cost numeric;
  v_stock numeric;
  v_note text;
BEGIN
  IF NEW.status = 'listo_despacho' AND OLD.status IS DISTINCT FROM 'listo_despacho' THEN

    -- ---------- Stretch fabricado ----------
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      IF v_item.raw_material_id IS NOT NULL THEN
        v_film_kg := (GREATEST(v_item.weight_grams - v_item.core_weight_grams, 0) * v_item.quantity) / 1000.0;

        UPDATE public.raw_materials
           SET current_stock_kg = GREATEST(0, current_stock_kg - v_film_kg),
               updated_at = now()
         WHERE id = v_item.raw_material_id
        RETURNING cost_per_kg INTO v_cost;

        IF FOUND THEN
          INSERT INTO public.inventory_transactions
            (movement_type, raw_material_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES
            ('consumo_pedido', v_item.raw_material_id, v_film_kg, v_cost, v_film_kg * v_cost, NEW.id,
             'Película consumida orden #' || NEW.order_number || ' (' || v_item.quantity || ' rollos x '
               || (v_item.weight_grams - v_item.core_weight_grams) || ' g)',
             NEW.created_by);
        END IF;
      END IF;

      IF v_item.core_id IS NOT NULL THEN
        UPDATE public.core_specifications
           SET current_stock_units = GREATEST(0, current_stock_units - v_item.quantity),
               updated_at = now()
         WHERE id = v_item.core_id
        RETURNING standard_cost INTO v_cost;

        IF FOUND THEN
          INSERT INTO public.inventory_transactions
            (movement_type, core_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES
            ('consumo_pedido', v_item.core_id, v_item.quantity, v_cost, v_item.quantity * v_cost, NEW.id,
             'Cores consumidos orden #' || NEW.order_number,
             NEW.created_by);
        END IF;
      END IF;
    END LOOP;

    -- ---------- Productos que salen de bodega ----------
    FOR v_prod IN SELECT * FROM public.order_products WHERE order_id = NEW.id LOOP
      v_note := 'Venta orden #' || NEW.order_number || ' — ' || v_prod.description;

      IF v_prod.kind = 'insumo' AND v_prod.inventory_item_id IS NOT NULL THEN
        SELECT current_stock, avg_cost INTO v_stock, v_cost FROM public.inventory_items
         WHERE id = v_prod.inventory_item_id FOR UPDATE;
        IF FOUND THEN
          IF v_prod.quantity > v_stock THEN
            RAISE EXCEPTION 'Stock insuficiente de "%" para despachar la orden #%: hay % %, se requieren %',
              v_prod.description, NEW.order_number, v_stock, v_prod.unit, v_prod.quantity;
          END IF;
          UPDATE public.inventory_items SET current_stock = current_stock - v_prod.quantity, updated_at = now()
           WHERE id = v_prod.inventory_item_id;
          INSERT INTO public.inventory_transactions
            (movement_type, inventory_item_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES ('salida_venta', v_prod.inventory_item_id, v_prod.quantity, v_cost, ROUND(v_prod.quantity * v_cost, 2),
                  NEW.id, v_note, NEW.created_by);
        END IF;

      ELSIF v_prod.kind = 'bobina' AND v_prod.raw_material_id IS NOT NULL THEN
        SELECT current_stock_kg, cost_per_kg INTO v_stock, v_cost FROM public.raw_materials
         WHERE id = v_prod.raw_material_id FOR UPDATE;
        IF FOUND THEN
          IF v_prod.quantity > v_stock THEN
            RAISE EXCEPTION 'Stock insuficiente de "%" para despachar la orden #%: hay % kg, se requieren %',
              v_prod.description, NEW.order_number, ROUND(v_stock, 2), v_prod.quantity;
          END IF;
          UPDATE public.raw_materials SET current_stock_kg = current_stock_kg - v_prod.quantity, updated_at = now()
           WHERE id = v_prod.raw_material_id;
          INSERT INTO public.inventory_transactions
            (movement_type, raw_material_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES ('salida_venta', v_prod.raw_material_id, v_prod.quantity, v_cost, ROUND(v_prod.quantity * v_cost, 2),
                  NEW.id, v_note, NEW.created_by);
        END IF;

      ELSIF v_prod.kind = 'core' AND v_prod.core_id IS NOT NULL THEN
        SELECT current_stock_units, standard_cost INTO v_stock, v_cost FROM public.core_specifications
         WHERE id = v_prod.core_id FOR UPDATE;
        IF FOUND THEN
          IF v_prod.quantity > v_stock THEN
            RAISE EXCEPTION 'Stock insuficiente de "%" para despachar la orden #%: hay % und, se requieren %',
              v_prod.description, NEW.order_number, v_stock, v_prod.quantity;
          END IF;
          UPDATE public.core_specifications
             SET current_stock_units = current_stock_units - v_prod.quantity::integer, updated_at = now()
           WHERE id = v_prod.core_id;
          INSERT INTO public.inventory_transactions
            (movement_type, core_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES ('salida_venta', v_prod.core_id, v_prod.quantity, v_cost, ROUND(v_prod.quantity * v_cost, 2),
                  NEW.id, v_note, NEW.created_by);
        END IF;

      ELSIF v_prod.kind = 'material_core' AND v_prod.core_material_id IS NOT NULL THEN
        SELECT current_stock_kg, cost_per_kg INTO v_stock, v_cost FROM public.core_materials
         WHERE id = v_prod.core_material_id FOR UPDATE;
        IF FOUND THEN
          IF v_prod.quantity > v_stock THEN
            RAISE EXCEPTION 'Stock insuficiente de "%" para despachar la orden #%: hay % kg, se requieren %',
              v_prod.description, NEW.order_number, ROUND(v_stock, 2), v_prod.quantity;
          END IF;
          UPDATE public.core_materials SET current_stock_kg = current_stock_kg - v_prod.quantity, updated_at = now()
           WHERE id = v_prod.core_material_id;
          INSERT INTO public.inventory_transactions
            (movement_type, core_material_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES ('salida_venta', v_prod.core_material_id, v_prod.quantity, v_cost, ROUND(v_prod.quantity * v_cost, 2),
                  NEW.id, v_note, NEW.created_by);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
