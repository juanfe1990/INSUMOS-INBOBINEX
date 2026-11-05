-- =====================================================================
-- 1) Varias medidas de stretch por pedido (ej. 15 cm y 45 cm en la misma factura)
-- 2) Pedido habitual por cliente (plantilla) + frecuencia de recompra
-- 3) Estadísticas de clientes y pedidos por rango de fechas
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Varias medidas por pedido
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.order_items_one_measure_per_order;

-- create_order: p_stretch acepta un objeto (una medida, compatible con versiones
-- anteriores de la app) o un ARREGLO de medidas. Valida stock COMBINADO por
-- bobina (kg de película de todas las líneas + productos de bodega) y por core.
CREATE OR REPLACE FUNCTION public.create_order(p_order jsonb, p_stretch jsonb, p_products jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role public.user_role := public.current_user_role();
  v_order public.orders%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_lines jsonb := CASE jsonb_typeof(p_stretch)
                     WHEN 'object' THEN jsonb_build_array(p_stretch)
                     WHEN 'array' THEN p_stretch
                     ELSE '[]'::jsonb END;
  v_has_stretch boolean;
  v_products jsonb := COALESCE(p_products, '[]'::jsonb);
  v_raw public.raw_materials%ROWTYPE;
  v_core public.core_specifications%ROWTYPE;
  v_line jsonb;
  v_qty integer;
  v_weight numeric;
  v_price numeric;
  v_per_pass integer;
  v_cuts text;
  v_film jsonb := '{}'::jsonb;    -- raw_material_id -> kg de película (todas las líneas)
  v_coreq jsonb := '{}'::jsonb;   -- core_id -> unidades (todas las líneas)
  v_key text;
  v_need numeric;
  v_subtotal numeric := 0;
  v_apply_vat boolean;
  v_vat_rate numeric := 0.19;
  v_tax numeric := 0;
  v_terms integer;
  v_delivery date;
  v_product_id uuid;
  v_kind text;
  v_ref uuid;
  v_lqty numeric;
  v_lprice numeric;
  v_desc text;
  v_unit text;
  v_stock numeric;
  v_used numeric;
  v_status public.order_status;
  v_n integer := 0;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'Solo administradores o vendedores pueden crear pedidos';
  END IF;
  IF jsonb_typeof(v_products) <> 'array' THEN
    RAISE EXCEPTION 'Formato de productos inválido';
  END IF;
  v_has_stretch := jsonb_array_length(v_lines) > 0;
  IF NOT v_has_stretch AND jsonb_array_length(v_products) = 0 THEN
    RAISE EXCEPTION 'El pedido debe incluir stretch a fabricar o al menos un producto';
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = NULLIF(p_order->>'client_id', '')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona un cliente'; END IF;

  v_apply_vat := COALESCE((p_order->>'apply_vat')::boolean, true);
  v_terms := COALESCE(NULLIF(p_order->>'payment_terms_days', '')::integer, v_client.payment_terms_days, 0);
  IF v_terms < 0 THEN RAISE EXCEPTION 'El plazo de pago no puede ser negativo'; END IF;
  v_delivery := COALESCE(NULLIF(p_order->>'delivery_date', '')::date, current_date);

  -- Validar cada medida y acumular consumo por bobina / core
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_n := v_n + 1;
    v_qty := (v_line->>'quantity')::integer;
    v_weight := (v_line->>'weight_grams')::numeric;
    v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Medida %: la cantidad de rollos debe ser mayor a 0', v_n; END IF;
    IF v_weight IS NULL OR v_weight <= 0 THEN RAISE EXCEPTION 'Medida %: indica el peso total por rollo', v_n; END IF;
    IF v_price < 0 THEN RAISE EXCEPTION 'Medida %: el precio no puede ser negativo', v_n; END IF;

    SELECT * INTO v_raw FROM public.raw_materials WHERE id = NULLIF(v_line->>'raw_material_id', '')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida %: bobina madre no encontrada', v_n; END IF;
    SELECT * INTO v_core FROM public.core_specifications WHERE id = NULLIF(v_line->>'core_id', '')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Medida %: core no encontrado', v_n; END IF;

    v_per_pass := public.film_rolls_per_pass(v_raw.width_cm, v_core.length_cm);
    IF v_per_pass IS NULL THEN
      SELECT string_agg(trim_scale(roll_width_cm)::text || ' cm', ', ' ORDER BY roll_width_cm) INTO v_cuts
        FROM public.film_cut_widths WHERE bobina_width_cm = v_raw.width_cm;
      RAISE EXCEPTION 'Medida %: la bobina de % cm no permite rollos de % cm (cortes permitidos: %)', v_n,
        trim_scale(v_raw.width_cm), trim_scale(v_core.length_cm),
        COALESCE(v_cuts, trim_scale(v_raw.width_cm)::text || ' cm');
    END IF;
    IF v_weight <= v_core.weight_grams THEN
      RAISE EXCEPTION 'Medida %: el peso por rollo (% g) debe ser mayor al peso del core (% g)', v_n, v_weight, v_core.weight_grams;
    END IF;

    v_key := v_raw.id::text;
    v_film := jsonb_set(v_film, ARRAY[v_key],
      to_jsonb(COALESCE((v_film->>v_key)::numeric, 0) + (v_weight - v_core.weight_grams) * v_qty / 1000.0));
    v_key := v_core.id::text;
    v_coreq := jsonb_set(v_coreq, ARRAY[v_key], to_jsonb(COALESCE((v_coreq->>v_key)::numeric, 0) + v_qty));
    v_subtotal := v_subtotal + v_qty * v_price;
  END LOOP;

  -- Productos de bodega (stock combinado con lo que consume el stretch)
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_products) LOOP
    v_kind := v_line->>'kind';
    v_ref := NULLIF(v_line->>'ref_id', '')::uuid;
    v_lqty := (v_line->>'quantity')::numeric;
    v_lprice := COALESCE((v_line->>'unit_price')::numeric, 0);
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Hay una línea de producto sin seleccionar'; END IF;
    IF v_lqty IS NULL OR v_lqty <= 0 THEN RAISE EXCEPTION 'Cada producto debe tener cantidad mayor a 0'; END IF;
    IF v_lprice < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;

    SELECT COALESCE(SUM((l->>'quantity')::numeric), 0) INTO v_used
      FROM jsonb_array_elements(v_products) l
     WHERE l->>'kind' = v_kind AND l->>'ref_id' = v_ref::text;

    IF v_kind = 'insumo' THEN
      SELECT current_stock, name, unit INTO v_stock, v_desc, v_unit FROM public.inventory_items WHERE id = v_ref;
    ELSIF v_kind = 'bobina' THEN
      SELECT current_stock_kg, name, 'kg' INTO v_stock, v_desc, v_unit FROM public.raw_materials WHERE id = v_ref;
      v_used := v_used + COALESCE((v_film->>v_ref::text)::numeric, 0);
    ELSIF v_kind = 'core' THEN
      SELECT current_stock_units, name, 'und' INTO v_stock, v_desc, v_unit FROM public.core_specifications WHERE id = v_ref;
      v_used := v_used + COALESCE((v_coreq->>v_ref::text)::numeric, 0);
    ELSIF v_kind = 'material_core' THEN
      SELECT current_stock_kg, name, 'kg' INTO v_stock, v_desc, v_unit FROM public.core_materials WHERE id = v_ref;
    ELSE
      RAISE EXCEPTION 'Tipo de producto no válido: %', v_kind;
    END IF;
    IF NOT FOUND OR v_desc IS NULL THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_used > v_stock THEN
      RAISE EXCEPTION 'Stock insuficiente de "%": hay % % y el pedido requiere %', v_desc, ROUND(v_stock, 2), v_unit, ROUND(v_used, 2);
    END IF;
    v_subtotal := v_subtotal + v_lqty * v_lprice;
  END LOOP;

  -- Stock del stretch por bobina y por core (todas las medidas juntas)
  FOR v_key, v_need IN SELECT key, value::numeric FROM jsonb_each_text(v_film) LOOP
    SELECT * INTO v_raw FROM public.raw_materials WHERE id = v_key::uuid;
    IF v_need > v_raw.current_stock_kg THEN
      RAISE EXCEPTION 'Película insuficiente en "%": las medidas del pedido requieren % kg y hay % kg',
        v_raw.name, ROUND(v_need, 2), ROUND(v_raw.current_stock_kg, 2);
    END IF;
  END LOOP;
  FOR v_key, v_need IN SELECT key, value::numeric FROM jsonb_each_text(v_coreq) LOOP
    SELECT * INTO v_core FROM public.core_specifications WHERE id = v_key::uuid;
    IF v_need > v_core.current_stock_units THEN
      RAISE EXCEPTION 'No hay suficientes cores de % cm (%): disponibles %, solicitados %',
        trim_scale(v_core.length_cm), v_core.name, v_core.current_stock_units, v_need;
    END IF;
  END LOOP;

  v_subtotal := ROUND(v_subtotal);
  v_tax := CASE WHEN v_apply_vat THEN ROUND(v_subtotal * v_vat_rate) ELSE 0 END;

  INSERT INTO public.orders
    (client_id, created_by, priority, status, delivery_date, delivery_address, notes,
     subtotal, apply_vat, vat_rate, tax_amount, total_amount, payment_terms_days, due_date)
  VALUES
    (v_client.id, auth.uid(),
     COALESCE(NULLIF(p_order->>'priority', ''), 'normal')::public.order_priority,
     'en_cola',
     v_delivery,
     COALESCE(NULLIF(p_order->>'delivery_address', ''), v_client.delivery_address),
     NULLIF(trim(p_order->>'notes'), ''),
     v_subtotal, v_apply_vat, v_vat_rate, v_tax, v_subtotal + v_tax, v_terms, v_delivery + v_terms)
  RETURNING * INTO v_order;

  IF v_has_stretch THEN
    SELECT id INTO v_product_id FROM public.products ORDER BY created_at LIMIT 1;
    IF v_product_id IS NULL THEN
      INSERT INTO public.products (name, slug, film_type)
      VALUES ('Bobina Vinipel Estándar', 'bobina-vinipel-estandar-' || extract(epoch FROM now())::bigint, 'manual')
      RETURNING id INTO v_product_id;
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
      SELECT * INTO v_raw FROM public.raw_materials WHERE id = (v_line->>'raw_material_id')::uuid;
      SELECT * INTO v_core FROM public.core_specifications WHERE id = (v_line->>'core_id')::uuid;
      v_qty := (v_line->>'quantity')::integer;
      v_weight := (v_line->>'weight_grams')::numeric;
      v_price := COALESCE((v_line->>'unit_price')::numeric, 0);
      v_per_pass := public.film_rolls_per_pass(v_raw.width_cm, v_core.length_cm);

      INSERT INTO public.order_items
        (order_id, product_id, quantity, raw_material_id, core_id, custom_length_cm, custom_caliber_microns,
         bobina_width_cm, rolls_per_pass, weight_grams, core_weight_grams, unit_price, subtotal, notes)
      VALUES
        (v_order.id, v_product_id, v_qty, v_raw.id, v_core.id, v_core.length_cm, v_raw.caliber_microns,
         v_raw.width_cm, v_per_pass, v_weight, v_core.weight_grams, v_price, v_qty * v_price,
         'Stretch ' || initcap(v_raw.color) || ' · ' || trim_scale(v_core.length_cm) || ' cm · '
           || trim_scale(v_raw.caliber_microns) || ' µ'
           || CASE WHEN v_per_pass > 1
                   THEN ' (bobina ' || trim_scale(v_raw.width_cm) || ' cm, ' || v_per_pass || ' por pasada)'
                   ELSE '' END);
    END LOOP;
  END IF;

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

  v_status := 'en_cola';
  IF NOT v_has_stretch THEN
    UPDATE public.orders SET status = 'listo_despacho', completed_at = now(), updated_at = now()
     WHERE id = v_order.id;
    v_status := 'listo_despacho';
  END IF;

  RETURN jsonb_build_object(
    'id', v_order.id, 'order_number', v_order.order_number, 'status', v_status,
    'subtotal', v_subtotal, 'tax', v_tax, 'total', v_subtotal + v_tax, 'due_date', v_delivery + v_terms,
    'stretch_lines', jsonb_array_length(v_lines)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 2) Pedido habitual por cliente
-- ---------------------------------------------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS reorder_days integer CHECK (reorder_days IS NULL OR reorder_days > 0);
COMMENT ON COLUMN public.clients.reorder_days IS 'Cada cuántos días suele pedir (para alertar recompra); NULL = sin frecuencia';

CREATE TABLE IF NOT EXISTS public.client_order_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  -- stretch = rollo a fabricar (bobina + core + peso); el resto = producto de bodega
  kind text NOT NULL CHECK (kind IN ('stretch', 'insumo', 'bobina', 'core', 'material_core')),
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  core_material_id uuid REFERENCES public.core_materials(id) ON DELETE CASCADE,
  weight_grams numeric CHECK (weight_grams IS NULL OR weight_grams > 0),
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_order_templates_refs CHECK (
    (kind = 'stretch' AND raw_material_id IS NOT NULL AND core_id IS NOT NULL AND weight_grams IS NOT NULL)
    OR (kind = 'insumo' AND inventory_item_id IS NOT NULL)
    OR (kind = 'bobina' AND raw_material_id IS NOT NULL)
    OR (kind = 'core' AND core_id IS NOT NULL)
    OR (kind = 'material_core' AND core_material_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS client_order_templates_client_idx ON public.client_order_templates (client_id, position);

ALTER TABLE public.client_order_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_order_templates_rw ON public.client_order_templates;
CREATE POLICY client_order_templates_rw ON public.client_order_templates
  FOR ALL TO authenticated
  USING (public.current_user_role() IN ('admin', 'vendedor'))
  WITH CHECK (public.current_user_role() IN ('admin', 'vendedor'));

-- Reemplaza (atómico) el pedido habitual de varios clientes.
-- p_data = [{ "client_id": uuid, "reorder_days": int|null, "lines": [ {kind, raw_material_id, core_id,
--            inventory_item_id, core_material_id, weight_grams, quantity, unit_price, notes}, ... ] }, ...]
CREATE OR REPLACE FUNCTION public.replace_client_templates(p_data jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_c jsonb;
  v_l jsonb;
  v_client uuid;
  v_pos integer;
  v_count integer := 0;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'Solo administradores o vendedores pueden editar pedidos habituales';
  END IF;
  IF jsonb_typeof(p_data) <> 'array' THEN RAISE EXCEPTION 'Formato inválido'; END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_data) LOOP
    v_client := (v_c->>'client_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client) THEN
      RAISE EXCEPTION 'Cliente no encontrado: %', v_client;
    END IF;
    IF v_c ? 'reorder_days' THEN
      UPDATE public.clients SET reorder_days = NULLIF(v_c->>'reorder_days', '')::integer, updated_at = now()
       WHERE id = v_client;
    END IF;
    DELETE FROM public.client_order_templates WHERE client_id = v_client;
    v_pos := 0;
    FOR v_l IN SELECT * FROM jsonb_array_elements(COALESCE(v_c->'lines', '[]'::jsonb)) LOOP
      v_pos := v_pos + 1;
      INSERT INTO public.client_order_templates
        (client_id, position, kind, raw_material_id, core_id, inventory_item_id, core_material_id,
         weight_grams, quantity, unit_price, notes)
      VALUES
        (v_client, v_pos, v_l->>'kind',
         NULLIF(v_l->>'raw_material_id', '')::uuid, NULLIF(v_l->>'core_id', '')::uuid,
         NULLIF(v_l->>'inventory_item_id', '')::uuid, NULLIF(v_l->>'core_material_id', '')::uuid,
         NULLIF(v_l->>'weight_grams', '')::numeric, (v_l->>'quantity')::numeric,
         COALESCE(NULLIF(v_l->>'unit_price', '')::numeric, 0), NULLIF(trim(v_l->>'notes'), ''));
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.replace_client_templates(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_client_templates(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 3) Estadísticas de clientes y pedidos (admin y vendedor)
--    Base: pedidos no cancelados por fecha de creación dentro del rango.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clients_dashboard(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer := (p_to - p_from) + 1;
  v_prev_from date := p_from - ((p_to - p_from) + 1);
  v_prev_to date := p_from - 1;
  v_summary jsonb; v_prev jsonb; v_series jsonb; v_top jsonb; v_measures jsonb; v_films jsonb;
  v_products jsonb; v_status jsonb; v_reorder jsonb; v_inactive jsonb;
  v_ids uuid[];
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'vendedor') THEN
    RAISE EXCEPTION 'Sin permiso para ver estadísticas';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Rango de fechas inválido'; END IF;

  SELECT COALESCE(array_agg(o.id), '{}') INTO v_ids FROM public.orders o
   WHERE o.status <> 'cancelado' AND o.created_at::date BETWEEN p_from AND p_to;

  SELECT jsonb_build_object(
    'revenue', COALESCE(SUM(subtotal), 0),
    'total_with_tax', COALESCE(SUM(total_amount), 0),
    'orders', COUNT(*),
    'active_clients', COUNT(DISTINCT client_id),
    'avg_ticket', CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(subtotal) / COUNT(*)) ELSE 0 END,
    'rolls', COALESCE((SELECT SUM(i.quantity) FROM public.order_items i WHERE i.order_id = ANY(v_ids)), 0),
    'film_kg', COALESCE((SELECT SUM(GREATEST(i.weight_grams - i.core_weight_grams, 0) * i.quantity) / 1000.0
                           FROM public.order_items i WHERE i.order_id = ANY(v_ids)), 0),
    'stretch_revenue', COALESCE((SELECT SUM(i.subtotal) FROM public.order_items i WHERE i.order_id = ANY(v_ids)), 0),
    'products_revenue', COALESCE((SELECT SUM(p.subtotal) FROM public.order_products p WHERE p.order_id = ANY(v_ids)), 0),
    'new_clients', (SELECT COUNT(*) FROM public.clients c WHERE c.created_at::date BETWEEN p_from AND p_to),
    'collected', COALESCE((SELECT SUM(cp.amount + cp.withholding_amount) FROM public.customer_payments cp
                            WHERE cp.payment_date BETWEEN p_from AND p_to), 0),
    'receivable_open', COALESCE((SELECT SUM(total_amount - paid_amount) FROM public.orders
                                  WHERE status <> 'cancelado' AND total_amount - paid_amount > 0), 0),
    'days', v_days
  ) INTO v_summary FROM public.orders WHERE id = ANY(v_ids);

  SELECT jsonb_build_object('from', v_prev_from, 'to', v_prev_to,
    'revenue', COALESCE(SUM(subtotal), 0), 'orders', COUNT(*), 'active_clients', COUNT(DISTINCT client_id))
    INTO v_prev FROM public.orders
   WHERE status <> 'cancelado' AND created_at::date BETWEEN v_prev_from AND v_prev_to;

  -- Serie diaria (el frontend agrupa por semana/mes en rangos largos)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d::date, 'revenue', COALESCE(s.rev, 0), 'orders', COALESCE(s.n, 0))
                            ORDER BY d), '[]'::jsonb)
    INTO v_series
    FROM generate_series(p_from, p_to, interval '1 day') d
    LEFT JOIN (SELECT created_at::date AS day, SUM(subtotal) AS rev, COUNT(*) AS n FROM public.orders WHERE id = ANY(v_ids) GROUP BY 1) s
      ON s.day = d::date;

  -- Clientes (todos los que compraron en el rango)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.revenue DESC), '[]'::jsonb) INTO v_top FROM (
    SELECT c.id, c.business_name AS name, c.reorder_days,
           COUNT(o.id) AS orders, SUM(o.subtotal) AS revenue,
           COALESCE(SUM((SELECT SUM(i.quantity) FROM public.order_items i WHERE i.order_id = o.id)), 0) AS rolls,
           COALESCE(SUM((SELECT SUM(GREATEST(i.weight_grams - i.core_weight_grams, 0) * i.quantity) / 1000.0
                            FROM public.order_items i WHERE i.order_id = o.id)), 0) AS film_kg,
           MAX(o.created_at)::date AS last_order,
           (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM public.orders ob
             WHERE ob.client_id = c.id AND ob.status <> 'cancelado') AS balance,
           (SELECT COALESCE(SUM(total_amount - paid_amount), 0) FROM public.orders ob
             WHERE ob.client_id = c.id AND ob.status <> 'cancelado' AND ob.due_date < current_date) AS overdue
      FROM public.orders o JOIN public.clients c ON c.id = o.client_id
     WHERE o.id = ANY(v_ids)
     GROUP BY c.id, c.business_name, c.reorder_days
  ) x;

  -- Rollos por medida
  SELECT COALESCE(jsonb_agg(x ORDER BY x.width), '[]'::jsonb) INTO v_measures FROM (
    SELECT i.custom_length_cm AS width, SUM(i.quantity) AS rolls,
           SUM(GREATEST(i.weight_grams - i.core_weight_grams, 0) * i.quantity) / 1000.0 AS film_kg,
           SUM(i.subtotal) AS revenue, COUNT(DISTINCT o.client_id) AS clients
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id AND o.id = ANY(v_ids)
     GROUP BY i.custom_length_cm
  ) x;

  -- Película por tipo (color + calibre)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.film_kg DESC), '[]'::jsonb) INTO v_films FROM (
    SELECT initcap(COALESCE(r.color, 'otro')) || ' · ' || trim_scale(i.custom_caliber_microns) || ' µ' AS film,
           SUM(i.quantity) AS rolls,
           SUM(GREATEST(i.weight_grams - i.core_weight_grams, 0) * i.quantity) / 1000.0 AS film_kg
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id AND o.id = ANY(v_ids)
      LEFT JOIN public.raw_materials r ON r.id = i.raw_material_id
     GROUP BY 1
  ) x;

  -- Productos de bodega más vendidos
  SELECT COALESCE(jsonb_agg(x ORDER BY x.revenue DESC), '[]'::jsonb) INTO v_products FROM (
    SELECT p.description AS name, p.unit, SUM(p.quantity) AS quantity, SUM(p.subtotal) AS revenue
      FROM public.order_products p JOIN public.orders o ON o.id = p.order_id AND o.id = ANY(v_ids)
     GROUP BY p.description, p.unit ORDER BY SUM(p.subtotal) DESC LIMIT 10
  ) x;

  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_status
    FROM (SELECT status::text, COUNT(*) AS n FROM public.orders WHERE id = ANY(v_ids) GROUP BY status) s;

  -- Recompra: clientes con frecuencia definida (independiente del rango)
  SELECT COALESCE(jsonb_agg(x ORDER BY x.days_left), '[]'::jsonb) INTO v_reorder FROM (
    SELECT c.id, c.business_name AS name, c.reorder_days, l.last_order,
           (l.last_order + c.reorder_days) AS next_expected,
           (l.last_order + c.reorder_days) - current_date AS days_left,
           (SELECT COUNT(*) FROM public.client_order_templates t WHERE t.client_id = c.id) AS template_lines
      FROM public.clients c
      JOIN LATERAL (SELECT MAX(o.created_at)::date AS last_order FROM public.orders o
                     WHERE o.client_id = c.id AND o.status <> 'cancelado') l ON true
     WHERE c.reorder_days IS NOT NULL AND l.last_order IS NOT NULL
       AND (l.last_order + c.reorder_days) <= current_date + 7
  ) x;

  -- Clientes que compraron antes del rango y no en el rango
  SELECT COALESCE(jsonb_agg(x ORDER BY x.last_order DESC), '[]'::jsonb) INTO v_inactive FROM (
    SELECT c.id, c.business_name AS name, MAX(o.created_at)::date AS last_order,
           SUM(o.subtotal) FILTER (WHERE o.created_at >= current_date - 365) AS revenue_12m
      FROM public.clients c JOIN public.orders o ON o.client_id = c.id AND o.status <> 'cancelado'
     WHERE NOT EXISTS (SELECT 1 FROM public.orders r WHERE r.id = ANY(v_ids) AND r.client_id = c.id)
     GROUP BY c.id, c.business_name
     HAVING MAX(o.created_at)::date < p_from
     ORDER BY MAX(o.created_at) DESC LIMIT 15
  ) x;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to, 'summary', v_summary, 'previous', v_prev, 'series', v_series,
    'clients', v_top, 'measures', v_measures, 'films', v_films, 'products', v_products,
    'status', v_status, 'reorder', v_reorder, 'inactive', v_inactive
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.clients_dashboard(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clients_dashboard(date, date) TO authenticated;
