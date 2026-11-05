-- Una medida de core es única POR MATERIAL: puede haber 45 cm de cartón y 45 cm de color,
-- pero nunca dos de 45 cm del mismo material.
ALTER TABLE public.core_specifications DROP CONSTRAINT IF EXISTS core_specifications_length_cm_key;
ALTER TABLE public.core_specifications
  ADD CONSTRAINT core_specifications_material_length_key
  UNIQUE NULLS NOT DISTINCT (core_material_id, length_cm);
