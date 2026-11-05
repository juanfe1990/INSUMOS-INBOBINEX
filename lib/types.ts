export type Product = {
    id: string;
    name: string;
    description: string;
    categoryId: string;
    slug: string; // Para URLs amigables
    categoryName?: string; // Lo guardamos en Firebase para lectura rápida
    imageUrl: string; // URL de la imagen principal (portada)
    gallery: string[]; // Array con todas las URLs de las imágenes
    order: number; // Posición para ordenar los productos
    createdAt?: string; // Fecha de creación (ISO string)
    updatedAt?: string; // Fecha de última modificación (ISO string)

    // Opcional: mantenemos 'category' por compatibilidad si tienes
    // productos antiguos creados antes de este cambio
    category?: string;
};

export type Category = {
    id: string;
    name: string;
    slug: string;
    description?: string;
    createdAt?: string;
    updatedAt?: string;
};

export const CATEGORIES = [
    { name: 'Papel Burbuja', slug: 'papel-burbuja' },
    { name: 'Cintas Adhesivas', slug: 'cintas-adhesivas' },
    { name: 'Stretch / Vinipel', slug: 'stretch-vinipel' },
    { name: 'Cajas y Carton', slug: 'cajas-carton' },
    { name: 'Bolsas', slug: 'bolsas' },
    { name: 'Espumas y Proteccion', slug: 'espumas-proteccion' },
    { name: 'Zuncho y Grapas', slug: 'zuncho-grapas' },
    { name: 'Otros Insumos', slug: 'otros-insumos' },
] as const;

export interface PostData {
    id: string;
    title: string;
    date: string;
    description: string;
    image?: string;
    contentHtml?: string;
}

export type UserRole = 'admin' | 'vendedor' | 'operario';
export type OrderPriority = 'baja' | 'normal' | 'alta' | 'urgente';
export type OrderStatus =
    | 'pendiente'
    | 'en_cola'
    | 'en_embobinado'
    | 'listo_despacho'
    | 'enviado'
    | 'entregado'
    | 'cancelado';
export type FilmType = 'manual' | 'maquina' | 'preestirado' | 'color_negro' | 'color_azul' | 'otro';

export type Client = {
    id: string;
    business_name: string;
    nit_rut?: string | null;
    contact_name: string;
    phone: string;
    email?: string | null;
    delivery_address: string;
    city: string;
    notes?: string | null;
    /** Plazo de pago pactado en días (0 = contado) */
    payment_terms_days: number;
    /** Cupo de crédito en COP (null = sin límite) */
    credit_limit: number | null;
    /** Cada cuántos días suele pedir (alerta de recompra); null = sin frecuencia */
    reorder_days?: number | null;
    created_by?: string | null;
    created_at: string;
    updated_at: string;
};

export type OrderItem = {
    id: string;
    order_id: string;
    product_id: string;
    quantity: number;
    completed_quantity: number;
    /** Medida del rollo fabricado (= largo del core); puede ser un corte de la bobina */
    custom_length_cm?: number | null;
    custom_caliber_microns?: number | null;
    /** Ancho de la bobina madre de la que se corta */
    bobina_width_cm?: number | null;
    /** Rollos que salen por pasada de la bobina */
    rolls_per_pass?: number | null;
    weight_grams?: number | null;
    /** Bobina madre exacta usada para el pedido */
    raw_material_id?: string | null;
    /** Core exacto usado para el pedido */
    core_id?: string | null;
    /** Snapshot del peso del core al crear el pedido (g) */
    core_weight_grams?: number;
    /** Película por rollo (g) = weight_grams - core_weight_grams (columna generada) */
    film_weight_grams?: number | null;
    unit_price: number;
    subtotal: number;
    notes?: string | null;
    created_at: string;
    product?: Product;
};

/** Tipo de producto que sale de bodega tal cual en un pedido */
export type OrderProductKind = 'insumo' | 'bobina' | 'core' | 'material_core';

/** Línea de producto de inventario dentro de un pedido (además del stretch fabricado) */
export type OrderProduct = {
    id: string;
    order_id: string;
    kind: OrderProductKind;
    inventory_item_id: string | null;
    raw_material_id: string | null;
    core_id: string | null;
    core_material_id: string | null;
    description: string;
    unit: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    created_at: string;
};

/** Estado de cartera (cuentas por cobrar) del pedido */
export type ReceivableStatus = 'pendiente' | 'parcial' | 'pagado';

/** Pago / abono de un cliente a un pedido */
export type CustomerPayment = {
    id: string;
    order_id: string;
    payment_date: string;
    amount: number;
    /** Retención practicada por el cliente (cuenta como abonado) */
    withholding_amount: number;
    method: PaymentMethod;
    reference: string | null;
    notes: string | null;
    /** Cuenta de tesorería donde entró el dinero */
    account_id: string | null;
    created_by: string;
    created_at: string;
};

export type Order = {
    id: string;
    order_number: number;
    client_id: string;
    created_by: string;
    assigned_operator_id?: string | null;
    status: OrderStatus;
    priority: OrderPriority;
    delivery_date: string;
    delivery_address: string;
    notes?: string | null;
    /** Valor antes de IVA */
    subtotal: number;
    apply_vat: boolean;
    vat_rate: number;
    tax_amount: number;
    /** subtotal + IVA */
    total_amount: number;
    payment_terms_days: number;
    /** Vencimiento: entrega + plazo; al despachar se recalcula desde la fecha real */
    due_date: string | null;
    paid_amount: number;
    payment_status: ReceivableStatus;
    payments?: CustomerPayment[];
    started_at?: string | null;
    completed_at?: string | null;
    shipped_at?: string | null;
    created_at: string;
    updated_at: string;
    client?: Client;
    /** Stretch fabricado: 0 o 1 registro (medida única) */
    items?: OrderItem[];
    /** Productos de inventario que salen de bodega */
    products?: OrderProduct[];
    operator?: {
        id: string;
        full_name: string;
        email: string;
    };
};

export type ProductionLog = {
    id: string;
    order_id: string;
    operator_id: string;
    previous_status: OrderStatus;
    new_status: OrderStatus;
    quantity_processed: number;
    waste_kg: number;
    notes?: string | null;
    created_at: string;
};

// --- MÓDULO DE INVENTARIO Y COSTOS ---
export type InventoryMovementType =
    | 'entrada_compra'
    | 'produccion_core'
    | 'consumo_pedido'
    | 'merma_desperdicio'
    | 'ajuste_manual'
    | 'anulacion_compra'
    | 'consumo_armado_core'
    | 'salida_venta'
    | 'consumo_interno';

/** Categoría del inventario general (Cintas, Cartón industrial, ...) */
export type InventoryCategory = {
    id: string;
    name: string;
    display_order: number;
    created_at: string;
};

/** Producto del inventario general con su propia unidad de medida */
export type InventoryItem = {
    id: string;
    category_id: string | null;
    name: string;
    sku: string | null;
    /** und, rollo, caja, paquete, lámina, kg, metro... */
    unit: string;
    current_stock: number;
    /** Costo promedio ponderado por unidad */
    avg_cost: number;
    sale_price: number | null;
    min_stock_alert: number;
    is_active: boolean;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

export type RawMaterial = {
    id: string;
    name: string;
    material_type: string;
    color: string;
    width_cm: number;
    caliber_microns: number;
    current_stock_kg: number;
    cost_per_kg: number;
    min_stock_alert_kg: number;
    created_at: string;
    updated_at: string;
};

/** Material de cores (cartón) comprado por kg al proveedor, antes de armar medidas */
export type CoreMaterial = {
    id: string;
    name: string;
    current_stock_kg: number;
    /** Costo promedio ponderado por kg */
    cost_per_kg: number;
    min_stock_alert_kg: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

/** Línea del pedido habitual de un cliente (client_order_templates) */
export type ClientOrderTemplate = {
    id: string;
    client_id: string;
    position: number;
    kind: 'stretch' | 'insumo' | 'bobina' | 'core' | 'material_core';
    raw_material_id: string | null;
    core_id: string | null;
    inventory_item_id: string | null;
    core_material_id: string | null;
    /** Solo stretch: peso total por rollo (g) */
    weight_grams: number | null;
    quantity: number;
    unit_price: number;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

/** Desperdicio / merma: documento fuente (RPC register_waste / annul_waste) */
export type WasteKind = 'bobina' | 'core' | 'material_core' | 'insumo';
export type WasteReason =
    | 'refile'
    | 'arranque'
    | 'rollo_defectuoso'
    | 'rotura'
    | 'core_danado'
    | 'dano_bodega'
    | 'obsoleto'
    | 'otro';
export type WasteRecord = {
    id: string;
    waste_date: string;
    kind: WasteKind;
    raw_material_id: string | null;
    core_id: string | null;
    core_material_id: string | null;
    inventory_item_id: string | null;
    /** Snapshot del nombre del producto */
    item_name: string;
    unit: string;
    quantity: number;
    unit_cost: number;
    total_cost: number;
    reason: WasteReason;
    /** Pedido de producción al que se asocia (opcional) */
    order_id: string | null;
    notes: string | null;
    status: 'activo' | 'anulado';
    annulled_at: string | null;
    annulled_by: string | null;
    annul_reason: string | null;
    created_by: string;
    created_at: string;
    order?: { order_number: number; client?: { business_name: string } | null } | null;
    creator?: { full_name: string } | null;
};

/** Corte permitido de una bobina madre (60 cm → rollos de 15 cm, 4 por pasada) */
export type FilmCutWidth = {
    id: string;
    bobina_width_cm: number;
    roll_width_cm: number;
    /** Columna generada: floor(bobina / rollo) */
    rolls_per_pass: number;
    created_at: string;
};

export type CoreSpecification = {
    id: string;
    name: string;
    length_cm: number;
    /** Peso promedio del core armado (g): convierte kg de material <-> unidades */
    weight_grams: number;
    /** Costo promedio por core armado (material + mano de obra), lo recalcula cada armado */
    standard_cost: number;
    current_stock_units: number;
    min_stock_alert_units: number;
    /** Material del que se arma esta medida */
    core_material_id: string | null;
    /** Mano de obra por core armado (COP) */
    labor_cost_per_unit: number;
    created_at: string;
    updated_at: string;
};

export type InventoryTransaction = {
    id: string;
    movement_type: InventoryMovementType;
    raw_material_id?: string | null;
    core_id?: string | null;
    core_material_id?: string | null;
    inventory_item_id?: string | null;
    quantity: number;
    unit_cost: number;
    total_cost: number;
    /** Registro de desperdicio que originó el movimiento */
    waste_record_id?: string | null;
    order_id?: string | null;
    notes?: string | null;
    created_by: string;
    created_at: string;
    raw_material?: RawMaterial | null;
    core?: CoreSpecification | null;
    core_material?: CoreMaterial | null;
    inventory_item?: InventoryItem | null;
    order?: Order | null;
    creator?: {
        id: string;
        full_name: string;
        email: string;
    } | null;
};

// --- MÓDULO DE PROVEEDORES Y CUENTAS POR PAGAR ---
export type SupplierCategory =
    | 'materia_prima'
    | 'cores_tubos'
    | 'cintas'
    | 'insumos'
    | 'servicios'
    | 'transporte'
    | 'otro';
export type PurchaseInvoiceStatus = 'pendiente' | 'parcial' | 'pagada' | 'anulada';
export type PaymentMethod = 'transferencia' | 'efectivo' | 'cheque' | 'tarjeta' | 'otro';
export type PurchaseItemType = 'bobina' | 'core' | 'insumo' | 'otro';

export type Supplier = {
    id: string;
    business_name: string;
    nit: string | null;
    verification_digit: number | null;
    category: SupplierCategory;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string;
    payment_terms_days: number;
    bank_name: string | null;
    bank_account_type: 'ahorros' | 'corriente' | null;
    bank_account_number: string | null;
    is_active: boolean;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type PurchaseInvoiceItem = {
    id: string;
    invoice_id: string;
    item_type: PurchaseItemType;
    raw_material_id: string | null;
    /** Solo en facturas antiguas (cores comprados por unidad) */
    core_id: string | null;
    /** Material de cores comprado por kg */
    core_material_id: string | null;
    /** Producto del inventario general (línea 'insumo') */
    inventory_item_id: string | null;
    description: string;
    quantity: number;
    unit: string;
    unit_cost: number;
    subtotal: number;
    created_at: string;
};

export type SupplierPayment = {
    id: string;
    invoice_id: string;
    payment_date: string;
    amount: number;
    method: PaymentMethod;
    reference: string | null;
    notes: string | null;
    /** Cuenta de tesorería de la que salió el pago */
    account_id: string | null;
    created_by: string;
    created_at: string;
};

export type PurchaseInvoice = {
    id: string;
    supplier_id: string;
    invoice_number: string;
    cufe: string | null;
    issue_date: string;
    due_date: string;
    subtotal: number;
    tax_amount: number;
    withholding_amount: number;
    total: number;
    paid_amount: number;
    status: PurchaseInvoiceStatus;
    annulled_reason: string | null;
    notes: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
    supplier?: Supplier;
    items?: PurchaseInvoiceItem[];
    payments?: SupplierPayment[];
};

// --- GASTOS FIJOS Y RECURRENTES ---
export type ExpenseGroup = 'operacional' | 'no_operacional' | 'financiero';
export type ExpenseFrequency = 'quincenal' | 'mensual' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'unico';
export type ExpenseStatus = 'pendiente' | 'pagado' | 'anulado';

export type ExpenseCategory = {
    id: string;
    name: string;
    expense_group: ExpenseGroup;
    /** Cuenta del PUC colombiano (para la causación contable) */
    puc_code: string | null;
    description: string | null;
    color: string;
    display_order: number;
    is_active: boolean;
    created_at: string;
};

/** Plantilla de gasto fijo: se configura una vez y genera los gastos de cada periodo */
export type RecurringExpense = {
    id: string;
    category_id: string;
    name: string;
    payee_name: string | null;
    supplier_id: string | null;
    /** Valor (estimado si is_variable) */
    amount: number;
    is_variable: boolean;
    frequency: ExpenseFrequency;
    due_day: number;
    start_date: string;
    end_date: string | null;
    /** Créditos: número total de cuotas */
    installments_total: number | null;
    /** Créditos: abono a capital por cuota (no es gasto) */
    principal_amount: number;
    is_active: boolean;
    notes: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

/** Ocurrencia de un gasto (generada desde una plantilla u ocasional) */
export type Expense = {
    id: string;
    recurring_id: string | null;
    category_id: string;
    description: string;
    payee_name: string | null;
    supplier_id: string | null;
    /** Primer día del mes al que corresponde */
    period_month: string;
    due_date: string;
    /** Total a pagar */
    amount: number;
    /** Créditos: abono a capital (no es gasto) */
    principal_amount: number;
    installment_number: number | null;
    status: ExpenseStatus;
    paid_date: string | null;
    payment_method: PaymentMethod | null;
    reference: string | null;
    notes: string | null;
    /** Cuenta de tesorería de la que salió el pago */
    account_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

// --- TESORERÍA ---
export type TreasuryAccountType = 'caja_general' | 'banco' | 'caja_menor';
export type TreasuryDirection = 'ingreso' | 'egreso';
export type TreasuryMovementType =
    | 'saldo_inicial'
    | 'cobro_cliente'
    | 'pago_proveedor'
    | 'pago_gasto'
    | 'transferencia_entrada'
    | 'transferencia_salida'
    | 'otro_ingreso'
    | 'otro_egreso'
    | 'ajuste';

export type TreasuryAccount = {
    id: string;
    name: string;
    account_type: TreasuryAccountType;
    puc_code: string | null;
    bank_name: string | null;
    account_number: string | null;
    bank_account_type: 'ahorros' | 'corriente' | null;
    opening_balance: number;
    opening_date: string;
    /** Saldo actual (lo mantiene la base de datos) */
    current_balance: number;
    /** Caja menor: monto del fondo fijo */
    petty_cash_fund: number | null;
    color: string;
    is_active: boolean;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

export type TreasuryMovement = {
    id: string;
    account_id: string;
    movement_date: string;
    direction: TreasuryDirection;
    movement_type: TreasuryMovementType;
    amount: number;
    description: string;
    third_party: string | null;
    reference: string | null;
    /** Ruta del soporte en Storage (bucket "soportes") */
    support_path: string | null;
    customer_payment_id: string | null;
    supplier_payment_id: string | null;
    expense_id: string | null;
    transfer_group: string | null;
    reconciled: boolean;
    reconciliation_id: string | null;
    created_by: string | null;
    created_at: string;
};

export type DailyClosing = {
    id: string;
    account_id: string;
    closing_date: string;
    system_balance: number;
    counted_balance: number;
    difference: number;
    adjustment_movement_id: string | null;
    notes: string | null;
    created_by: string | null;
    created_at: string;
};

export type BankReconciliation = {
    id: string;
    account_id: string;
    statement_date: string;
    statement_balance: number;
    book_balance: number;
    movements_count: number;
    support_path: string | null;
    notes: string | null;
    created_by: string | null;
    created_at: string;
};
