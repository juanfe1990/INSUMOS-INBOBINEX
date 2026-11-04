-- ============================================================
-- CUENTAS POR COBRAR + IVA OPCIONAL POR PEDIDO
--   clients.payment_terms_days / credit_limit → plazo pactado y cupo
--   orders: subtotal + IVA (apply_vat) = total_amount; due_date, paid_amount, payment_status
--   customer_payments → abonos/pagos del cliente (con retención opcional)
-- Vencimiento: al crear = fecha de entrega + plazo; al pasar a 'enviado' se recalcula
-- desde la fecha real de despacho.
-- ============================================================

CREATE TYPE public.receivable_status AS ENUM ('pendiente', 'parcial', 'pagado');

-- ---------- Clientes: plazo y cupo ----------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  ADD COLUMN IF NOT EXISTS credit_limit numeric CHECK (credit_limit >= 0);

-- ---------- Pedidos: IVA y cartera ----------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS subtotal numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apply_vat boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 0.19 CHECK (vat_rate >= 0),
  ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  ADD COLUMN IF NOT EXISTS payment_status public.receivable_status NOT NULL DEFAULT 'pendiente';

-- Pedidos existentes: se conservan sus totales (sin IVA)
UPDATE public.orders
   SET subtotal = total_amount,
       apply_vat = false,
       tax_amount = 0,
       due_date = COALESCE(shipped_at::date, delivery_date)
 WHERE due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_receivable ON public.orders(payment_status, due_date)
  WHERE payment_status <> 'pagado' AND status <> 'cancelado';

-- ---------- Pagos de clientes ----------
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: un pedido con pagos no se puede borrar (se perdería el historial de cartera)
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL CHECK (amount >= 0),
  withholding_amount numeric NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  method public.payment_method NOT NULL DEFAULT 'transferencia',
  reference text,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (amount + withholding_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_order ON public.customer_payments(order_id);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin y vendedor leen pagos de clientes" ON public.customer_payments
  FOR SELECT TO authenticated USING (public.current_user_role() IN ('admin', 'vendedor'));
CREATE POLICY "Admin y vendedor registran pagos de clientes" ON public.customer_payments
  FOR INSERT TO authenticated WITH CHECK (public.current_user_role() IN ('admin', 'vendedor'));
CREATE POLICY "Admin edita pagos de clientes" ON public.customer_payments
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin elimina pagos de clientes" ON public.customer_payments
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin');

-- ---------- Sincroniza saldo y estado de cartera del pedido ----------
CREATE OR REPLACE FUNCTION public.fn_sync_order_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid := COALESCE(NEW.order_id, OLD.order_id);
  v_order public.orders%ROWTYPE;
  v_paid numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF TG_OP <> 'DELETE' AND v_order.status = 'cancelado' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en un pedido cancelado';
  END IF;

  SELECT COALESCE(SUM(amount + withholding_amount), 0) INTO v_paid
    FROM public.customer_payments WHERE order_id = v_order_id;

  IF v_paid > v_order.total_amount THEN
    RAISE EXCEPTION 'El pago excede el saldo del pedido #% (total %, abonado %)',
      v_order.order_number, ROUND(v_order.total_amount), ROUND(v_paid);
  END IF;

  UPDATE public.orders
     SET paid_amount = v_paid,
         payment_status = CASE
                            WHEN v_paid >= total_amount AND total_amount > 0 THEN 'pagado'::public.receivable_status
                            WHEN v_paid > 0 THEN 'parcial'::public.receivable_status
                            ELSE 'pendiente'::public.receivable_status
                          END,
         updated_at = now()
   WHERE id = v_order_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER tr_sync_order_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_order_payments();

-- ---------- Vencimiento real al despachar + estado si cambia el total ----------
CREATE OR REPLACE FUNCTION public.fn_orders_receivable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'enviado' AND OLD.status IS DISTINCT FROM 'enviado' THEN
    NEW.due_date := COALESCE(NEW.shipped_at, now())::date + NEW.payment_terms_days;
  ELSIF NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days THEN
    NEW.due_date := COALESCE(NEW.shipped_at::date, NEW.delivery_date) + NEW.payment_terms_days;
  END IF;

  IF NEW.total_amount IS DISTINCT FROM OLD.total_amount THEN
    NEW.payment_status := CASE
                            WHEN NEW.paid_amount >= NEW.total_amount AND NEW.total_amount > 0 THEN 'pagado'::public.receivable_status
                            WHEN NEW.paid_amount > 0 THEN 'parcial'::public.receivable_status
                            ELSE 'pendiente'::public.receivable_status
                          END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_orders_receivable_fields
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_orders_receivable_fields();

-- ============================================================
-- create_order: ahora con IVA opcional y plazo de pago
--   p_order: { client_id, priority, delivery_date, delivery_address, notes,
--              apply_vat (bool, default true), payment_terms_days (default: plazo del cliente) }
-- Los precios se digitan ANTES de IVA.
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
  v_client public.clients%ROWTYPE;
  v_has_stretch boolean := p_stretch IS NOT NULL AND jsonb_typeof(p_stretch) = 'object';
  v_products jsonb := COALESCE(p_products, '[]'::jsonb);
  v_raw public.raw_materials%ROWTYPE;
  v_core public.core_specifications%ROWTYPE;
  v_qty integer;
  v_weight numeric;
  v_price numeric;
  v_film_kg numeric := 0;
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
    IF v_core.length_cm <> v_raw.width_cm THEN
      RAISE EXCEPTION 'El core (% cm) no coincide con el ancho de la bobina (% cm)', v_core.length_cm, v_raw.width_cm;
    END IF;
    IF v_weight <= v_core.weight_grams THEN
      RAISE EXCEPTION 'El peso por rollo (% g) debe ser mayor al peso del core (% g)', v_weight, v_core.weight_grams;
    END IF;
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
      RAISE EXCEPTION 'No hay suficientes cores de % cm: disponibles %, solicitados %', v_core.length_cm, v_core.current_stock_units, v_qty;
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
       weight_grams, core_weight_grams, unit_price, subtotal, notes)
    VALUES
      (v_order.id, v_product_id, v_qty, v_raw.id, v_core.id, v_raw.width_cm, v_raw.caliber_microns,
       v_weight, v_core.weight_grams, v_price, v_qty * v_price,
       'Stretch ' || initcap(v_raw.color) || ' · ' || v_raw.width_cm || ' cm · ' || v_raw.caliber_microns || ' µ');
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
$$;

REVOKE EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, jsonb, jsonb) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                     AND schemaname = 'public' AND tablename = 'customer_payments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_payments;
  END IF;
END $$;

-- La función del trigger no debe exponerse como RPC
REVOKE EXECUTE ON FUNCTION public.fn_sync_order_payments() FROM PUBLIC, anon, authenticated;
