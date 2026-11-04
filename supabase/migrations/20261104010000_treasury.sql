-- ============================================================
-- TESORERÍA: CAJA, BANCOS, CAJA MENOR, SOPORTES, CIERRE DIARIO Y CONCILIACIÓN
--
-- Principio: el dinero no se digita dos veces. Los pagos existentes (cobros a clientes,
-- pagos a proveedores, gastos pagados) llevan `account_id` y un trigger genera su
-- movimiento en `treasury_movements`. Solo las transferencias, otros ingresos/egresos y
-- ajustes se registran manualmente (RPC). El saldo de cada cuenta lo mantiene un trigger.
-- Los movimientos conciliados quedan bloqueados.
-- ============================================================

CREATE TYPE public.treasury_account_type AS ENUM ('caja_general', 'banco', 'caja_menor');
CREATE TYPE public.treasury_direction AS ENUM ('ingreso', 'egreso');
CREATE TYPE public.treasury_movement_type AS ENUM (
  'saldo_inicial', 'cobro_cliente', 'pago_proveedor', 'pago_gasto',
  'transferencia_entrada', 'transferencia_salida', 'otro_ingreso', 'otro_egreso', 'ajuste'
);

-- ---------- Cuentas ----------
CREATE TABLE public.treasury_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  account_type public.treasury_account_type NOT NULL,
  puc_code text,                                  -- 110505 caja general, 110510 caja menor, 111005 bancos
  bank_name text,
  account_number text,
  bank_account_type text CHECK (bank_account_type IN ('ahorros', 'corriente')),
  opening_balance numeric NOT NULL DEFAULT 0,
  opening_date date NOT NULL DEFAULT current_date,
  current_balance numeric NOT NULL DEFAULT 0,     -- mantenido por trigger
  petty_cash_fund numeric CHECK (petty_cash_fund >= 0), -- caja menor: monto del fondo fijo
  color text NOT NULL DEFAULT '#3F8346',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Movimientos ----------
CREATE TABLE public.treasury_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT,
  movement_date date NOT NULL DEFAULT current_date,
  direction public.treasury_direction NOT NULL,
  movement_type public.treasury_movement_type NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  third_party text,                               -- cliente / proveedor / beneficiario
  reference text,                                 -- n.º de transferencia, recibo, cheque
  support_path text,                              -- ruta del soporte en Storage (bucket "soportes")
  -- Documento origen (uno como máximo). Al borrar el origen se borra el movimiento.
  customer_payment_id uuid UNIQUE REFERENCES public.customer_payments(id) ON DELETE CASCADE,
  supplier_payment_id uuid UNIQUE REFERENCES public.supplier_payments(id) ON DELETE CASCADE,
  expense_id uuid UNIQUE REFERENCES public.expenses(id) ON DELETE CASCADE,
  transfer_group uuid,                            -- une las dos patas de una transferencia
  -- Conciliación
  reconciled boolean NOT NULL DEFAULT false,
  reconciliation_id uuid,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_treasury_movements_account_date ON public.treasury_movements(account_id, movement_date);
CREATE INDEX idx_treasury_movements_reconciled ON public.treasury_movements(account_id, reconciled);
CREATE INDEX idx_treasury_movements_transfer ON public.treasury_movements(transfer_group);

-- ---------- Cierre diario (arqueo de caja / saldo del banco al final del día) ----------
CREATE TABLE public.daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE CASCADE,
  closing_date date NOT NULL,
  system_balance numeric NOT NULL,                -- saldo según el sistema a esa fecha
  counted_balance numeric NOT NULL,               -- efectivo contado / saldo visto en el banco
  difference numeric GENERATED ALWAYS AS (counted_balance - system_balance) STORED,
  adjustment_movement_id uuid REFERENCES public.treasury_movements(id) ON DELETE SET NULL,
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, closing_date)
);

-- ---------- Conciliaciones bancarias ----------
CREATE TABLE public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.treasury_accounts(id) ON DELETE CASCADE,
  statement_date date NOT NULL,                   -- fecha de corte del extracto
  statement_balance numeric NOT NULL,             -- saldo según el extracto
  book_balance numeric NOT NULL,                  -- saldo conciliado en libros al cierre
  movements_count integer NOT NULL DEFAULT 0,
  support_path text,                              -- extracto en PDF
  notes text,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.treasury_movements
  ADD CONSTRAINT treasury_movements_reconciliation_fk
  FOREIGN KEY (reconciliation_id) REFERENCES public.bank_reconciliations(id) ON DELETE SET NULL;

-- ---------- Cuenta de origen/destino en los pagos existentes ----------
ALTER TABLE public.customer_payments ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT;
ALTER TABLE public.supplier_payments ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.treasury_accounts(id) ON DELETE RESTRICT;

-- ---------- RLS ----------
ALTER TABLE public.treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;

-- Vendedores pueden ver las cuentas (para elegir dónde entra un cobro); solo admin las gestiona
CREATE POLICY "Leer cuentas de tesoreria" ON public.treasury_accounts
  FOR SELECT TO authenticated USING (public.current_user_role() IN ('admin', 'vendedor'));
CREATE POLICY "Admin gestiona cuentas de tesoreria" ON public.treasury_accounts
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona movimientos de tesoreria" ON public.treasury_movements
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona cierres diarios" ON public.daily_closings
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');
CREATE POLICY "Admin gestiona conciliaciones" ON public.bank_reconciliations
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin') WITH CHECK (public.current_user_role() = 'admin');

-- ============================================================
-- Saldo de la cuenta: se recalcula con cada movimiento
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_treasury_recalc_balance(p_account_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.treasury_accounts a
     SET current_balance = a.opening_balance + COALESCE((
           SELECT SUM(CASE WHEN m.direction = 'ingreso' THEN m.amount ELSE -m.amount END)
             FROM public.treasury_movements m WHERE m.account_id = a.id), 0),
         updated_at = now()
   WHERE a.id = p_account_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_treasury_movements_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.reconciled AND current_setting('inbobinex.allow_reconciled', true) IS DISTINCT FROM 'on' THEN
    IF TG_OP = 'DELETE' OR NEW.amount <> OLD.amount OR NEW.direction <> OLD.direction
       OR NEW.account_id <> OLD.account_id OR NEW.movement_date <> OLD.movement_date THEN
      RAISE EXCEPTION 'El movimiento "%" ya está conciliado; no se puede modificar ni eliminar', OLD.description;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.fn_treasury_recalc_balance(NEW.account_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.account_id <> OLD.account_id) THEN
    PERFORM public.fn_treasury_recalc_balance(OLD.account_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tr_treasury_movements_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.treasury_movements
  FOR EACH ROW EXECUTE FUNCTION public.fn_treasury_movements_balance();

-- El saldo inicial también afecta el saldo actual
CREATE OR REPLACE FUNCTION public.fn_treasury_accounts_opening()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance THEN
    PERFORM public.fn_treasury_recalc_balance(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER tr_treasury_accounts_opening
  AFTER INSERT OR UPDATE OF opening_balance ON public.treasury_accounts
  FOR EACH ROW EXECUTE FUNCTION public.fn_treasury_accounts_opening();

-- ============================================================
-- Sincronización: pagos existentes → movimientos de tesorería
-- ============================================================

-- Cobros de clientes: entra el valor recibido (la retención no es efectivo)
CREATE OR REPLACE FUNCTION public.fn_sync_customer_payment_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_client text;
BEGIN
  -- Edición sin cambios de dinero (ej: referencia): solo actualiza el texto, sin tocar conciliación
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND NEW.amount = OLD.amount AND NEW.payment_date = OLD.payment_date THEN
    UPDATE public.treasury_movements SET reference = NEW.reference WHERE customer_payment_id = NEW.id;
    RETURN NEW;
  END IF;
  DELETE FROM public.treasury_movements WHERE customer_payment_id = COALESCE(NEW.id, OLD.id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.account_id IS NOT NULL AND NEW.amount > 0 THEN
    SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
    SELECT business_name INTO v_client FROM public.clients WHERE id = v_order.client_id;
    INSERT INTO public.treasury_movements
      (account_id, movement_date, direction, movement_type, amount, description, third_party, reference, customer_payment_id, created_by)
    VALUES
      (NEW.account_id, NEW.payment_date, 'ingreso', 'cobro_cliente', NEW.amount,
       'Cobro pedido #' || v_order.order_number, v_client, NEW.reference, NEW.id, COALESCE(auth.uid(), NEW.created_by));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_sync_customer_payment_treasury
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_customer_payment_treasury();

-- Pagos a proveedores
CREATE OR REPLACE FUNCTION public.fn_sync_supplier_payment_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv public.purchase_invoices%ROWTYPE;
  v_supplier text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND NEW.amount = OLD.amount AND NEW.payment_date = OLD.payment_date THEN
    UPDATE public.treasury_movements SET reference = NEW.reference WHERE supplier_payment_id = NEW.id;
    RETURN NEW;
  END IF;
  DELETE FROM public.treasury_movements WHERE supplier_payment_id = COALESCE(NEW.id, OLD.id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.account_id IS NOT NULL AND NEW.amount > 0 THEN
    SELECT * INTO v_inv FROM public.purchase_invoices WHERE id = NEW.invoice_id;
    SELECT business_name INTO v_supplier FROM public.suppliers WHERE id = v_inv.supplier_id;
    INSERT INTO public.treasury_movements
      (account_id, movement_date, direction, movement_type, amount, description, third_party, reference, supplier_payment_id, created_by)
    VALUES
      (NEW.account_id, NEW.payment_date, 'egreso', 'pago_proveedor', NEW.amount,
       'Pago factura ' || v_inv.invoice_number, v_supplier, NEW.reference, NEW.id, COALESCE(auth.uid(), NEW.created_by));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_sync_supplier_payment_treasury
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_supplier_payment_treasury();

-- Gastos pagados (incluye los de caja menor)
CREATE OR REPLACE FUNCTION public.fn_sync_expense_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_support text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id AND NEW.amount = OLD.amount
     AND NEW.status = OLD.status AND NEW.paid_date IS NOT DISTINCT FROM OLD.paid_date THEN
    UPDATE public.treasury_movements
       SET description = NEW.description, third_party = NEW.payee_name, reference = NEW.reference
     WHERE expense_id = NEW.id;
    RETURN NEW;
  END IF;
  -- Conserva el soporte ya adjuntado al movimiento si el gasto se edita
  SELECT support_path INTO v_support FROM public.treasury_movements WHERE expense_id = COALESCE(NEW.id, OLD.id);
  DELETE FROM public.treasury_movements WHERE expense_id = COALESCE(NEW.id, OLD.id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW.account_id IS NOT NULL AND NEW.status = 'pagado' AND NEW.amount > 0 THEN
    INSERT INTO public.treasury_movements
      (account_id, movement_date, direction, movement_type, amount, description, third_party, reference, support_path, expense_id, created_by)
    VALUES
      (NEW.account_id, COALESCE(NEW.paid_date, current_date), 'egreso', 'pago_gasto', NEW.amount,
       NEW.description, NEW.payee_name, NEW.reference, v_support, NEW.id, COALESCE(auth.uid(), NEW.created_by));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_sync_expense_treasury
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_expense_treasury();

-- ============================================================
-- RPC: movimiento manual (otro ingreso / otro egreso / ajuste)
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_treasury_movement(
  p_account_id uuid,
  p_direction public.treasury_direction,
  p_type public.treasury_movement_type,
  p_amount numeric,
  p_date date,
  p_description text,
  p_third_party text DEFAULT NULL,
  p_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_acc public.treasury_accounts%ROWTYPE;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar movimientos de tesorería';
  END IF;
  IF p_type NOT IN ('otro_ingreso', 'otro_egreso', 'ajuste') THEN
    RAISE EXCEPTION 'Use el módulo correspondiente: cobros, pagos a proveedores, gastos o transferencias';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El valor debe ser mayor a 0'; END IF;
  IF NULLIF(trim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Describe el movimiento'; END IF;

  SELECT * INTO v_acc FROM public.treasury_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;
  IF p_direction = 'egreso' AND v_acc.account_type <> 'banco' AND p_amount > v_acc.current_balance THEN
    RAISE EXCEPTION 'Saldo insuficiente en "%": hay %', v_acc.name, round(v_acc.current_balance);
  END IF;

  INSERT INTO public.treasury_movements
    (account_id, movement_date, direction, movement_type, amount, description, third_party, reference)
  VALUES
    (p_account_id, COALESCE(p_date, current_date), p_direction, p_type, p_amount, trim(p_description),
     NULLIF(trim(p_third_party), ''), NULLIF(trim(p_reference), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============================================================
-- RPC: transferencia entre cuentas (ej: consignar efectivo, reembolsar caja menor)
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_between_accounts(
  p_from uuid,
  p_to uuid,
  p_amount numeric,
  p_date date,
  p_description text DEFAULT NULL,
  p_reference text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_from public.treasury_accounts%ROWTYPE;
  v_to public.treasury_accounts%ROWTYPE;
  v_desc text;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar transferencias';
  END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'Elige dos cuentas distintas'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'El valor debe ser mayor a 0'; END IF;

  SELECT * INTO v_from FROM public.treasury_accounts WHERE id = p_from;
  SELECT * INTO v_to FROM public.treasury_accounts WHERE id = p_to;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;
  IF v_from.account_type <> 'banco' AND p_amount > v_from.current_balance THEN
    RAISE EXCEPTION 'Saldo insuficiente en "%": hay %', v_from.name, round(v_from.current_balance);
  END IF;

  v_desc := COALESCE(NULLIF(trim(p_description), ''),
                     CASE WHEN v_to.account_type = 'caja_menor' THEN 'Reembolso caja menor'
                          WHEN v_from.account_type = 'caja_general' AND v_to.account_type = 'banco' THEN 'Consignación de efectivo'
                          ELSE 'Transferencia entre cuentas' END);

  INSERT INTO public.treasury_movements
    (account_id, movement_date, direction, movement_type, amount, description, third_party, reference, transfer_group)
  VALUES
    (p_from, COALESCE(p_date, current_date), 'egreso', 'transferencia_salida', p_amount, v_desc, v_to.name, NULLIF(trim(p_reference), ''), v_group),
    (p_to, COALESCE(p_date, current_date), 'ingreso', 'transferencia_entrada', p_amount, v_desc, v_from.name, NULLIF(trim(p_reference), ''), v_group);
  RETURN v_group;
END;
$$;

-- ============================================================
-- RPC: cierre diario (arqueo). Opcionalmente registra un ajuste por la diferencia.
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_daily_closing(
  p_account_id uuid,
  p_date date,
  p_counted numeric,
  p_create_adjustment boolean DEFAULT false,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acc public.treasury_accounts%ROWTYPE;
  v_system numeric;
  v_diff numeric;
  v_adj uuid;
  v_id uuid;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede registrar cierres';
  END IF;
  IF p_counted IS NULL OR p_counted < 0 THEN RAISE EXCEPTION 'Ingresa el saldo contado'; END IF;

  SELECT * INTO v_acc FROM public.treasury_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;

  -- Saldo del sistema al final de ese día
  SELECT v_acc.opening_balance + COALESCE(SUM(CASE WHEN direction = 'ingreso' THEN amount ELSE -amount END), 0)
    INTO v_system
    FROM public.treasury_movements WHERE account_id = p_account_id AND movement_date <= p_date;
  v_diff := p_counted - v_system;

  IF p_create_adjustment AND v_diff <> 0 THEN
    INSERT INTO public.treasury_movements
      (account_id, movement_date, direction, movement_type, amount, description)
    VALUES
      (p_account_id, p_date, CASE WHEN v_diff > 0 THEN 'ingreso' ELSE 'egreso' END::public.treasury_direction,
       'ajuste', abs(v_diff),
       CASE WHEN v_diff > 0 THEN 'Sobrante en cierre del ' ELSE 'Faltante en cierre del ' END || to_char(p_date, 'DD/MM/YYYY'))
    RETURNING id INTO v_adj;
  END IF;

  INSERT INTO public.daily_closings (account_id, closing_date, system_balance, counted_balance, adjustment_movement_id, notes)
  VALUES (p_account_id, p_date, v_system, p_counted, v_adj, NULLIF(trim(p_notes), ''))
  ON CONFLICT (account_id, closing_date) DO UPDATE
    SET system_balance = EXCLUDED.system_balance,
        counted_balance = EXCLUDED.counted_balance,
        adjustment_movement_id = COALESCE(EXCLUDED.adjustment_movement_id, public.daily_closings.adjustment_movement_id),
        notes = EXCLUDED.notes
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'system_balance', v_system, 'difference', v_diff, 'adjustment_id', v_adj);
END;
$$;

-- ============================================================
-- RPC: cerrar conciliación bancaria
--   Marca como conciliados los movimientos seleccionados (los que aparecen en el extracto).
--   Exige que saldo extracto = saldo inicial + movimientos conciliados (anteriores + seleccionados).
-- ============================================================
CREATE OR REPLACE FUNCTION public.close_bank_reconciliation(
  p_account_id uuid,
  p_statement_date date,
  p_statement_balance numeric,
  p_movement_ids uuid[],
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acc public.treasury_accounts%ROWTYPE;
  v_book numeric;
  v_id uuid;
  v_count integer;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede conciliar';
  END IF;
  SELECT * INTO v_acc FROM public.treasury_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta no encontrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.treasury_movements
              WHERE id = ANY(COALESCE(p_movement_ids, '{}')) AND (account_id <> p_account_id OR reconciled OR movement_date > p_statement_date)) THEN
    RAISE EXCEPTION 'Hay movimientos seleccionados de otra cuenta, ya conciliados o posteriores a la fecha del extracto';
  END IF;

  SELECT v_acc.opening_balance + COALESCE(SUM(CASE WHEN direction = 'ingreso' THEN amount ELSE -amount END), 0)
    INTO v_book
    FROM public.treasury_movements
   WHERE account_id = p_account_id AND (reconciled OR id = ANY(COALESCE(p_movement_ids, '{}')));

  IF round(v_book) <> round(p_statement_balance) THEN
    RAISE EXCEPTION 'No cuadra: saldo extracto % vs saldo conciliado en libros % (diferencia %)',
      round(p_statement_balance), round(v_book), round(p_statement_balance - v_book);
  END IF;

  v_count := COALESCE(array_length(p_movement_ids, 1), 0);
  INSERT INTO public.bank_reconciliations (account_id, statement_date, statement_balance, book_balance, movements_count, notes)
  VALUES (p_account_id, p_statement_date, p_statement_balance, v_book, v_count, NULLIF(trim(p_notes), ''))
  RETURNING id INTO v_id;

  UPDATE public.treasury_movements
     SET reconciled = true, reconciliation_id = v_id
   WHERE id = ANY(COALESCE(p_movement_ids, '{}'));

  RETURN v_id;
END;
$$;

-- Deshacer la última conciliación de una cuenta (por si se cerró con errores)
CREATE OR REPLACE FUNCTION public.undo_bank_reconciliation(p_reconciliation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rec public.bank_reconciliations%ROWTYPE;
BEGIN
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo un administrador puede deshacer conciliaciones';
  END IF;
  SELECT * INTO v_rec FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conciliación no encontrada'; END IF;
  IF EXISTS (SELECT 1 FROM public.bank_reconciliations
              WHERE account_id = v_rec.account_id AND created_at > v_rec.created_at) THEN
    RAISE EXCEPTION 'Solo se puede deshacer la conciliación más reciente de la cuenta';
  END IF;
  PERFORM set_config('inbobinex.allow_reconciled', 'on', true);
  UPDATE public.treasury_movements SET reconciled = false, reconciliation_id = NULL
   WHERE reconciliation_id = p_reconciliation_id;
  DELETE FROM public.bank_reconciliations WHERE id = p_reconciliation_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_treasury_movement(uuid, public.treasury_direction, public.treasury_movement_type, numeric, date, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.transfer_between_accounts(uuid, uuid, numeric, date, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_daily_closing(uuid, date, numeric, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.close_bank_reconciliation(uuid, date, numeric, uuid[], text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.undo_bank_reconciliation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_treasury_movement(uuid, public.treasury_direction, public.treasury_movement_type, numeric, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_between_accounts(uuid, uuid, numeric, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_daily_closing(uuid, date, numeric, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_bank_reconciliation(uuid, date, numeric, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_bank_reconciliation(uuid) TO authenticated;
-- Funciones internas (triggers / recálculo): no exponer como RPC
REVOKE EXECUTE ON FUNCTION public.fn_treasury_recalc_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_treasury_movements_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_treasury_accounts_opening() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_customer_payment_treasury() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_supplier_payment_treasury() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_expense_treasury() FROM PUBLIC, anon, authenticated;

-- ---------- Cuentas iniciales ----------
INSERT INTO public.treasury_accounts (name, account_type, puc_code, color, petty_cash_fund, notes) VALUES
  ('Caja general', 'caja_general', '110505', '#3F8346', NULL, 'Efectivo de la empresa'),
  ('Caja menor', 'caja_menor', '110510', '#F59E0B', 0, 'Fondo fijo para gastos menores e imprevistos');

-- Categoría de gasto para gastos bancarios y 4x1000 (aparece en conciliaciones)
INSERT INTO public.expense_categories (name, expense_group, puc_code, description, color, display_order)
VALUES ('Gastos bancarios y GMF', 'no_operacional', '5305', 'Comisiones, cuota de manejo y 4x1000 (GMF)', '#475569', 10)
ON CONFLICT (name) DO NOTHING;

-- ---------- Storage: soportes privados ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('soportes', 'soportes', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admin lee soportes" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'soportes' AND public.current_user_role() = 'admin');
CREATE POLICY "Admin sube soportes" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'soportes' AND public.current_user_role() = 'admin');
CREATE POLICY "Admin actualiza soportes" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'soportes' AND public.current_user_role() = 'admin');
CREATE POLICY "Admin elimina soportes" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'soportes' AND public.current_user_role() = 'admin');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
                   AND schemaname = 'public' AND tablename = 'treasury_movements') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.treasury_movements;
    END IF;
  END IF;
END $$;
