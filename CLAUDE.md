# Inbobinex — Guía de Arquitectura y Contexto para Claude Code

## 1. 🏭 Descripción del Negocio
**Inbobinex** es una empresa de manufactura y distribución de películas plásticas (stretch film / vinipel) y materiales de embalaje en Medellín, Colombia.

El sistema unifica dos aplicaciones sobre un mismo backend en **Supabase**:
1. **Panel Web de Administración y Ventas (Next.js 14 App Router):**
   - Gestión integral de pedidos y solicitudes para planta.
   - Control de inventarios de materia prima (bobinas madre en kg) y cores/tubos de cartón por medida.
   - Auditoría de movimientos con Kardex valorizado en pesos colombianos (COP).
   - Administración de clientes y catálogo de categorías.
2. **App Móvil para Operarios de Planta (React Native + Expo):**
   - Visualización de pedidos en cola para embobinado.
   - Cambio de estados de producción en tiempo real.
   - Registro rápido de cortes de cores realizados en planta.

---

## 2. 🗂️ Estructura del Proyecto

```
c:\Users\jubla\Desktop\Inbobinex\
├── app/                                # Next.js 14 App Router
│   ├── (admin)/admin/page.tsx         # Panel principal: Pedidos, Clientes, Inventarios, Catálogo
│   ├── (tienda)/                      # Catálogo y tienda pública informativa
│   └── api/categories/                # API REST de categorías conectada a Supabase
│       ├── route.ts                   # GET (lista) y POST (crear / { seed: true })
│       └── [id]/route.ts              # PUT (actualizar) y DELETE (eliminar con desvinculación)
├── components/admin/                  # Módulos del Panel de Administración
│   ├── orders-panel.tsx               # Gestión de pedidos: stretch (medida única) + productos de bodega
│   ├── orders/order-products-editor.tsx # Líneas de productos de inventario dentro del pedido
│   ├── inventory-panel.tsx            # KPIs, bobinas madre, cores, otros inventarios y Kardex
│   ├── inventory/general-inventory.tsx # Otros inventarios: cintas, cartón industrial, etc. (categorías)
│   ├── clients-panel.tsx              # Directorio de clientes con NIT/RUT, plazo de pago y cupo
│   ├── admin-sidebar.tsx              # Menú lateral plegable (módulos, usuario, salir)
│   ├── expenses/                      # Gastos fijos y operativos
│   │   ├── expenses-panel.tsx         # Vista del mes, plantillas de gastos fijos, resumen anual
│   │   ├── recurring-expense-modal.tsx # Alta/edición de gasto fijo (frecuencia, créditos)
│   │   ├── expense-modal.tsx          # Pagar / editar / gasto ocasional
│   │   └── utils.ts                   # Frecuencias, grupos, helpers de mes
│   ├── treasury/                      # Caja, bancos, caja menor, cierre diario, conciliación
│   │   ├── treasury-panel.tsx         # Resumen, movimientos (soportes), caja menor
│   │   ├── daily-closing-tab.tsx      # Arqueo / saldo al final del día (con conteo por billetes)
│   │   ├── reconciliation-tab.tsx     # Conciliación bancaria contra extracto
│   │   ├── treasury-modals.tsx        # Cuenta, movimiento/transferencia, gasto de caja menor
│   │   ├── account-select.tsx         # Selector de cuenta usado en TODOS los formularios de pago
│   │   ├── support-button.tsx / utils.ts # Soportes en Storage (bucket privado "soportes")
│   ├── finance/                       # Indicadores financieros y estado de resultados
│   │   ├── financial-dashboard.tsx    # KPIs por proceso + alertas tempranas (umbrales en THRESHOLDS)
│   │   └── income-statement.tsx       # P&G con filtros: periodo, base, cliente, comparativo, renta
│   ├── receivables/                   # Cuentas por Cobrar (cartera)
│   │   ├── receivables-panel.tsx      # KPIs, antigüedad, saldo por cliente, filtros, export CSV
│   │   └── order-payments-modal.tsx   # Pagos/abonos del pedido (con retención)
│   ├── confirm-dialog.tsx             # useConfirm(): diálogo de confirmación (reemplaza confirm())
│   └── suppliers/                     # Proveedores & Cuentas por Pagar
│       ├── suppliers-panel.tsx        # Tabs: Resumen CxP, Proveedores, Facturas (+ export CSV)
│       ├── supplier-form-modal.tsx    # Alta/edición (NIT + DV DIAN, plazo, datos bancarios)
│       ├── supplier-detail-modal.tsx  # Ficha: KPIs, historial de precios, facturas
│       ├── invoice-form-modal.tsx     # Factura de compra multi-línea (RPC register_purchase_invoice)
│       ├── invoice-detail-modal.tsx   # Detalle, pagos/abonos, anulación (RPC annul_purchase_invoice)
│       └── utils.ts                   # Formatos COP, aging, computeNitDV, downloadCSV
├── lib/
│   ├── types.ts                       # Tipos TypeScript centralizados (Order, RawMaterial, Core, etc.)
│   ├── types/database.types.ts        # Tipos generados de Supabase
│   ├── supabase/                      # Clientes de Supabase
│   │   ├── client.ts                  # Cliente browser (createBrowserClient)
│   │   ├── server.ts                  # Cliente servidor Next.js (createServerClient)
│   │   └── middleware.ts              # Middleware de sesión
│   └── auth-context.tsx               # Contexto React de autenticación y perfil de usuario
├── app-operarios/                     # App móvil Expo / React Native
│   ├── src/screens/
│   │   ├── LoginScreen.tsx            # Login con Supabase Auth
│   │   ├── OrdersScreen.tsx           # Lista de pedidos en cola / embobinado
│   │   ├── OrderDetailModal.tsx       # Transiciones de estado de producción
│   │   ├── RegisterCoresModal.tsx     # Registro de cores armados (agrupados por material)
│   │   ├── NewOrderScreen.tsx         # (admin) Pedido rápido vía RPC create_order
│   │   ├── PayablesScreen.tsx         # (admin) CxP: resumen, facturas abiertas, registrar pago
│   │   └── NewInvoiceForm.tsx         # (admin) Factura de compra vía RPC register_purchase_invoice
│   ├── src/components/Notice.tsx      # NoticeProvider / useNotice / InlineNotice (reemplaza Alert.alert)
│   ├── src/components/ui.tsx          # UI compartida: ScreenHeader, Card, Input, SearchPicker, Segmented, Stepper...
│   ├── src/components/TabBar.tsx      # Barra inferior (solo admin): Planta / Nuevo pedido / Proveedores
│   ├── src/theme.ts                   # Colores, sombras, PRIORITY, STATUS, relativeDay()
│   └── types/index.ts                 # Tipos móviles compartidos
├── supabase/migrations/               # Migraciones SQL (políticas RLS, FKs)
├── .claude/
│   └── settings.json                  # Permisos de herramientas para Claude Code
└── CLAUDE.md                          # Este archivo de contexto
```

---

## 3. 🗄️ Base de Datos Supabase (PostgreSQL + Realtime)

- **URL:** `https://jfyqafrsnjqlwjxuezjp.supabase.co`
- **Anon Key (Pública):** `sb_publishable_eLt8Hvw50SMKvyP73Js-YA_JTrpSJn9`
- **Moneda:** Todos los precios y costos se expresan en **COP (Pesos Colombianos)** sin decimales.

### Enums de PostgreSQL:
- `user_role`: `'admin' | 'vendedor' | 'operario'`
- `order_status`: `'pendiente' | 'en_cola' | 'en_embobinado' | 'listo_despacho' | 'enviado' | 'entregado' | 'cancelado'`
- `order_priority`: `'baja' | 'normal' | 'alta' | 'urgente'`
- `film_type`: `'manual' | 'maquina' | 'preestirado' | 'color_negro' | 'color_azul' | 'otro'`
- `inventory_movement_type`: `'entrada_compra' | 'produccion_core' | 'consumo_pedido' | 'merma_desperdicio' | 'ajuste_manual' | 'anulacion_compra' | 'consumo_armado_core' | 'salida_venta' | 'consumo_interno'`
- `supplier_category`: `'materia_prima' | 'cores_tubos' | 'insumos' | 'servicios' | 'transporte' | 'otro'`
- `purchase_invoice_status`: `'pendiente' | 'parcial' | 'pagada' | 'anulada'`
- `payment_method`: `'transferencia' | 'efectivo' | 'cheque' | 'tarjeta' | 'otro'`
- `expense_group`: `'operacional' | 'no_operacional' | 'financiero'`
- `expense_frequency`: `'quincenal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'unico'`
- `expense_status`: `'pendiente' | 'pagado' | 'anulado'`
- `treasury_account_type`: `'caja_general' | 'banco' | 'caja_menor'`
- `treasury_direction`: `'ingreso' | 'egreso'`
- `treasury_movement_type`: `'saldo_inicial' | 'cobro_cliente' | 'pago_proveedor' | 'pago_gasto' | 'transferencia_entrada' | 'transferencia_salida' | 'otro_ingreso' | 'otro_egreso' | 'ajuste'`
- `receivable_status`: `'pendiente' | 'parcial' | 'pagado'`
- `purchase_item_type`: `'bobina' | 'core' | 'insumo' | 'otro'`

### Tablas y Esquemas DDL:

#### `profiles`
```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text NOT NULL,
  full_name text NOT NULL,
  role user_role NOT NULL DEFAULT 'operario',
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### `clients`
```sql
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  nit_rut text UNIQUE,
  contact_name text NOT NULL,
  phone text NOT NULL,
  email text,
  delivery_address text NOT NULL,
  city text NOT NULL DEFAULT 'Medellín',
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### `categories`
```sql
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  description text,
  created_at timestamptz DEFAULT now()
);
```

#### `products`
```sql
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.categories(id),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  image_url text,
  gallery text[] DEFAULT '{}',
  film_type film_type DEFAULT 'manual',
  width_cm numeric,
  caliber_microns numeric,
  weight_kg numeric,
  core_weight_grams numeric,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### `orders` y `order_items`
```sql
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number serial UNIQUE,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  assigned_operator_id uuid REFERENCES public.profiles(id),
  status order_status NOT NULL DEFAULT 'en_cola',
  priority order_priority NOT NULL DEFAULT 'normal',
  delivery_date date NOT NULL,
  delivery_address text NOT NULL,
  notes text,
  total_amount numeric NOT NULL DEFAULT 0.00,
  started_at timestamptz,
  completed_at timestamptz,
  shipped_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- REGLA DE NEGOCIO: order_items = stretch FABRICADO, máximo 1 registro por orden (índice único
-- order_items_one_measure_per_order). 0 registros si el pedido es solo de productos de bodega.
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  completed_quantity integer NOT NULL DEFAULT 0,
  custom_length_cm numeric,          -- Ancho/medida (coincide con core_specifications.length_cm)
  custom_caliber_microns numeric,     -- Snapshot del calibre de la bobina madre (se llena solo, no se digita)
  weight_grams numeric,               -- Peso TOTAL por rollo en gramos = core + película (ej: 1500g)
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,     -- Bobina exacta
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,       -- Core exacto
  core_weight_grams numeric NOT NULL DEFAULT 0,  -- Snapshot del peso del core al crear el pedido
  film_weight_grams numeric GENERATED ALWAYS AS (weight_grams - core_weight_grams) STORED,
  -- CHECK (weight_grams > core_weight_grams)
  unit_price numeric NOT NULL DEFAULT 0.00,
  subtotal numeric NOT NULL DEFAULT 0.00,
  notes text,
  created_at timestamptz DEFAULT now()
);
```

#### Tesorería (ver `supabase/migrations/20261104010000_treasury.sql`)
- `treasury_accounts` (caja general 110505, bancos 111005, caja menor 110510 con `petty_cash_fund`): `opening_balance` + `current_balance` (lo mantiene el trigger `tr_treasury_movements_balance`).
- `treasury_movements`: `direction`, `movement_type`, `amount`, `support_path` (Storage), origen único: `customer_payment_id` | `supplier_payment_id` | `expense_id` | `transfer_group`; `reconciled` + `reconciliation_id`.
- **El dinero no se digita dos veces:** `customer_payments`, `supplier_payments` y `expenses` tienen `account_id`; los triggers `tr_sync_*_treasury` crean/borran su movimiento. Sin `account_id` el pago no mueve caja/banco (alerta en el panel).
- RPC: `register_treasury_movement` (solo otro_ingreso/otro_egreso/ajuste), `transfer_between_accounts` (dos patas con `transfer_group`; reembolso caja menor / consignación), `register_daily_closing` (arqueo con ajuste opcional), `close_bank_reconciliation` (exige saldo extracto = inicial + conciliados), `undo_bank_reconciliation` (solo la última).
- **Movimientos conciliados bloqueados:** no cambian monto/fecha/cuenta ni se borran (ni su pago de origen).
- Caja menor: cada gasto es un `expenses` pagado con `account_id` de caja menor → aparece en Gastos y en el P&G.
- Categoría `Gastos bancarios y GMF` (5305) para comisiones y 4x1000 registrados desde la conciliación.

#### Reportes (ver `supabase/migrations/20261104020000_financial_reports.sql`)
- **RPC `income_statement(p_from, p_to, p_basis 'despacho'|'pedido', p_client?, p_tax_rate)`**: ventas = `orders.subtotal`; costo de ventas = Kardex (`consumo_pedido` + `salida_venta`) de esos mismos pedidos; mermas/consumo interno; gastos por `due_date` (amount − principal) por grupo; otros ingresos y ajustes de caja de tesorería.
- **RPC `financial_dashboard()`**: liquidez, CxC/CxP, gastos, inventario, ventas, DSO/DPO/DIO, producción, controles de tesorería y P&G del mes vs. mes anterior. Las alertas se arman en el frontend.

#### Gastos fijos (ver `supabase/migrations/20261103070000_fixed_expenses.sql`)
- `expense_categories(name, expense_group, puc_code, color)`: sembradas Nómina 5105, Arriendo 5120, Servicios públicos 5135, Créditos 5305 (financiero), Industria y comercio 5115, Transporte 5135, Mantenimientos 5145, Insumos y suministros 5195, No operacionales 5315.
- `recurring_expenses` (plantilla): `amount`, `is_variable`, `frequency`, `due_day`, `start_date`/`end_date`, créditos: `installments_total` + `principal_amount` por cuota.
- `expenses` (ocurrencia): `period_month` (día 1), `due_date`, `amount`, `principal_amount` (créditos: capital, **no es gasto**; gasto = amount − principal), `status`, `paid_date`, `payment_method`, `reference`. Índice único `(recurring_id, due_date)`.
- **RPC `generate_recurring_expenses(p_month)`** (admin, idempotente): crea las ocurrencias del mes desde las plantillas activas; quincenal = día 15 y último; día > fin de mes se ajusta al último; créditos se detienen al llegar a `installments_total`. El panel la llama al abrir cada mes.
- Gastos recurrentes no se borran del mes: se **anulan** (si se borraran, el generador los recrearía). Los ocasionales sí se eliminan.
- RLS: solo `admin`.

#### Cuentas por Cobrar e IVA (ver `supabase/migrations/20261103060000_receivables_and_vat.sql`)
- `clients.payment_terms_days` (0 = contado) y `clients.credit_limit` (null = sin límite; solo **avisa** al crear pedidos).
- `orders`: `subtotal` (antes de IVA) + `tax_amount` = `total_amount`; `apply_vat` (interruptor por pedido, 19%), `payment_terms_days` (por defecto el del cliente), `due_date`, `paid_amount`, `payment_status`.
- **Vencimiento:** al crear = `delivery_date + plazo` (estimado); al pasar a `'enviado'` el trigger `tr_orders_receivable_fields` lo recalcula desde la fecha real de despacho.
- `customer_payments(order_id → RESTRICT, payment_date, amount, withholding_amount, method, reference, notes)`: el trigger `tr_sync_order_payments` recalcula `paid_amount` (= recibido + retención) y `payment_status`; bloquea sobrepagos y pagos a pedidos cancelados. Un pedido con pagos **no se puede borrar**.
- RLS pagos: admin y vendedor leen/registran; solo admin edita/elimina.
- Los precios del pedido se digitan **antes de IVA**.

#### `order_products` (productos que salen de bodega en un pedido)
Ver `supabase/migrations/20261103050000_order_products.sql`.
- `kind` ∈ `insumo` (→ `inventory_item_id`) | `bobina` (→ `raw_material_id`, kg) | `core` (→ `core_id`, und) | `material_core` (→ `core_material_id`, kg); `description`, `unit`, `quantity`, `unit_price`, `subtotal` (generada).
- **RPC `create_order(p_order, p_stretch | null, p_products[])`** (admin/vendedor, atómica): valida stock combinado (stretch + productos de la misma referencia), crea cabecera, el stretch y los productos. **Sin stretch** el pedido pasa de inmediato a `'listo_despacho'`.
- `fn_descontar_inventario_despacho` (al pasar a `'listo_despacho'`) descuenta el stretch (`consumo_pedido`) y cada producto (`salida_venta`, con `order_id`); si falta stock de un producto, **bloquea** el cambio de estado.

#### `raw_materials` (Bobinas Madre de Película en Kg)
```sql
CREATE TABLE public.raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  material_type text NOT NULL DEFAULT 'stretch',
  color text NOT NULL DEFAULT 'transparente', -- 'transparente' | 'negro' | 'azul'
  width_cm numeric NOT NULL,                  -- 45, 50, 60 cm (coincide con cores)
  caliber_microns numeric NOT NULL,           -- Calibre en micras (ej: 17), se digita al crear la bobina
  current_stock_kg numeric NOT NULL DEFAULT 0,
  cost_per_kg numeric NOT NULL DEFAULT 0,
  min_stock_alert_kg numeric NOT NULL DEFAULT 50,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### `core_materials` (Material de Cores en Kg)
El proveedor vende el cartón de cores **por kg y costo/kg**. Los operarios unen piezas (mano de obra) para armar
las medidas (15, 30, 45, 50, 60 cm...). Ver `supabase/migrations/20261103020000_core_material_kg_assembly.sql`.
```sql
CREATE TABLE public.core_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  current_stock_kg numeric NOT NULL DEFAULT 0 CHECK (current_stock_kg >= 0),
  cost_per_kg numeric NOT NULL DEFAULT 0,      -- Promedio ponderado (lo recalcula cada factura)
  min_stock_alert_kg numeric NOT NULL DEFAULT 20,
  notes text,
  created_at timestamptz, updated_at timestamptz
);
```

#### `core_specifications` (Cores armados por medida, en unidades)
```sql
CREATE TABLE public.core_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  length_cm numeric NOT NULL,                 -- 15, 30, 45, 50, 60 cm (coincide con raw_materials.width_cm)
  weight_grams numeric NOT NULL DEFAULT 0,    -- Peso promedio del core armado (g): convierte kg <-> unidades
  standard_cost numeric NOT NULL DEFAULT 0,   -- Costo PROMEDIO por core (material + mano de obra), lo recalcula cada armado
  labor_cost_per_unit numeric NOT NULL DEFAULT 0,  -- Mano de obra por core armado (COP)
  core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL,
  current_stock_units integer NOT NULL DEFAULT 0,
  min_stock_alert_units integer NOT NULL DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

- **RPC `register_core_assembly(p_core_id, p_units, p_notes?)`** (admin u operario, atómica): kg = `units × weight_grams / 1000` (**siempre** por el peso promedio del core armado, no se digitan kg); exige `weight_grams > 0`; bloquea si el material no alcanza; resta kg de `core_materials`, suma unidades, recalcula `standard_cost` por promedio ponderado y registra en Kardex `consumo_armado_core` (kg) + `produccion_core` (unidades).
- **RPC `adjust_core_material_stock(p_material_id, p_new_stock_kg, p_notes?)`** (solo admin): ajuste por conteo físico; Kardex `ajuste_manual` con cantidad **con signo**.

#### Otros inventarios: `inventory_categories` + `inventory_items`
Cintas, cartón industrial, papel burbuja, zuncho, bolsas, etc. Ver `supabase/migrations/20261103040000_general_inventory_items.sql`.
- `inventory_categories(id, name UNIQUE, display_order)`: chips/filtros del panel; solo admin gestiona.
- `inventory_items(id, category_id → SET NULL, name, sku UNIQUE, unit, current_stock ≥ 0, avg_cost, sale_price, min_stock_alert, is_active, notes)`: cada producto tiene **su propia unidad** (und, rollo, caja, lámina, kg...).
- Entradas: factura de compra con línea `insumo` (`purchase_invoice_items.inventory_item_id`, promedio ponderado de `avg_cost`) o **RPC `adjust_inventory_item_stock(p_item_id, p_new_stock, p_unit_cost?, p_notes?)`** (solo admin; conteo físico / inventario inicial).
- Salidas: **RPC `register_inventory_exit(p_item_id, p_movement, p_quantity, p_notes?)`** (admin y vendedor) con `p_movement` ∈ `salida_venta | consumo_interno | merma_desperdicio`; bloquea si no hay stock.

#### `inventory_transactions` (Kardex & Auditoría de Movimientos)
```sql
CREATE TABLE public.inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type text NOT NULL,               -- entrada_compra, produccion_core, consumo_pedido, ajuste_manual, etc.
  raw_material_id uuid REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  core_id uuid REFERENCES public.core_specifications(id) ON DELETE SET NULL,
  core_material_id uuid REFERENCES public.core_materials(id) ON DELETE SET NULL,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  quantity numeric NOT NULL,                 -- en la unidad del producto si es inventory_item                 -- kg si es raw_material/core_material, unidades si es core
                                             -- ajuste_manual guarda el signo (negativo = salida)
  unit_cost numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);
```

#### Proveedores y Cuentas por Pagar
Ver DDL completo en `supabase/migrations/20261103010000_suppliers_purchase_invoices_payables.sql`.

| Tabla | Propósito | Campos clave |
|---|---|---|
| `suppliers` | Directorio | `nit` (único) + `verification_digit`, `category`, `payment_terms_days`, datos bancarios, `is_active` |
| `purchase_invoices` | Factura de compra | `UNIQUE(supplier_id, invoice_number)`, `cufe`, `issue_date`, `due_date`, `subtotal`, `tax_amount`, `withholding_amount`, `total` (generada), `paid_amount`, `status` |
| `purchase_invoice_items` | Líneas | `item_type` (`bobina`→`raw_material_id`, `core`→`core_material_id` **en kg**, `insumo`→`inventory_item_id` (unidad del producto), `otro` (gasto sin inventario); `core_id` solo en facturas antiguas), `quantity`, `unit`, `unit_cost`, `subtotal` (generada) |
| `supplier_payments` | Pagos / abonos | `amount`, `payment_date`, `method`, `reference` |

- `inventory_transactions.purchase_invoice_id` enlaza el Kardex con la factura que originó el movimiento.
- **RPC `register_purchase_invoice(p_invoice, p_items)`** (solo admin, atómica): crea factura + líneas; por cada bobina suma kg y recalcula `cost_per_kg` por **promedio ponderado**; por cada línea `core` suma kg a `core_materials` con el mismo promedio ponderado; registra `entrada_compra` en Kardex. Vencimiento por defecto = emisión + `payment_terms_days`.
- **RPC `annul_purchase_invoice(p_invoice_id, p_reason)`** (solo admin): exige 0 pagos; resta el stock ingresado y registra `anulacion_compra`. No recalcula el costo promedio hacia atrás.
- **Trigger `tr_sync_invoice_payments`**: recalcula `paid_amount` y `status` al insertar/editar/borrar pagos; bloquea sobrepagos y pagos a facturas anuladas.
- RLS: solo `admin` gestiona todo; `vendedor` puede leer `suppliers`.

---

## 4. ⚖️ Reglas de Negocio Inviolables

1. **Una Sola Medida de Stretch por Pedido:**
   - El stretch **fabricado** de un pedido (`order_items`) es como máximo **una medida** (lo garantiza un índice único).
   - El botón "+ Agregar otra medida" de stretch fue eliminado intencionalmente. Nunca reintroducirlo.
   - Además del stretch, un pedido puede llevar **cualquier cantidad de productos de bodega** (`order_products`): insumos, bobina madre, cores o material de cores. Un pedido puede ser solo de productos (no pasa por planta).
2. **Correspondencia de Medidas:**
   - El pedido se crea eligiendo una **bobina madre con stock** (define color, ancho y calibre) y un **core** de `length_cm == raw_materials.width_cm`. `custom_length_cm` y `custom_caliber_microns` se copian de la bobina.
3. **Validación Preventiva de Cores:**
   - Si `cantidad_solicitada > core.current_stock_units`, el pedido se bloquea y se alerta al usuario.
4. **Roles y Flujos de Producción:**
   - Los operarios en la app móvil únicamente ven pedidos en estados: `'en_cola'` y `'en_embobinado'`.
   - Al completar un embobinado en planta, el estado avanza a `'listo_despacho'`.
   - La oficina/admin marca la salida a `'enviado'` y entrega a `'entregado'`.
5. **Peso y Consumo de Película:**
   - `weight_grams` del pedido es el peso total del rollo = peso del core + película.
   - Película por rollo = `weight_grams - core_weight_grams`; kg a descontar = película × cantidad / 1000.
   - El descuento real ocurre en el trigger `fn_descontar_inventario_despacho` al pasar a `'listo_despacho'`, sobre la bobina (`raw_material_id`) y el core (`core_id`) exactos del pedido.
6. **Compras y Proveedores:**
   - Las compras de bobinas/cores deben entrar por **factura de compra** (no editar stock a mano): así quedan proveedor, costo real, Kardex y cuenta por pagar enlazados.
   - Las facturas **no se borran**: se anulan con motivo. Un proveedor con facturas no se elimina: se desactiva.
   - Toda la lógica de stock/costo/saldo vive en la base (RPC + triggers); el frontend solo valida y muestra.
7. **Cores: compra en kg, consumo en unidades:**
   - Compras e inventario del material se digitan en **kg** (`core_materials`). Nunca sumar unidades de core directamente: las unidades solo entran por **armado** (`register_core_assembly`).
   - Costo de un core = `weight_grams/1000 × cost_per_kg` del material + `labor_cost_per_unit`.
   - El pedido descuenta 1 core armado por rollo al pasar a `'listo_despacho'`.

---

## 5. ✅ Estado de Avance Implementado

### A. Módulo de Pedidos (`components/admin/orders-panel.tsx`)
- [x] Modal con stretch opcional (1 sola medida) + **productos de bodega** de cualquier inventario (`OrderProductsEditor`), total del pedido y creación atómica vía RPC `create_order`.
- [x] Pedidos solo de productos quedan "Listo Despacho" al crearse; la tabla muestra rollos + productos + total.
- [x] Interruptor **Con IVA / Sin IVA** (19%), plazo de pago editable (prellenado del cliente), desglose subtotal/IVA/total y aviso de cupo excedido; la tabla muestra saldo y vencimiento.

### G. Gastos Fijos (`components/admin/expenses/`)
- [x] Plantillas de gasto fijo por categoría (PUC) con frecuencia, día de pago, vigencia, valor variable y créditos (cuotas + capital/intereses).
- [x] Vista del mes autogenerada: KPIs (gasto, pagado, por pagar/vencido, ventas del mes y % gasto/ventas), lista por categoría con pagar / deshacer / editar / anular, distribución por categoría y grupo, export CSV.
- [x] Gastos ocasionales (pendientes o ya pagados).
- [x] Resumen anual categoría × mes (solo intereses como gasto; capital aparte) con export CSV.

### H. Caja, Bancos y Conciliación (`components/admin/treasury/`)
- [x] Cuentas (caja general, bancos, caja menor con fondo fijo) con saldo automático; movimientos con filtros, soportes (foto/PDF) y export CSV.
- [x] Selección de cuenta en cobros a clientes, pagos a proveedores (web y app) y pago de gastos (sugiere según el medio).
- [x] Caja menor: gasto con soporte y categoría, reembolso por transferencia, % del fondo.
- [x] Cierre diario con conteo por billetes/monedas y ajuste por diferencia; conciliación bancaria con partidas en tránsito, gastos bancarios/4x1000 y deshacer.

### I. Indicadores y Estado de Resultados (`components/admin/finance/`)
- [x] Panel de indicadores: liquidez (cobertura, capital de trabajo, razón corriente, prueba ácida), rentabilidad (márgenes, punto de equilibrio), ciclo de caja (DSO/DPO/DIO), ventas, inventario, producción.
- [x] Alertas tempranas por proceso con severidad (crítico/atención/aviso) e ícono.
- [x] Estado de resultados con filtros (periodo, base despacho/pedido, cliente, comparativo, % renta), detalle por categoría PUC, márgenes, ventas por cliente, Excel e impresión.

### F. Cuentas por Cobrar (`components/admin/receivables/`)
- [x] KPIs: por cobrar, vencido, vence en 7 días, cobrado en el mes.
- [x] Antigüedad de cartera, saldo por cliente, filtros (por cobrar / vencidas / por vencer / pagadas), búsqueda y export CSV.
- [x] Registro de pagos y abonos con retención (botón ReteFuente 2,5%), historial y eliminación (admin).
- [x] Validación en tiempo real del stock de cores con badge de advertencia.
- [x] Selector de **bobina madre en bodega** (solo con stock > 0) en lugar de tipo de stretch fijo; el core se filtra por el ancho de la bobina. Sin campo de micras.
- [x] Validación de **kilos de película** con `computeRoll()`: `((weight_grams - core.weight_grams) / 1000) * quantity <= bobina.current_stock_kg`, con desglose core + película visible en el formulario. Bloquea también si el peso del rollo no supera el peso del core.
- [x] **Eliminación de pedidos** (botón papelera por fila, con confirmación). `order_items` y `production_logs` caen en cascada; el Kardex queda con `order_id = NULL`.
- [x] Si falla el insert de `order_items`, se borra la orden recién creada (sin pedidos huérfanos).
- [x] Sincronización Realtime con Supabase (`orders`, `core_specifications`, `raw_materials`).
- [x] Filtros por estado (`en_cola`, `en_embobinado`, `listo_despacho`, `enviado`, etc.).

### B. Módulo de Inventarios & Kardex (`components/admin/inventory-panel.tsx`)
- [x] **KPIs Globales:** Kilos totales en bodega, valorización económica en COP, tubos de cartón disponibles y alertas de mínimos.
- [x] **Bobinas Madre:** Creación con calibre (micras) obligatorio, registro de compra (+Kg), vaciado rápido a 0 kg y eliminación (el historial del Kardex se conserva).
- [x] **Material de cores (kg):** alta/edición (costo/kg, alerta), ajuste por conteo físico (RPC) y vista de cuántos cores de cada medida alcanzan.
- [x] **Cores armados por medida:** material asignado, peso promedio (g), mano de obra por core, costo promedio automático; **Registrar Armado** con desglose material + mano de obra y bloqueo si no alcanza el material.
- [x] **Otros inventarios** (`components/admin/inventory/general-inventory.tsx`): chips por categoría con conteo y alerta, búsqueda, inactivos, valor y margen; nuevo producto con inventario inicial; salida (venta/consumo/merma), ajuste por conteo, edición y gestor de categorías.
- [x] **Kardex:** Historial con filtros, búsqueda y eliminación de registros individuales (no altera el stock actual).

### C. Módulo de Categorías (`app/api/categories/` y `app/(admin)/admin/page.tsx`)
- [x] Categorías 100% en Supabase (`public.categories`); las rutas ya **no** importan Firebase.
- [x] Sin siembra automática (hacía reaparecer categorías borradas). Si la tabla está vacía, el modal ofrece "Cargar categorías predeterminadas" (`POST /api/categories { seed: true }`).
- [x] El modal "Gestionar Categorías" se renderiza fuera de las pestañas: funciona desde cualquier pestaña.
- [x] Las rutas devuelven errores reales y 403 cuando RLS no afecta filas (sin falsos "éxito").

### E. Proveedores & Cuentas por Pagar (`components/admin/suppliers/`)
- [x] Directorio con NIT + DV calculado (algoritmo DIAN), categoría, plazo de pago y datos bancarios; activar/desactivar.
- [x] Facturas de compra multi-línea con IVA 19% sugerido, ReteFuente 2,5% rápida, CUFE y vencimiento automático.
- [x] Ingreso automático a inventario + Kardex + costo promedio ponderado al registrar la factura.
- [x] Pagos parciales/totales con estado automático; anulación con reverso de stock.
- [x] Resumen CxP: total por pagar, vencido, vence en 7 días, compras del mes, antigüedad de saldos y próximos pagos.
- [x] Ficha del proveedor con historial y variación de precios; exportación CSV (Excel) de facturas filtradas.
- [ ] Pendiente sugerido: adjuntar PDF/XML de la factura (Supabase Storage) y alertas de vencimiento por email.

### D. App Móvil de Operarios (`app-operarios/`)
- [x] Autenticación contra Supabase Auth.
- [x] Pantalla de pedidos priorizados para planta.
- [x] Modal de cambio de estado en un clic.
- [x] Modal para registrar **cores armados** vía RPC `register_core_assembly` (muestra kg a descontar y bloquea si no alcanza).
- [x] Avisos no bloqueantes (`src/components/Notice.tsx`) en lugar de `Alert.alert`.
- [x] El detalle del pedido muestra los productos de bodega a "Incluir en el despacho".
- [x] Expo SDK 58. Interfaz con íconos Ionicons (sin emojis), cabecera con secciones-contador y botón flotante "Armar cores".
- [x] **Admin en la app** (barra inferior): pedido rápido (cliente, stretch, insumos, entrega, IVA, plazo) y Proveedores/CxP (KPIs, facturas abiertas/vencidas, registrar pago, nueva factura con bobina / material cores / insumo / otro, IVA y ReteFuente). Reutilizan las mismas RPC que la web.

---

## 6. 📒 Hoja de Ruta Contable (largo plazo)

El objetivo es llevar **toda la contabilidad** de la empresa en el sistema. Toda nueva captura de datos debe respetar:

1. **Documento fuente → asiento:** cada hecho económico nace de un documento (pedido, factura de compra, pago, gasto, ajuste) con fecha, valor, tercero y soporte (`reference`). Los asientos contables (`journal_entries` / `journal_lines`, partida doble) se **generarán** desde estos documentos; nunca digitar contabilidad aparte.
2. **Cuenta PUC en la clasificación:** toda categoría que mueva resultados lleva `puc_code` (ya: `expense_categories`). Pendiente: mapear ventas (4135), costo de ventas (6135), inventarios (1405/1435), CxC (1305), CxP (2205), IVA (2408), retenciones (1355/2365), obligaciones financieras (2105).
3. **Separar gasto de abono a capital, IVA y retenciones:** nunca mezclar en un solo valor (ver `principal_amount`, `tax_amount`, `withholding_amount`).
4. **Terceros con NIT:** clientes (`nit_rut`) y proveedores (`nit` + DV). Pendiente: unificar en una tabla de terceros y exigir NIT para documentos contables; beneficiarios de gastos hoy son texto libre o `supplier_id`.
5. **No borrar documentos con efecto contable:** anular con motivo (facturas, gastos recurrentes); los pagos con historial bloquean borrados (`ON DELETE RESTRICT`).
6. **Tesorería implementada:** todo pago debe llevar `account_id` (de dónde salió / a dónde entró). Pendientes sugeridos: centros de costo (planta / ventas / administración); empleados y nómina detallada (salario, seguridad social, prestaciones, provisiones); cierre de periodo (bloquear edición de meses cerrados); IVA y ReteFuente por periodo para declaraciones.

## 7. ⚠️ Gotchas Conocidos

- **RLS y borrados silenciosos:** un `DELETE`/`UPDATE` bloqueado por RLS **no devuelve error**, solo afecta 0 filas. Siempre encadenar `.select('id')` y comprobar `data.length > 0`.
- **Políticas de borrado:** solo `admin` puede borrar en `raw_materials`, `core_specifications`, `inventory_transactions` y `categories`; `admin` y `vendedor` en `orders`. Ver `supabase/migrations/`.
- **Firebase:** `lib/firebase-admin.ts` ya no tumba las rutas si las credenciales fallan; en ese caso `isFirebaseConfigured = false` y el catálogo web (`/api/products`) devuelve lista vacía. Si el catálogo aparece vacío, revisar `FIREBASE_PRIVATE_KEY` en `.env` (debe ir entre comillas con `\n` escapados).
- **Modales en React Native:** un `<Modal>` tapa el banner global de `NoticeProvider`; dentro de modales usar `<InlineNotice />`.


## 8. 🎨 Convenciones de Diseño y Código

- **Paleta de Colores Corporativa:**
  - Verde Principal (Acciones primarias / Éxito): `#3F8346` (hover: `#2d6332`)
  - Oscuro Principal (Cabeceras / Botones oscuros): `#2E4040`
  - Gris Borde / Separador: `#C8CDC9`
  - Gris Texto Secundario: `#949E97`
  - Fondo Blanco Limpio: `#FDFDFD` o `#FFFFFF`
- **Inputs estándar:** `w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none`
- **Labels estándar:** `block text-[10px] font-semibold text-[#949E97] mb-1`
- **Nunca usar `alert()` / `confirm()` / `Alert.alert`:** en web usar `toast` (sonner) para avisos y `useConfirm()` de `components/admin/confirm-dialog.tsx` para confirmaciones; en móvil `useNotice()` (`notify` / `confirm`) e `<InlineNotice />`.
- **Validación de Código:** Siempre ejecutar `pnpm tsc --noEmit` antes de finalizar cambios para asegurar 0 errores de tipos TypeScript.

---

## 9. 🛠️ Comandos de Desarrollo

```bash
# Iniciar servidor web Next.js
pnpm dev

# Comprobar tipos TypeScript (debe salir limpio)
pnpm tsc --noEmit

# Iniciar app móvil Expo (desde app-operarios)
cd app-operarios
npx expo start
```
