-- =====================================================================
-- TRABAJADORES DE CORES / PRESTACIÓN DE SERVICIOS, TRABAJO CAUSADO Y PAGOS
--
--  workers           personas que arman cores, cortan cartón o prestan servicios
--  worker_earnings   lo causado por persona (una línea por persona y trabajo):
--                    armado / corte_carton (desde el armado de cores) o servicio (manual).
--                    worker_id NULL = "sin asignar" (armado registrado sin personas).
--  worker_payments   pago a UNA persona (agrupados por batch_id cuando se paga varios a
--                    la vez). Cada pago crea su movimiento de tesorería (egreso
--                    'pago_mano_obra'). No es gasto del P&G: la mano de obra de cores ya
--                    está en el costo del core (se reconoce al vender).
--
-- Flujo: el operario registra el armado con las personas y sus cores ->
--        se causan las líneas -> el admin paga por día, semana o todo lo pendiente,
--        eligiendo la cuenta, y el sistema lo divide por persona.
-- =====================================================================

-- (Se aplica en una migración aparte: un valor de enum nuevo no puede usarse en la
--  misma transacción en que se crea.)
ALTER TYPE public.treasury_movement_type ADD VALUE IF NOT EXISTS 'pago_mano_obra';
