-- =====================================================================
-- Zona horaria de Colombia (UTC-5). Antes todo corría en UTC: después de las
-- 7 p. m. hora Colombia, current_date y los ::date de created_at caían en el
-- día siguiente (pedidos fuera del rango en estadísticas/P&G, "vencidos" un
-- día antes, fechas por defecto corridas).
--  1) Zona por defecto de la base (nuevas conexiones de la API, triggers, defaults).
--  2) Zona fija en las funciones que calculan fechas, para que no dependan de la
--     sesión (aplica de inmediato aunque haya conexiones abiertas en UTC).
-- Los timestamptz guardados NO cambian (son instantes absolutos); solo cambia
-- cómo se convierten a fecha.
-- =====================================================================
ALTER DATABASE postgres SET timezone TO 'America/Bogota';

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~* 'current_date|::date|now\(\)|date_trunc'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET timezone TO %L', f.sig, 'America/Bogota');
  END LOOP;
END $$;
