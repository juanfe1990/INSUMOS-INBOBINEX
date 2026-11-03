# Inbobinex — Contexto del Proyecto para Claude Code

## Descripcion del Proyecto

Sistema de gestion de produccion y pedidos para Inbobinex, empresa fabricante de bobinas de vinipel/stretch en Medellin, Colombia.

Consta de dos aplicaciones:
1. Panel Web Admin (Next.js 14 + Supabase): Para administradores y vendedores.
2. App Movil Operarios (React Native + Expo): Para operarios de planta.

---

## Estructura del Proyecto

Raiz: c:\Users\jubla\Desktop\Inbobinex\

  app/
    (admin)/admin/page.tsx            -> Panel admin con tabs (Pedidos, Clientes, Inventario)
    (tienda)/                         -> Tienda publica

  components/admin/
    orders-panel.tsx                  -> Gestion de pedidos (archivo principal activo)
    inventory-panel.tsx               -> Inventario & Kardex
    clients-panel.tsx                 -> Gestion de clientes

  lib/
    types.ts                          -> Tipos principales (RawMaterial, CoreSpecification, Order, etc.)
    types/database.types.ts           -> Tipos generados de Supabase
    supabase/                         -> Cliente Supabase (client.ts y server.ts)
    auth-context.tsx                  -> Contexto de autenticacion

  app-operarios/                      -> App Expo/React Native (subdirectorio separado)
    src/screens/
      LoginScreen.tsx
      OrdersScreen.tsx                -> Lista de pedidos para operarios
      OrderDetailModal.tsx            -> Detalle + cambio de estado
      RegisterCoresModal.tsx          -> Registro de cores cortados
    types/index.ts                    -> Tipos del app movil

---

## Supabase

URL: https://jfyqafrsnjqlwjxuezjp.supabase.co
Anon Key (publica): sb_publishable_eLt8Hvw50SMKvyP73Js-YA_JTrpSJn9
Claves privadas: en .env (no commitear)

### Tablas Principales

- profiles: Usuarios (roles: admin, vendedor, operario)
- clients: Clientes registrados
- orders: Cabecera de pedidos
- order_items: Detalle de pedidos (1 item por orden — REGLA IMPORTANTE)
- products: Productos base (bobina vinipel)
- raw_materials: Bobinas madre en kg (materia prima) — actualmente VACIA, admin la llena desde UI
- core_specifications: Cores/tubos por medida (cm) + stock de unidades
- inventory_transactions: Kardex de todos los movimientos de inventario

### Tipos de movimiento (inventory_transactions.movement_type)
- entrada_compra: Compra de materia prima
- produccion_core: Corte de cores por operarios
- consumo_pedido: Consumo al crear pedido
- merma_desperdicio: Merma/scrap
- ajuste_manual: Ajuste manual

### Tipo RawMaterial (lib/types.ts)
interface RawMaterial {
  id: string;
  name: string;
  material_type: string;  // 'stretch'
  color: string;          // 'transparente', 'negro', etc.
  width_cm: number;       // CLAVE: coincide con CoreSpecification.length_cm
  current_stock_kg: number;
  cost_per_kg: number;
  min_stock_alert_kg: number;
  created_at: string;
  updated_at: string;
}

### Tipo CoreSpecification (lib/types.ts)
interface CoreSpecification {
  id: string;
  name: string;
  length_cm: number;       // CLAVE: coincide con RawMaterial.width_cm
  standard_cost: number;
  current_stock_units: number;
  min_stock_alert_units: number;
  created_at: string;
  updated_at: string;
}

---

## Estado Actual Implementado

### orders-panel.tsx (components/admin/)
COMPLETADO:
- Modal "Nueva Solicitud de Pedido" con UNA SOLA medida (el boton "+ Agregar otra medida" fue eliminado)
- Campo "Tipo de Stretch" -> select con opciones: Transparente, Negro, Azul
- Campo "Ancho / Medida (cm)" -> select dinamico desde core_specifications en BD
- Validacion de stock de CORES: bloquea pedido si cantidad > core.current_stock_units
- Badge de stock de cores en tiempo real en el header del formulario
- Alerta visual roja si no hay suficientes cores
- Suscripcion Realtime a 'orders' y 'core_specifications'
- Cambio de estados: En Cola -> En Embobinado -> Listo Despacho -> Enviado
- Filtros de lista por estado

### inventory-panel.tsx (components/admin/)
COMPLETADO:
- KPIs: stock kg total, valor total, cores totales, alertas de minimos
- Sub-tabs: Bobinas Madre | Cores/Tubos | Kardex
- Registrar compra de materia prima (kg) con kardex automatico
- Registrar corte de cores (unidades) con kardex automatico
- Kardex con busqueda y filtros por tipo de movimiento
- Realtime sync

### App Movil (app-operarios)
COMPLETADO:
- Login con Supabase Auth
- Lista de pedidos con filtros por estado
- Modal de detalle con cambio de estado
- RegisterCoresModal: registro de cores cortados (conectado al inventario)

---

## TAREA PENDIENTE INMEDIATA

### Agregar validacion de stock en KILOS de bobinas madre al crear pedido

El usuario pidio que ademas de validar cores, se valide si hay suficiente MATERIAL EN KG para el pedido.

ARCHIVO A MODIFICAR: components/admin/orders-panel.tsx

LOGICA REQUERIDA:
1. Al seleccionar una medida (item.custom_length_cm de core_specifications), buscar en raw_materials
   el registro donde raw_material.width_cm == item.custom_length_cm (mismo numero)
2. Calcular kg requeridos:
   kg_requeridos = (item.weight_grams / 1000) * item.quantity
3. Si kg_requeridos > raw_material.current_stock_kg -> advertencia + bloquear boton de submit
4. Mensaje de error claro: "Se requieren X.X kg pero solo hay Y.Y kg de material en bodega"

CAMBIOS EN orders-panel.tsx:
1. Agregar import de RawMaterial en las importaciones del top:
   import type { ..., RawMaterial } from '@/lib/types';

2. Agregar estado despues de 'cores' (linea ~81):
   const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);

3. En fetchData() (linea ~104), agregar query a raw_materials junto con los otros:
   supabase.from('raw_materials').select('*').order('width_cm', { ascending: true }),
   Y guardarlo: if (rawRes.data) setRawMaterials(rawRes.data as RawMaterial[]);

4. Agregar suscripcion realtime a raw_materials en el useEffect (linea ~148).

5. En la zona de calculos derivados (linea ~312, junto a selectedCoreForForm):
   const selectedRawForForm = rawMaterials.find(r => r.width_cm === toNumber(item.custom_length_cm));
   const kgRequired = (toNumber(item.weight_grams) / 1000) * toNumber(item.quantity);
   const isRawStockSufficient = selectedRawForForm ? kgRequired <= selectedRawForForm.current_stock_kg : true;
   // Actualizar isStockSufficient para incluir ambas validaciones:
   const isStockSufficient = (selectedCoreForForm ? toNumber(item.quantity) <= selectedCoreForForm.current_stock_units : true) && isRawStockSufficient;

6. En handleCreateOrder (~linea 196), agregar validacion similar a la de cores antes del try:
   if (selectedRawForForm && kgRequired > selectedRawForForm.current_stock_kg) {
     toast.error(`No hay suficiente material: se requieren ${kgRequired.toFixed(1)} kg y solo hay ${selectedRawForForm.current_stock_kg} kg disponibles`);
     return;
   }

7. En el bloque de alertas del modal (~linea 739, despues de la alerta de cores), agregar:
   {selectedRawForForm && !isRawStockSufficient && (
     <div className="flex items-center gap-1.5 rounded-md bg-orange-50 p-2 text-[11px] font-semibold text-orange-700 border border-orange-200">
       <AlertCircle className="h-4 w-4 shrink-0 text-orange-600" />
       <span>
         Sin material suficiente: necesitas {kgRequired.toFixed(1)} kg de bobina madre
         pero solo hay {selectedRawForForm.current_stock_kg} kg en bodega.
       </span>
     </div>
   )}

NOTA: raw_materials puede estar vacia inicialmente. Si no hay registro de raw_material para ese ancho,
no bloquear (isRawStockSufficient = true cuando selectedRawForForm es null/undefined).

---

## Comandos de Desarrollo

# Panel web (Next.js) — desde la raiz del proyecto
pnpm dev

# App movil — desde /app-operarios
npx expo start

# Verificar tipos TypeScript (sin errores = codigo valido)
pnpm tsc --noEmit

---

## Convenciones de Codigo

Colores de marca:
- Verde principal: #3F8346
- Oscuro: #2E4040
- Gris claro: #C8CDC9
- Gris texto secundario: #949E97
- Fondo claro: #FDFDFD

Patrones UI del proyecto:
- Labels de campos del formulario: className="block text-[10px] font-semibold text-[#949E97] mb-1"
- Inputs: className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
- Botones de accion primaria: bg-[#3F8346] text-white hover:bg-[#2d6332]
- Botones secundarios: border border-[#C8CDC9] text-[#2E4040] hover:bg-[#C8CDC9]/20
- Alertas de error: bg-red-50 border-red-200 text-red-700
- Alertas de advertencia: bg-orange-50 border-orange-200 text-orange-700
- Alertas de exito: text-[#3F8346] (sin fondo)

Reglas de negocio importantes:
- SOLO 1 medida (order_item) por pedido — nunca permitir multiples items
- El ancho del core (length_cm) corresponde al ancho del material (width_cm)
- Los operarios solo ven pedidos en estados: en_cola, en_embobinado
- Solo admin puede ver "En Cola" en el panel web
- Precio siempre en COP (pesos colombianos)
