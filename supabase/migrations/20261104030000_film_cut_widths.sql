-- =====================================================================
-- Cortes de bobina madre: una bobina de un ancho permite fabricar rollos
-- de varias medidas (cortando en varias pistas a la vez).
--   30 cm → 10, 15, 30        45 cm → 15, 45
--   50 cm → 8.3, 10, 12.5, 25, 50        60 cm → 15, 20, 30
-- El consumo de película NO cambia: kg = (peso rollo − peso core) × rollos / 1000,
-- descontado de la bobina exacta del pedido. Lo que cambia es la compatibilidad
-- core ↔ bobina: el core debe medir uno de los cortes permitidos para el ancho.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.film_cut_widths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bobina_width_cm numeric NOT NULL CHECK (bobina_width_cm > 0),
  roll_width_cm numeric NOT NULL CHECK (roll_width_cm > 0),
  -- Rollos que salen por cada pasada de la bobina (60/15 = 4; 50/8.3 = 6)
  rolls_per_pass integer GENERATED ALWAYS AS (floor(bobina_width_cm / roll_width_cm + 0.05)::integer) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT film_cut_widths_unique UNIQUE (bobina_width_cm, roll_width_cm),
  CONSTRAINT film_cut_widths_roll_le_bobina CHECK (roll_width_cm <= bobina_width_cm)
);

ALTER TABLE public.film_cut_widths ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS film_cut_widths_select ON public.film_cut_widths;
CREATE POLICY film_cut_widths_select ON public.film_cut_widths
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS film_cut_widths_admin ON public.film_cut_widths;
CREATE POLICY film_cut_widths_admin ON public.film_cut_widths
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

INSERT INTO public.film_cut_widths (bobina_width_cm, roll_width_cm) VALUES
  (30, 10), (30, 15), (30, 30),
  (45, 15), (45, 45),
  (50, 8.3), (50, 10), (50, 12.5), (50, 25), (50, 50),
  (60, 15), (60, 20), (60, 30)
ON CONFLICT (bobina_width_cm, roll_width_cm) DO NOTHING;

-- Rollos por pasada si el corte está permitido; NULL si no.
-- Si un ancho de bobina no tiene cortes configurados, solo se permite el mismo ancho (comportamiento anterior).
CREATE OR REPLACE FUNCTION public.film_rolls_per_pass(p_bobina_width numeric, p_roll_width numeric)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.film_cut_widths f WHERE f.bobina_width_cm = p_bobina_width) THEN
      (SELECT f.rolls_per_pass FROM public.film_cut_widths f
        WHERE f.bobina_width_cm = p_bobina_width AND abs(f.roll_width_cm - p_roll_width) < 0.05
        LIMIT 1)
    WHEN abs(p_bobina_width - p_roll_width) < 0.05 THEN 1
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.film_rolls_per_pass(numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.film_rolls_per_pass(numeric, numeric) TO authenticated;

-- Snapshot en el pedido: de qué ancho de bobina sale y cuántos rollos por pasada
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS bobina_width_cm numeric,
  ADD COLUMN IF NOT EXISTS rolls_per_pass integer;

UPDATE public.order_items
   SET bobina_width_cm = COALESCE(bobina_width_cm, custom_length_cm),
       rolls_per_pass = COALESCE(rolls_per_pass, 1)
 WHERE bobina_width_cm IS NULL OR rolls_per_pass IS NULL;

COMMENT ON COLUMN public.order_items.custom_length_cm IS 'Medida del rollo fabricado (= core.length_cm). Puede ser un corte de la bobina.';
COMMENT ON COLUMN public.order_items.bobina_width_cm IS 'Ancho de la bobina madre de la que se corta';
COMMENT ON COLUMN public.order_items.rolls_per_pass IS 'Rollos que salen por pasada (bobina_width / medida)';

-- ---------------------------------------------------------------------
-- create_order: el core puede ser cualquier corte permitido de la bobina
-- ---------------------------------------------------------------------
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
  v_has_stretch boolean := p_stretch IS NOT NULL AND jsonb_typeof(p_stretch) = 'object';
  v_products jsonb := COALESCE(p_products, '[]'::jsonb);
  v_raw public.raw_materials%ROWTYPE;
  v_core public.core_specifications%ROWTYPE;
  v_qty integer;
  v_weight numeric;
  v_price numeric;
  v_film_kg numeric := 0;
  v_per_pass integer;
  v_cuts text;
  v_subtotal numeric := 0;
  v_apply_vat boolean;
  v_vat_rate numeric := 0.19;
  v_tax numeric := 0;
  v_terms integer;
  v_delivery date;
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

  SELECT * INTO v_client FROM public.clients WHERE id = NULLIF(p_order->>'client_id', '')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona un cliente'; END IF;

  v_apply_vat := COALESCE((p_order->>'apply_vat')::boolean, true);
  v_terms := COALESCE(NULLIF(p_order->>'payment_terms_days', '')::integer, v_client.payment_terms_days, 0);
  IF v_terms < 0 THEN RAISE EXCEPTION 'El plazo de pago no puede ser negativo'; END IF;
  v_delivery := COALESCE(NULLIF(p_order->>'delivery_date', '')::date, current_date);

  IF v_has_stretch THEN
    v_qty := (p_stretch->>'quantity')::integer;
    v_weight := (p_stretch->>'weight_grams')::numeric;
    v_price := COALESCE((p_stretch->>'unit_price')::numeric, 0);
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'La cantidad de rollos debe ser mayor a 0'; END IF;
    IF v_weight IS NULL OR v_weight <= 0 THEN RAISE EXCEPTION 'Indica el peso total por rollo'; END IF;
    IF v_price < 0 THEN RAISE EXCEPTION 'El precio no puede ser negativo'; END IF;

    SELECT * INTO v_raw FROM public.raw_materials WHERE id = (p_stretch->>'raw_material_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Bobina madre no encontrada'; END IF;
    SELECT * INTO v_core FROM public.core_specifications WHERE id = (p_stretch->>'core_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Core no encontrado'; END IF;

    v_per_pass := public.film_rolls_per_pass(v_raw.width_cm, v_core.length_cm);
    IF v_per_pass IS NULL THEN
      SELECT string_agg(trim_scale(roll_width_cm)::text || ' cm', ', ' ORDER BY roll_width_cm) INTO v_cuts
        FROM public.film_cut_widths WHERE bobina_width_cm = v_raw.width_cm;
      RAISE EXCEPTION 'La bobina de % cm no permite rollos de % cm (cortes permitidos: %)',
        trim_scale(v_raw.width_cm), trim_scale(v_core.length_cm),
        COALESCE(v_cuts, trim_scale(v_raw.width_cm)::text || ' cm');
    END IF;
    IF v_weight <= v_core.weight_grams THEN
      RAISE EXCEPTION 'El peso por rollo (% g) debe ser mayor al peso del core (% g)', v_weight, v_core.weight_grams;
    END IF;
    -- Película = peso de TODOS los rollos (sin core), sin importar en cuántas pistas se corte la bobina
    v_film_kg := (v_weight - v_core.weight_grams) * v_qty / 1000.0;
    v_subtotal := v_subtotal + v_qty * v_price;
  END IF;

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

    v_subtotal := v_subtotal + v_lqty * v_lprice;
  END LOOP;

  IF v_has_stretch THEN
    IF v_qty > v_core.current_stock_units THEN
      RAISE EXCEPTION 'No hay suficientes cores de % cm: disponibles %, solicitados %', trim_scale(v_core.length_cm), v_core.current_stock_units, v_qty;
    END IF;
    IF v_film_kg > v_raw.current_stock_kg THEN
      RAISE EXCEPTION 'Película insuficiente en "%": se requieren % kg y hay % kg', v_raw.name, ROUND(v_film_kg, 2), ROUND(v_raw.current_stock_kg, 2);
    END IF;
  END IF;

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
    'subtotal', v_subtotal, 'tax', v_tax, 'total', v_subtotal + v_tax, 'due_date', v_delivery + v_terms
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb) TO authenticated;
