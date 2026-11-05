-- Nueva categoría de proveedor: Cintas (se conserva "insumos" = Insumos y empaque)
ALTER TYPE public.supplier_category ADD VALUE IF NOT EXISTS 'cintas' BEFORE 'insumos';
