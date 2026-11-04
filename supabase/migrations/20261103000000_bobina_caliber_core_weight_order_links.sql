-- Inbobinex: calibre en la bobina madre, peso promedio del core y pedidos ligados
-- a la bobina / core exactos. El peso del pedido = core + pelicula; el trigger de
-- despacho descuenta solo los kg de pelicula.

-- 1. Calibre pertenece a la bobina madre
ALTER TABLE public.raw_materials ADD COLUMN caliber_microns numeric;
-- Backfill: la unica bobina existente al aplicar indicaba 17 micras en su nombre
UPDATE public.raw_materials SET caliber_microns = 17 WHERE caliber_microns IS NULL;
ALTER TABLE public.raw_materials
  ALTER COLUMN caliber_microns SET NOT NULL,
  ADD CONSTRAINT raw_materials_caliber_positive CHECK (caliber_microns > 0);

-- 2. Peso promedio del core (gramos)
ALTER TABLE public.core_specifications
  ADD COLUMN weight_grams numeric NOT NULL DEFAULT 0 CHECK (weight_grams >= 0);

-- 3. Item del pedido -> bobina y core exactos + snapshot del peso del core
ALTER TABLE public.order_items
  ADD COLUMN raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  ADD COLUMN core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  ADD COLUMN core_weight_grams numeric NOT NULL DEFAULT 0 CHECK (core_weight_grams >= 0);

ALTER TABLE public.order_items
  ADD COLUMN film_weight_grams numeric GENERATED ALWAYS AS (weight_grams - core_weight_grams) STORED,
  ADD CONSTRAINT order_items_weight_exceeds_core CHECK (weight_grams > core_weight_grams);

-- Backfill de pedidos existentes por ancho (y color segun la nota del tipo de stretch)
UPDATE public.order_items oi
   SET raw_material_id = (
         SELECT rm.id FROM public.raw_materials rm
          WHERE rm.width_cm = oi.custom_length_cm
            AND rm.color = CASE
                  WHEN oi.notes ILIKE '%negro%' THEN 'negro'
                  WHEN oi.notes ILIKE '%azul%' THEN 'azul'
                  ELSE 'transparente' END
          ORDER BY rm.created_at LIMIT 1),
       core_id = (
         SELECT c.id FROM public.core_specifications c
          WHERE c.length_cm = oi.custom_length_cm
          ORDER BY c.created_at LIMIT 1);

CREATE INDEX IF NOT EXISTS order_items_raw_material_id_idx ON public.order_items(raw_material_id);
CREATE INDEX IF NOT EXISTS order_items_core_id_idx ON public.order_items(core_id);

-- 4. Descuento al pasar a listo_despacho: bobina/core exactos, solo kg de pelicula
CREATE OR REPLACE FUNCTION public.fn_descontar_inventario_despacho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_film_kg numeric;
  v_cost numeric;
BEGIN
  IF NEW.status = 'listo_despacho' AND OLD.status IS DISTINCT FROM 'listo_despacho' THEN
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = NEW.id LOOP
      IF v_item.raw_material_id IS NOT NULL THEN
        v_film_kg := (GREATEST(v_item.weight_grams - v_item.core_weight_grams, 0) * v_item.quantity) / 1000.0;
        UPDATE public.raw_materials
           SET current_stock_kg = GREATEST(0, current_stock_kg - v_film_kg), updated_at = now()
         WHERE id = v_item.raw_material_id
        RETURNING cost_per_kg INTO v_cost;
        IF FOUND THEN
          INSERT INTO public.inventory_transactions
            (movement_type, raw_material_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES ('consumo_pedido', v_item.raw_material_id, v_film_kg, v_cost, v_film_kg * v_cost, NEW.id,
                  'Película consumida orden #' || NEW.order_number || ' (' || v_item.quantity || ' rollos x '
                    || (v_item.weight_grams - v_item.core_weight_grams) || ' g)', NEW.created_by);
        END IF;
      END IF;

      IF v_item.core_id IS NOT NULL THEN
        UPDATE public.core_specifications
           SET current_stock_units = GREATEST(0, current_stock_units - v_item.quantity), updated_at = now()
         WHERE id = v_item.core_id
        RETURNING standard_cost INTO v_cost;
        IF FOUND THEN
          INSERT INTO public.inventory_transactions
            (movement_type, core_id, quantity, unit_cost, total_cost, order_id, notes, created_by)
          VALUES ('consumo_pedido', v_item.core_id, v_item.quantity, v_cost, v_item.quantity * v_cost, NEW.id,
                  'Cores consumidos orden #' || NEW.order_number, NEW.created_by);
        END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_descontar_inventario_despacho() FROM anon, authenticated, public;
