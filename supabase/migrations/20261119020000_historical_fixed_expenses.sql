-- =====================================================================
-- Histórico de gastos fijos (imagen "gastosfijos.jpeg", feb–oct 2026), sin detalle.
--  - Un gasto ocasional PAGADO por mes, categoría "Gastos fijos (histórico)" (operacional, 5195),
--    con vencimiento/pago el último día del mes y SIN cuenta (no mueve caja ni bancos).
--  - Alimenta el Estado de resultados de esos meses (antes la utilidad salía inflada).
-- =====================================================================
INSERT INTO public.expense_categories (name, expense_group, puc_code, color)
SELECT 'Gastos fijos (histórico)', 'operacional', '5195', '#949E97'
 WHERE NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE name = 'Gastos fijos (histórico)');

INSERT INTO public.expenses (category_id, description, period_month, due_date, amount, principal_amount,
                             status, paid_date, payment_method, reference, notes, created_by)
SELECT c.id, 'Gastos fijos ' || v.label || ' 2026 (histórico)', v.m,
       (v.m + interval '1 month - 1 day')::date, v.amount, 0,
       'pagado', (v.m + interval '1 month - 1 day')::date, 'otro', 'Histórico gastos fijos',
       'Total del mes cargado desde el histórico (sin detalle; no mueve caja ni bancos)',
       '724a3f09-9990-4f09-8b90-1d8a549d178c'
  FROM public.expense_categories c,
       (VALUES (date '2026-02-01', 'febrero', 1500000), (date '2026-03-01', 'marzo', 2800000),
               (date '2026-04-01', 'abril', 3000000), (date '2026-05-01', 'mayo', 5600000),
               (date '2026-06-01', 'junio', 11000000), (date '2026-07-01', 'julio', 11000000),
               (date '2026-08-01', 'agosto', 13500000), (date '2026-09-01', 'septiembre', 14634000),
               (date '2026-10-01', 'octubre', 14634000)) AS v(m, label, amount)
 WHERE c.name = 'Gastos fijos (histórico)'
   AND NOT EXISTS (SELECT 1 FROM public.expenses e WHERE e.category_id = c.id AND e.period_month = v.m);
