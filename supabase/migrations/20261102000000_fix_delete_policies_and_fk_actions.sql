-- Inbobinex: habilitar borrado de inventario / categorías / pedidos desde el panel admin.
--
-- Problema detectado (2026-11-02):
--   * raw_materials, core_specifications e inventory_transactions tenían RLS activo sin
--     política DELETE: los borrados devolvían "éxito" pero afectaban 0 filas.
--   * Las FKs de inventory_transactions eran NO ACTION (no SET NULL como documenta CLAUDE.md),
--     por lo que borrar una bobina/core/pedido con movimientos en Kardex fallaba.
--   * products.category_id era RESTRICT.

-- 1. Políticas DELETE (solo admin)
CREATE POLICY "Admin elimina materias primas" ON public.raw_materials
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin'::user_role);

CREATE POLICY "Admin elimina cores" ON public.core_specifications
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin'::user_role);

CREATE POLICY "Admin elimina movimientos kardex" ON public.inventory_transactions
  FOR DELETE TO authenticated USING (public.current_user_role() = 'admin'::user_role);

-- 2. Kardex conserva el historial al borrar material / core / pedido
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT inventory_transactions_raw_material_id_fkey,
  ADD CONSTRAINT inventory_transactions_raw_material_id_fkey
    FOREIGN KEY (raw_material_id) REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  DROP CONSTRAINT inventory_transactions_core_id_fkey,
  ADD CONSTRAINT inventory_transactions_core_id_fkey
    FOREIGN KEY (core_id) REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  DROP CONSTRAINT inventory_transactions_order_id_fkey,
  ADD CONSTRAINT inventory_transactions_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;

-- 3. Productos quedan "Sin categoría" al borrar su categoría
ALTER TABLE public.products
  DROP CONSTRAINT products_category_id_fkey,
  ADD CONSTRAINT products_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;
