-- Solo se eliminan pedidos "En cola": después ya movieron producción, inventario
-- (listo_despacho descuenta stock) o cartera. Esos se CANCELAN, no se borran.
CREATE OR REPLACE FUNCTION public.fn_orders_delete_only_en_cola()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status <> 'en_cola' THEN
    RAISE EXCEPTION 'Solo se pueden eliminar pedidos en estado "En cola" (el pedido #% está en %)',
      OLD.order_number, replace(OLD.status::text, '_', ' ');
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_orders_delete_only_en_cola ON public.orders;
CREATE TRIGGER tr_orders_delete_only_en_cola
  BEFORE DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_orders_delete_only_en_cola();
REVOKE ALL ON FUNCTION public.fn_orders_delete_only_en_cola() FROM PUBLIC, anon, authenticated;
