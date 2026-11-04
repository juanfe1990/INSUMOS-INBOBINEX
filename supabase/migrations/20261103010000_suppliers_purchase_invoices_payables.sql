-- ============================================================
-- PROVEEDORES, FACTURAS DE COMPRA Y CUENTAS POR PAGAR
-- (aplicada en Supabase el 2026-11-03)
-- ============================================================

CREATE TYPE public.supplier_category AS ENUM
  ('materia_prima', 'cores_tubos', 'insumos', 'servicios', 'transporte', 'otro');
CREATE TYPE public.purchase_invoice_status AS ENUM ('pendiente', 'parcial', 'pagada', 'anulada');
CREATE TYPE public.payment_method AS ENUM ('transferencia', 'efectivo', 'cheque', 'tarjeta', 'otro');
CREATE TYPE public.purchase_item_type AS ENUM ('bobina', 'core', 'otro');

-- Reverso de inventario al anular una factura de compra
ALTER TYPE public.inventory_movement_type ADD VALUE IF NOT EXISTS 'anulacion_compra';

-- ---------- Proveedores ----------
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  nit text UNIQUE,
  verification_digit smallint CHECK (verification_digit BETWEEN 0 AND 9),
  category public.supplier_category NOT NULL DEFAULT 'materia_prima',
  contact_name text,
  phone text,
  email text,
  address text,
  city text NOT NULL DEFAULT 'Medellín',
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  bank_name text,
  bank_account_type text CHECK (bank_account_type IN ('ahorros', 'corriente')),
  bank_account_number text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Facturas de compra ----------
CREATE TABLE public.purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  cufe text,
  issue_date date NOT NULL DEFAULT current_date,
  due_date date NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_amount numeric NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  withholding_amount numeric NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  total numeric GENERATED ALWAYS AS (subtotal + tax_amount - withholding_amount) STORED,
  paid_amount numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  status public.purchase_invoice_status NOT NULL DEFAULT 'pendiente',
  annulled_reason text,
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_invoices_supplier_number_key UNIQUE (supplier_id, invoice_number),
  CONSTRAINT purchase_invoices_due_after_issue CHECK (due_date >= issue_date)
);
CREATE INDEX purchase_invoices_supplier_idx ON public.purchase_invoices(supplier_id);
CREATE INDEX purchase_invoices_status_due_idx ON public.purchase_invoices(status, due_date);

CREATE TABLE public.purchase_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  item_type public.purchase_item_type NOT NULL,
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'und',
  unit_cost numeric NOT NULL CHECK (unit_cost >= 0),
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_invoice_items_invoice_idx ON public.purchase_invoice_items(invoice_id);
CREATE INDEX purchase_invoice_items_raw_idx ON public.purchase_invoice_items(raw_material_id);
CREATE INDEX purchase_invoice_items_core_idx ON public.purchase_invoice_items(core_id);

-- ---------- Pagos / abonos ----------
CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.purchase_invoices(id) ON DELETE CASCADE,
  payment_date date NOT NULL DEFAULT current_date,
  amount numeric NOT NULL CHECK (amount > 0),
  method public.payment_method NOT NULL DEFAULT 'transferencia',
  reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supplier_payments_invoice_idx ON public.supplier_payments(invoice_id);

-- Kardex: trazabilidad hasta la factura
ALTER TABLE public.inventory_transactions
  ADD COLUMN purchase_invoice_id uuid REFERENCES public.purchase_invoices(id) ON DELETE SET NULL;
CREATE INDEX inventory_transactions_purchase_invoice_idx ON public.inventory_transactions(purchase_invoice_id);

-- ---------- Pagos: recalcular saldo y estado ----------
CREATE OR REPLACE FUNCTION public.fn_sync_invoice_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id uuid := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_inv public.purchase_invoices%ROWTYPE;
  v_paid numeric;
BEGIN
  SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = v_invoice_id FOR UPDATE;

  IF TG_OP = 'INSERT' AND v_inv.status = 'anulada' THEN
    RAISE EXCEPTION 'No se pueden registrar pagos en una factura anulada';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.supplier_payments WHERE invoice_id = v_invoice_id;

  IF v_paid > v_inv.total THEN
    RAISE EXCEPTION 'El pago excede el saldo de la factura (total %, pagado %)', v_inv.total, v_paid;
  END IF;

  UPDATE public.purchase_invoices
     SET paid_amount = v_paid,
         status = CASE
                    WHEN status = 'anulada' THEN status
                    WHEN v_paid >= total THEN 'pagada'::public.purchase_invoice_status
                    WHEN v_paid > 0 THEN 'parcial'::public.purchase_invoice_status
                    ELSE 'pendiente'::public.purchase_invoice_status
                  END,
         updated_at = now()
   WHERE id = v_invoice_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER tr_sync_invoice_payments
AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_invoice_payments();

-- ---------- Registrar factura (atómico): factura + items + stock + kardex + costo promedio ----------
CREATE OR REPLACE FUNCTION public.register_purchase_invoice(p_invoice jsonb, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
  v_core public.core_specifications%ROWTYPE;
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
      SELECT * INTO v_core FROM public.core_specifications WHERE id = (v_item->>'core_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Core no encontrado en una línea de la factura'; END IF;

      INSERT INTO public.purchase_invoice_items
        (invoice_id, item_type, core_id, description, quantity, unit, unit_cost)
      VALUES (v_invoice_id, v_type, v_core.id, COALESCE(NULLIF(trim(v_item->>'description'), ''), v_core.name), v_qty, 'und', v_cost);

      UPDATE public.core_specifications
         SET current_stock_units = current_stock_units + v_qty::integer,
             updated_at = now()
       WHERE id = v_core.id;

      INSERT INTO public.inventory_transactions
        (movement_type, core_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('entrada_compra', v_core.id, v_qty, v_cost, v_qty * v_cost, v_invoice_id,
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
$$;

-- ---------- Anular factura: revierte stock y deja trazabilidad ----------
CREATE OR REPLACE FUNCTION public.annul_purchase_invoice(p_invoice_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inv public.purchase_invoices%ROWTYPE;
  v_item public.purchase_invoice_items%ROWTYPE;
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

  FOR v_item IN SELECT * FROM public.purchase_invoice_items WHERE invoice_id = p_invoice_id LOOP
    IF v_item.item_type = 'bobina' AND v_item.raw_material_id IS NOT NULL THEN
      UPDATE public.raw_materials
         SET current_stock_kg = GREATEST(0, current_stock_kg - v_item.quantity), updated_at = now()
       WHERE id = v_item.raw_material_id;
      INSERT INTO public.inventory_transactions
        (movement_type, raw_material_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.raw_material_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, 'Anulación factura ' || v_inv.invoice_number || ': ' || trim(p_reason), auth.uid());
    ELSIF v_item.item_type = 'core' AND v_item.core_id IS NOT NULL THEN
      UPDATE public.core_specifications
         SET current_stock_units = GREATEST(0, current_stock_units - v_item.quantity::integer), updated_at = now()
       WHERE id = v_item.core_id;
      INSERT INTO public.inventory_transactions
        (movement_type, core_id, quantity, unit_cost, total_cost, purchase_invoice_id, notes, created_by)
      VALUES ('anulacion_compra', v_item.core_id, v_item.quantity, v_item.unit_cost, v_item.subtotal,
              p_invoice_id, 'Anulación factura ' || v_inv.invoice_number || ': ' || trim(p_reason), auth.uid());
    END IF;
  END LOOP;

  UPDATE public.purchase_invoices
     SET status = 'anulada', annulled_reason = trim(p_reason), updated_at = now()
   WHERE id = p_invoice_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_sync_invoice_payments() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.register_purchase_invoice(jsonb, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.annul_purchase_invoice(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.register_purchase_invoice(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.annul_purchase_invoice(uuid, text) TO authenticated;

-- ---------- RLS ----------
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin gestiona proveedores" ON public.suppliers
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Vendedor consulta proveedores" ON public.suppliers
  FOR SELECT TO authenticated USING (public.current_user_role() = 'vendedor');

CREATE POLICY "Admin gestiona facturas de compra" ON public.purchase_invoices
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona items de factura" ON public.purchase_invoice_items
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona pagos a proveedores" ON public.supplier_payments
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
