'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type {
    Order,
    OrderPriority,
    OrderStatus,
    Client,
    CoreSpecification,
    CoreMaterial,
    InventoryCategory,
    InventoryItem,
    RawMaterial,
} from '@/lib/types';
import OrderProductsEditor, {
    analyzeLines,
    type InventoryCatalog,
    type ProductLine,
} from '@/components/admin/orders/order-products-editor';
import { useConfirm } from '@/components/admin/confirm-dialog';
import {
    Clock,
    AlertCircle,
    Plus,
    Loader2,
    Calendar,
    CheckCircle2,
    Truck,
    RotateCw,
    X,
    Filter,
    Trash2,
    Weight,
    Factory,
    Package,
    Receipt,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string; icon: any }> = {
    pendiente: { label: 'Pendiente Oficina', bg: 'bg-gray-100', text: 'text-gray-700', icon: Clock },
    en_cola: { label: 'En Cola Planta', bg: 'bg-amber-100', text: 'text-amber-800', icon: Clock },
    en_embobinado: { label: 'En Embobinado', bg: 'bg-blue-100', text: 'text-blue-800', icon: RotateCw },
    listo_despacho: { label: 'Listo Despacho', bg: 'bg-purple-100', text: 'text-purple-800', icon: CheckCircle2 },
    enviado: { label: 'Enviado / Salida', bg: 'bg-green-100', text: 'text-green-800', icon: Truck },
    entregado: { label: 'Entregado', bg: 'bg-emerald-100', text: 'text-emerald-800', icon: CheckCircle2 },
    cancelado: { label: 'Cancelado', bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle },
};

const PRIORITY_CONFIG: Record<OrderPriority, { label: string; bg: string; text: string }> = {
    baja: { label: 'Baja', bg: 'bg-slate-100', text: 'text-slate-600' },
    normal: { label: 'Normal', bg: 'bg-blue-50', text: 'text-blue-700' },
    alta: { label: 'Alta', bg: 'bg-amber-100', text: 'text-amber-800' },
    urgente: { label: '¡Urgente!', bg: 'bg-red-100', text: 'text-red-700 font-bold animate-pulse' },
};

type NumericDraft = number | '';

type OrderItemDraft = {
    raw_material_id: string;
    core_id: string;
    quantity: NumericDraft;
    /** Peso total por rollo (g) = peso del core + película */
    weight_grams: NumericDraft;
    unit_price: NumericDraft;
};

function parseNumericDraft(raw: string): NumericDraft {
    if (raw.trim() === '') return '';
    const n = Number(raw);
    return Number.isFinite(n) ? n : '';
}

function toNumber(value: NumericDraft, fallback = 0): number {
    if (value === '') return fallback;
    return Number.isFinite(value) ? value : fallback;
}

function isPositiveNumber(value: NumericDraft, min = 0.01): boolean {
    return value !== '' && Number.isFinite(value) && value >= min;
}

/** IVA general en Colombia; los precios del pedido se digitan antes de IVA */
const VAT_RATE = 0.19;
const formatCOP = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');

const formatKg = (kg: number) => kg.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const formatG = (g: number) => g.toLocaleString('es-CO', { maximumFractionDigits: 1 });
const capitalize = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** Descripción corta de una bobina madre: "Transparente · 50 cm · 17 µ" */
function describeRaw(m: RawMaterial) {
    return `${capitalize(m.color || 'transparente')} · ${Number(m.width_cm)} cm · ${Number(m.caliber_microns)} µ`;
}

/**
 * Cálculo del rollo: el peso digitado es el TOTAL por rollo (core + película).
 * Película por rollo = peso total - peso del core. Kg a descontar = película * cantidad / 1000.
 */
function computeRoll(
    raw: RawMaterial | null,
    core: CoreSpecification | null,
    quantity: number,
    totalWeightGrams: number
) {
    const coreWeight = Number(core?.weight_grams || 0);
    const filmPerRoll = totalWeightGrams - coreWeight;
    const filmKgTotal = (Math.max(filmPerRoll, 0) * quantity) / 1000;
    const availableKg = Number(raw?.current_stock_kg || 0);
    const availableCores = Number(core?.current_stock_units || 0);
    return {
        coreWeight,
        filmPerRoll,
        filmKgTotal,
        availableKg,
        availableCores,
        weightOk: totalWeightGrams > coreWeight,
        kgOk: filmKgTotal <= availableKg,
        coresOk: quantity <= availableCores,
    };
}

export default function OrdersPanel() {
    const supabase = createClient();
    const [orders, setOrders] = useState<Order[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);

    // Formulario de Nueva Solicitud
    const [selectedClientId, setSelectedClientId] = useState('');
    const [deliveryDate, setDeliveryDate] = useState(
        new Date(Date.now() + 86400000).toISOString().split('T')[0]
    );
    const [priority, setPriority] = useState<OrderPriority>('normal');
    const [deliveryAddress, setDeliveryAddress] = useState('');
    const [notes, setNotes] = useState('');

    const [cores, setCores] = useState<CoreSpecification[]>([]);
    const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
    const [coreMaterials, setCoreMaterials] = useState<CoreMaterial[]>([]);
    const [invItems, setInvItems] = useState<InventoryItem[]>([]);
    const [invCategories, setInvCategories] = useState<InventoryCategory[]>([]);
    // Stretch fabricado (máximo 1 medida) y productos de bodega
    const [includeStretch, setIncludeStretch] = useState(true);
    const [productLines, setProductLines] = useState<ProductLine[]>([]);
    // Facturación: IVA opcional y plazo de pago (por defecto el pactado con el cliente)
    const [applyVat, setApplyVat] = useState(true);
    const [paymentTerms, setPaymentTerms] = useState('0');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDialog, confirm] = useConfirm();

    // Medida única del pedido a fabricar
    const [item, setItem] = useState<OrderItemDraft>({
        raw_material_id: '',
        core_id: '',
        quantity: 10,
        weight_grams: 1500,
        unit_price: 25000,
    });

    const updateItemField = (field: 'quantity' | 'weight_grams' | 'unit_price', raw: string) => {
        setItem((prev) => ({
            ...prev,
            [field]: parseNumericDraft(raw),
        }));
    };

    const coresForWidth = (widthCm: number) =>
        cores.filter((c) => Number(c.length_cm) === Number(widthCm));

    // Al elegir la bobina, el core se filtra por su ancho y se preselecciona el primero
    const handleRawChange = (rawId: string) => {
        const raw = rawMaterials.find((m) => m.id === rawId);
        const firstCore = raw ? coresForWidth(raw.width_cm)[0] : undefined;
        setItem((prev) => ({ ...prev, raw_material_id: rawId, core_id: firstCore?.id || '' }));
    };

    // Cargar datos iniciales
    const fetchData = async () => {
        try {
            setLoading(true);
            const [ordersRes, clientsRes, coresRes, rawRes, coreMatRes, itemsRes, catRes] = await Promise.all([
                supabase
                    .from('orders')
                    .select('*, client:clients(*), items:order_items(*), products:order_products(*)')
                    .order('priority', { ascending: false })
                    .order('delivery_date', { ascending: true }),
                supabase.from('clients').select('*').order('business_name'),
                supabase.from('core_specifications').select('*').order('length_cm', { ascending: true }),
                supabase.from('raw_materials').select('*').order('width_cm', { ascending: true }),
                supabase.from('core_materials').select('*'),
                supabase.from('inventory_items').select('*').order('name'),
                supabase.from('inventory_categories').select('*').order('display_order').order('name'),
            ]);

            if (rawRes.data) setRawMaterials(rawRes.data as RawMaterial[]);
            if (coreMatRes.data) setCoreMaterials(coreMatRes.data as CoreMaterial[]);
            if (itemsRes.data) setInvItems(itemsRes.data as InventoryItem[]);
            if (catRes.data) setInvCategories(catRes.data as InventoryCategory[]);

            if (ordersRes.data) {
                setOrders(ordersRes.data as unknown as Order[]);
            }
            if (clientsRes.data) {
                setClients(clientsRes.data as Client[]);
            }
            if (coresRes.data) {
                setCores(coresRes.data as CoreSpecification[]);
            }
        } catch (err: any) {
            toast.error('Error cargando pedidos: ' + (err.message || 'Error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();

        // Suscripción Realtime a la tabla orders y core_specifications
        const channel = supabase
            .channel('realtime-orders-admin')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'orders' },
                () => {
                    fetchData();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'core_specifications' },
                () => {
                    fetchData();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'raw_materials' },
                () => {
                    fetchData();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'inventory_items' },
                () => {
                    fetchData();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // Catálogo de inventario para las líneas de productos
    const catalog: InventoryCatalog = useMemo(
        () => ({ items: invItems, categories: invCategories, rawMaterials, cores, coreMaterials }),
        [invItems, invCategories, rawMaterials, cores, coreMaterials]
    );

    // Lo que el stretch ya consume de bobina/cores, para validar el stock combinado con los productos
    const stretchReserved = useMemo(() => {
        const r: Record<string, number> = {};
        if (!includeStretch) return r;
        const raw = rawMaterials.find((m) => m.id === item.raw_material_id);
        const core = cores.find((c) => c.id === item.core_id);
        const qty = toNumber(item.quantity);
        if (raw && core) {
            const film = (Math.max(toNumber(item.weight_grams) - Number(core.weight_grams || 0), 0) * qty) / 1000;
            r[`bobina:${raw.id}`] = film;
            r[`core:${core.id}`] = qty;
        }
        return r;
    }, [includeStretch, item, rawMaterials, cores]);

    const productAnalysis = useMemo(
        () => analyzeLines(productLines, catalog, stretchReserved),
        [productLines, catalog, stretchReserved]
    );

    // Mantener una bobina con stock y un core compatible seleccionados
    useEffect(() => {
        setItem((prev) => {
            const withStock = rawMaterials.filter((m) => Number(m.current_stock_kg) > 0);
            const raw =
                rawMaterials.find((m) => m.id === prev.raw_material_id && Number(m.current_stock_kg) > 0) ||
                withStock[0];
            const compatible = raw ? coresForWidth(raw.width_cm) : [];
            const core = compatible.find((c) => c.id === prev.core_id) || compatible[0];
            const next = { ...prev, raw_material_id: raw?.id || '', core_id: core?.id || '' };
            return next.raw_material_id === prev.raw_material_id && next.core_id === prev.core_id ? prev : next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rawMaterials, cores]);

    // Actualizar dirección al seleccionar cliente
    const handleClientChange = (clientId: string) => {
        setSelectedClientId(clientId);
        const cli = clients.find((c) => c.id === clientId);
        if (cli) {
            setDeliveryAddress(cli.delivery_address);
            setPaymentTerms(String(cli.payment_terms_days ?? 0));
        }
    };

    // Enviar formulario: stretch (medida única, opcional) + productos de bodega, en una sola RPC atómica
    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedClientId) {
            toast.error('Selecciona un cliente');
            return;
        }
        if (!includeStretch && productLines.length === 0) {
            toast.error('Incluye el stretch a fabricar o agrega al menos un producto');
            return;
        }

        const quantity = toNumber(item.quantity);
        const unitPrice = toNumber(item.unit_price);
        const weightGrams = toNumber(item.weight_grams);
        const raw = rawMaterials.find((m) => m.id === item.raw_material_id) || null;
        const core = cores.find((c) => c.id === item.core_id) || null;

        if (includeStretch) {
            if (!raw) {
                toast.error('Selecciona la bobina madre (tipo de stretch) a usar');
                return;
            }
            if (!core || Number(core.length_cm) !== Number(raw.width_cm)) {
                toast.error(`Selecciona un core de ${Number(raw.width_cm)} cm compatible con la bobina`);
                return;
            }
            if (
                !isPositiveNumber(item.quantity, 1) ||
                !isPositiveNumber(item.unit_price, 1) ||
                !isPositiveNumber(item.weight_grams, 1)
            ) {
                toast.error('Completa cantidad, precio y peso del stretch con valores mayores a 0');
                return;
            }
            const r = computeRoll(raw, core, quantity, weightGrams);
            if (!r.weightOk) {
                toast.error(
                    `El peso por rollo (${formatG(weightGrams)} g) debe ser mayor al peso del core (${formatG(r.coreWeight)} g).`
                );
                return;
            }
            if (!r.coresOk) {
                toast.error(
                    `No hay suficientes cores de ${Number(core.length_cm)} cm: disponibles ${r.availableCores}, solicitados ${quantity}.`
                );
                return;
            }
            if (!r.kgOk) {
                toast.error(
                    `Película insuficiente en "${raw.name}": se requieren ${formatKg(r.filmKgTotal)} kg y hay ${formatKg(r.availableKg)} kg.`
                );
                return;
            }
        }
        if (productAnalysis.firstError) {
            toast.error(productAnalysis.firstError);
            return;
        }

        try {
            setSaving(true);
            const { data, error } = await supabase.rpc('create_order', {
                p_order: {
                    client_id: selectedClientId,
                    priority,
                    delivery_date: deliveryDate,
                    delivery_address: deliveryAddress,
                    notes,
                    apply_vat: applyVat,
                    payment_terms_days: Math.max(0, Math.floor(Number(paymentTerms) || 0)),
                },
                p_stretch:
                    includeStretch && raw && core
                        ? {
                              raw_material_id: raw.id,
                              core_id: core.id,
                              quantity,
                              weight_grams: weightGrams,
                              unit_price: unitPrice,
                          }
                        : null,
                p_products: productLines.map((l) => ({
                    kind: l.kind,
                    ref_id: l.ref_id,
                    quantity: Number(l.quantity),
                    unit_price: Number(l.unit_price),
                })),
            });
            if (error) throw error;

            const res = (data || {}) as { order_number?: number; status?: string };
            toast.success(
                res.status === 'listo_despacho'
                    ? `Pedido #${res.order_number} registrado: listo para despacho (inventario descontado)`
                    : `Pedido #${res.order_number} registrado y enviado a planta`
            );
            setShowModal(false);
            setNotes('');
            setProductLines([]);
            setIncludeStretch(true);
            setApplyVat(true);
            fetchData();
        } catch (err: any) {
            toast.error('Error al registrar pedido: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Cambiar estado rápido
    const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
        try {
            const updates: {
                status: OrderStatus;
                started_at?: string;
                completed_at?: string;
                shipped_at?: string;
            } = { status: newStatus };
            if (newStatus === 'en_embobinado') updates.started_at = new Date().toISOString();
            if (newStatus === 'listo_despacho') updates.completed_at = new Date().toISOString();
            if (newStatus === 'enviado') updates.shipped_at = new Date().toISOString();

            const { error } = await supabase.from('orders').update(updates).eq('id', orderId);
            if (error) throw error;
            toast.success(`Estado actualizado a: ${STATUS_CONFIG[newStatus].label}`);
            fetchData();
        } catch (err: any) {
            toast.error('Error actualizando estado: ' + (err.message || 'Error'));
        }
    };

    // Eliminar pedido de la base de datos (corrección de errores)
    const handleDeleteOrder = async (order: Order) => {
        const statusLabel = (STATUS_CONFIG[order.status] || STATUS_CONFIG.pendiente).label;
        const inProduction = order.status === 'en_embobinado';
        const ok = await confirm({
            title: `¿Eliminar el pedido #${order.order_number}?`,
            description: (
                <>
                    {order.client?.business_name || 'Cliente'} · Estado: <b>{statusLabel}</b>
                    <br />
                    Se borrará el pedido y su medida de la base de datos. También desaparecerá de la app de
                    operarios. Esta acción no se puede deshacer.
                    {inProduction && (
                        <span className="mt-2 block rounded border border-amber-200 bg-amber-50 p-2 font-semibold text-amber-800">
                            ⚠️ Este pedido está en embobinado en planta en este momento.
                        </span>
                    )}
                </>
            ),
            confirmLabel: 'Eliminar pedido',
        });
        if (!ok) return;

        try {
            setDeletingId(order.id);
            // order_items y production_logs se eliminan en cascada
            const { data, error } = await supabase.from('orders').delete().eq('id', order.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('No tienes permiso para eliminar pedidos o el pedido ya no existe.');
            }
            setOrders((prev) => prev.filter((o) => o.id !== order.id));
            toast.success(`Pedido #${order.order_number} eliminado`);
        } catch (err: any) {
            const msg =
                err?.code === '23503'
                    ? 'El pedido tiene pagos registrados en Cuentas por Cobrar. Elimina primero esos pagos o cancela el pedido.'
                    : err?.message || 'Error';
            toast.error('Error al eliminar pedido: ' + msg);
        } finally {
            setDeletingId(null);
        }
    };

    const filteredOrders = orders.filter((o) => {
        if (filterStatus === 'all') return true;
        return o.status === filterStatus;
    });

    // --- Derivados del formulario ---
    const availableRaws = rawMaterials.filter(
        (m) => Number(m.current_stock_kg) > 0 || m.id === item.raw_material_id
    );
    const selectedRaw = rawMaterials.find((m) => m.id === item.raw_material_id) || null;
    const compatibleCores = selectedRaw ? coresForWidth(selectedRaw.width_cm) : [];
    const selectedCore = compatibleCores.find((c) => c.id === item.core_id) || null;
    const formQty = toNumber(item.quantity);
    const formWeight = toNumber(item.weight_grams);
    const roll = computeRoll(selectedRaw, selectedCore, formQty, formWeight);
    const hasWeight = formWeight > 0;

    const stretchBlock = !includeStretch
        ? null
        : !selectedRaw
          ? 'Selecciona una bobina'
          : !selectedCore
            ? 'Sin Core Compatible'
            : !hasWeight
              ? 'Indica el peso por rollo'
              : !roll.weightOk
                ? 'Peso Menor al Core'
                : !roll.coresOk
                  ? 'Sin Cores Suficientes'
                  : !roll.kgOk
                    ? 'Sin Kilos Suficientes'
                    : null;
    const blockReason =
        stretchBlock ??
        (!includeStretch && productLines.length === 0
            ? 'Agrega el stretch o productos'
            : productAnalysis.firstError
              ? 'Revisa los productos'
              : null);
    const canSubmit = blockReason === null;
    const stretchSubtotal = includeStretch ? formQty * toNumber(item.unit_price) : 0;
    const orderSubtotal = Math.round(stretchSubtotal + productAnalysis.total);
    const orderTax = applyVat ? Math.round(orderSubtotal * VAT_RATE) : 0;
    const orderTotal = orderSubtotal + orderTax;
    const termsDays = Math.max(0, Math.floor(Number(paymentTerms) || 0));
    const estimatedDue = (() => {
        const d = new Date(deliveryDate + 'T00:00:00');
        d.setDate(d.getDate() + termsDays);
        return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
    })();
    const selectedClient = clients.find((c) => c.id === selectedClientId) || null;
    const clientOpenBalance = orders
        .filter((o) => o.client_id === selectedClientId && o.status !== 'cancelado')
        .reduce((acc, o) => acc + Math.max(Number(o.total_amount) - Number(o.paid_amount || 0), 0), 0);
    const creditLimit = selectedClient?.credit_limit == null ? null : Number(selectedClient.credit_limit);
    const exceedsCredit = creditLimit !== null && clientOpenBalance + orderTotal > creditLimit;

    return (
        <div className="space-y-6">
            {confirmDialog}
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">
                        Gestión de Pedidos & Cola de Planta
                    </h2>
                    <p className="text-sm text-[#949E97]">
                        Sincronización en tiempo real con la app móvil de operarios
                    </p>
                </div>
                <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                >
                    <Plus className="h-4 w-4" /> Nueva Solicitud de Pedido
                </button>
            </div>

            {/* Filtros por Estado */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setFilterStatus('all')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filterStatus === 'all'
                        ? 'bg-[#3F8346] text-white'
                        : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'
                        }`}
                >
                    Todos ({orders.length})
                </button>
                <button
                    onClick={() => setFilterStatus('en_cola')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filterStatus === 'en_cola'
                        ? 'bg-amber-600 text-white'
                        : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                        }`}
                >
                    En Cola ({orders.filter((o) => o.status === 'en_cola').length})
                </button>
                <button
                    onClick={() => setFilterStatus('en_embobinado')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filterStatus === 'en_embobinado'
                        ? 'bg-blue-600 text-white'
                        : 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                        }`}
                >
                    En Embobinado ({orders.filter((o) => o.status === 'en_embobinado').length})
                </button>
                <button
                    onClick={() => setFilterStatus('listo_despacho')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filterStatus === 'listo_despacho'
                        ? 'bg-purple-600 text-white'
                        : 'bg-purple-100 text-purple-900 hover:bg-purple-200'
                        }`}
                >
                    Listo Despacho ({orders.filter((o) => o.status === 'listo_despacho').length})
                </button>
                <button
                    onClick={() => setFilterStatus('enviado')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filterStatus === 'enviado'
                        ? 'bg-green-600 text-white'
                        : 'bg-green-100 text-green-900 hover:bg-green-200'
                        }`}
                >
                    Enviados ({orders.filter((o) => o.status === 'enviado').length})
                </button>
            </div>

            {/* Tabla de Pedidos */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#C8CDC9] bg-white/50 py-20 text-center">
                    <Filter className="h-10 w-10 text-[#949E97]" />
                    <p className="mt-3 font-semibold text-[#2E4040]">No hay pedidos en este estado</p>
                    <p className="text-xs text-[#949E97]">
                        Haz clic en &quot;Nueva Solicitud de Pedido&quot; para crear uno
                    </p>
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-[#C8CDC9] bg-white shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-[#C8CDC9] bg-[#C8CDC9]/20 text-xs font-semibold text-[#2E4040]">
                                <tr>
                                    <th className="px-4 py-3"># Pedido</th>
                                    <th className="px-4 py-3">Cliente / Razón Social</th>
                                    <th className="px-4 py-3">Prioridad</th>
                                    <th className="px-4 py-3">Fecha Entrega</th>
                                    <th className="px-4 py-3">Contenido</th>
                                    <th className="px-4 py-3">Estado Actual</th>
                                    <th className="px-4 py-3 text-right">Acción de Planta</th>
                                    <th className="w-10 px-2 py-3" aria-label="Eliminar"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#C8CDC9]/50">
                                {filteredOrders.map((order) => {
                                    const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pendiente;
                                    const priorityCfg = PRIORITY_CONFIG[order.priority] || PRIORITY_CONFIG.normal;
                                    const totalRolls = order.items?.reduce((s, i) => s + i.quantity, 0) || 0;
                                    const prods = order.products || [];

                                    return (
                                        <tr key={order.id} className="hover:bg-slate-50/80">
                                            <td className="px-4 py-3.5 font-mono font-bold text-[#2E4040]">
                                                #{order.order_number}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <div className="font-semibold text-[#2E4040]">
                                                    {order.client?.business_name || 'Cliente'}
                                                </div>
                                                <div className="text-xs text-[#949E97]">
                                                    {order.client?.contact_name} · {order.client?.phone}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span
                                                    className={`rounded-full px-2.5 py-1 text-xs ${priorityCfg.bg} ${priorityCfg.text}`}
                                                >
                                                    {priorityCfg.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <div className="flex items-center gap-1.5 text-xs text-[#2E4040]">
                                                    <Calendar className="h-3.5 w-3.5 text-[#949E97]" />
                                                    <span>{order.delivery_date
                                                        ? new Date(order.delivery_date).toLocaleDateString('es-ES', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            timeZone: 'UTC' // Recomendado si es solo una fecha (YYYY-MM-DD) para evitar saltos por diferencia horaria
                                                        })
                                                        : 'N/A'}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5">
                                                {totalRolls > 0 && (
                                                    <>
                                                        <div className="flex items-center gap-1 text-xs font-semibold text-[#2E4040]">
                                                            <Factory className="h-3 w-3 text-[#949E97]" />
                                                            {totalRolls} rollos
                                                        </div>
                                                        <div className="text-[11px] text-[#949E97]">
                                                            {order.items?.map((it) => it.notes || 'Vinipel').join(', ')}
                                                        </div>
                                                    </>
                                                )}
                                                {prods.length > 0 && (
                                                    <div
                                                        className={`text-[11px] text-[#2E4040] ${totalRolls > 0 ? 'mt-1' : ''}`}
                                                        title={prods
                                                            .map((p) => `${Number(p.quantity)} ${p.unit} ${p.description}`)
                                                            .join('\n')}
                                                    >
                                                        <div className="flex items-center gap-1 font-semibold">
                                                            <Package className="h-3 w-3 text-[#949E97]" />
                                                            {prods.length} producto(s) de bodega
                                                        </div>
                                                        <div className="max-w-[220px] truncate text-[#949E97]">
                                                            {prods
                                                                .map((p) => `${Number(p.quantity)} ${p.unit} ${p.description}`)
                                                                .join(' · ')}
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="mt-0.5 text-[11px] font-semibold text-[#3F8346]">
                                                    {formatCOP(Number(order.total_amount || 0))}
                                                    <span className="ml-1 font-normal text-[#949E97]">
                                                        {order.apply_vat ? 'con IVA' : 'sin IVA'}
                                                    </span>
                                                </div>
                                                {order.status !== 'cancelado' && Number(order.total_amount) > 0 && (() => {
                                                    const balance = Math.max(
                                                        Number(order.total_amount) - Number(order.paid_amount || 0),
                                                        0
                                                    );
                                                    if (order.payment_status === 'pagado' || balance === 0) {
                                                        return (
                                                            <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                                                <Receipt className="h-3 w-3" /> Pagado
                                                            </span>
                                                        );
                                                    }
                                                    const due = order.due_date ? new Date(order.due_date + 'T00:00:00') : null;
                                                    const today = new Date();
                                                    today.setHours(0, 0, 0, 0);
                                                    const overdue = due ? due < today : false;
                                                    return (
                                                        <span
                                                            className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                                overdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
                                                            }`}
                                                            title={order.due_date ? `Vence ${order.due_date}` : ''}
                                                        >
                                                            <Receipt className="h-3 w-3" />
                                                            Saldo {formatCOP(balance)}
                                                            {due &&
                                                                ` · ${overdue ? 'vencido' : 'vence'} ${due.toLocaleDateString('es-CO', {
                                                                    day: '2-digit',
                                                                    month: 'short',
                                                                })}`}
                                                        </span>
                                                    );
                                                })()}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}
                                                >
                                                    <statusCfg.icon className="h-3 w-3" />
                                                    {statusCfg.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3.5 text-right">
                                                <div className="flex justify-end gap-1">
                                                    {order.status === 'en_cola' && (
                                                        <button
                                                            onClick={() =>
                                                                handleStatusChange(order.id, 'en_embobinado')
                                                            }
                                                            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                                                        >
                                                            Iniciar Embobinado
                                                        </button>
                                                    )}
                                                    {order.status === 'en_embobinado' && (
                                                        <button
                                                            onClick={() =>
                                                                handleStatusChange(order.id, 'listo_despacho')
                                                            }
                                                            className="rounded bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-purple-700"
                                                        >
                                                            Completar
                                                        </button>
                                                    )}
                                                    {order.status === 'listo_despacho' && (
                                                        <button
                                                            onClick={() =>
                                                                handleStatusChange(order.id, 'enviado')
                                                            }
                                                            className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700"
                                                        >
                                                            Marcar Salida / Enviado
                                                        </button>
                                                    )}
                                                    {order.status === 'enviado' && (
                                                        <span className="text-xs font-semibold text-green-700">
                                                            ✓ Despachado
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 py-3.5 text-right">
                                                <button
                                                    onClick={() => handleDeleteOrder(order)}
                                                    disabled={deletingId === order.id}
                                                    className="rounded-md p-1.5 text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                                                    title={`Eliminar pedido #${order.order_number}`}
                                                    aria-label={`Eliminar pedido #${order.order_number}`}
                                                >
                                                    {deletingId === order.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="h-4 w-4" />
                                                    )}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal: Registrar Nueva Solicitud / Pedido */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[#FDFDFD] p-6 shadow-2xl">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <div>
                                <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                    Nueva Solicitud de Pedido
                                </h3>
                                <p className="text-xs text-[#949E97]">
                                    Stretch a fabricar en planta (una medida) y/o productos que salen de bodega
                                </p>
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateOrder} className="mt-4 space-y-4">
                            {/* Cliente y Prioridad */}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Cliente Registrado *
                                    </label>
                                    <select
                                        required
                                        value={selectedClientId}
                                        onChange={(e) => handleClientChange(e.target.value)}
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    >
                                        <option value="" disabled>
                                            Seleccionar cliente...
                                        </option>
                                        {clients.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.business_name} {c.nit_rut ? `(${c.nit_rut})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {clients.length === 0 && (
                                        <p className="mt-1 text-[11px] text-amber-600">
                                            Primero crea un cliente en la pestaña &quot;Clientes&quot;
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Nivel de Urgencia / Prioridad *
                                    </label>
                                    <select
                                        value={priority}
                                        onChange={(e) => setPriority(e.target.value as OrderPriority)}
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    >
                                        <option value="baja">Baja</option>
                                        <option value="normal">Normal</option>
                                        <option value="alta">Alta</option>
                                        <option value="urgente">¡Urgente (Producción inmediata)!</option>
                                    </select>
                                </div>
                            </div>

                            {/* Fecha de Entrega y Dirección */}
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Fecha Límite de Entrega *
                                    </label>
                                    <input
                                        type="date"
                                        required
                                        value={deliveryDate}
                                        onChange={(e) => setDeliveryDate(e.target.value)}
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Dirección de Entrega
                                    </label>
                                    <input
                                        type="text"
                                        value={deliveryAddress}
                                        onChange={(e) => setDeliveryAddress(e.target.value)}
                                        placeholder="Dirección o bodega de despacho"
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* Detalle del Rollo a Fabricar (Medida Única, opcional) */}
                            <div className="rounded-lg border border-[#C8CDC9] bg-slate-50/50 p-3.5 space-y-3">
                                <div className="flex items-start justify-between gap-3 border-b border-[#C8CDC9]/60 pb-2">
                                    <div>
                                        <label className="text-xs font-bold text-[#2E4040]">
                                            Stretch a fabricar en planta (medida única)
                                        </label>
                                        <p className="text-[11px] text-[#949E97]">
                                            La bobina define color, ancho y calibre; el core debe tener el mismo ancho
                                        </p>
                                    </div>
                                    <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-[#2E4040]">
                                        <input
                                            type="checkbox"
                                            checked={includeStretch}
                                            onChange={(e) => setIncludeStretch(e.target.checked)}
                                            className="accent-[#3F8346]"
                                        />
                                        Incluir stretch
                                    </label>
                                </div>

                                {!includeStretch ? (
                                    <p className="text-[11px] text-[#949E97]">
                                        Pedido sin fabricación: no pasa por planta y queda directamente &quot;Listo
                                        Despacho&quot; al crearlo.
                                    </p>
                                ) : (
                                <div className="rounded-lg border border-[#C8CDC9] bg-white p-3 shadow-sm space-y-3">
                                    {/* Fila 1: Bobina madre en inventario */}
                                    <div>
                                        <label className="block text-[10px] font-semibold text-[#949E97] mb-1">Tipo de Stretch (bobina madre en bodega) *</label>
                                        {availableRaws.length === 0 ? (
                                            <div className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">
                                                <AlertCircle className="h-4 w-4 shrink-0" />
                                                <span>
                                                    No hay bobinas madre con stock. Registra una compra en
                                                    &quot;Inventarios &amp; Kardex&quot; para poder crear pedidos.
                                                </span>
                                            </div>
                                        ) : (
                                            <select
                                                required
                                                value={item.raw_material_id}
                                                onChange={(e) => handleRawChange(e.target.value)}
                                                className="w-full rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none disabled:bg-gray-50 disabled:text-[#949E97]"
                                            >
                                                <option value="" disabled>
                                                    Selecciona una bobina...
                                                </option>
                                                {availableRaws.map((m) => (
                                                    <option key={m.id} value={m.id}>
                                                        {m.name} — {describeRaw(m)} — {formatKg(Number(m.current_stock_kg))} kg
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>

                                    {/* Fila 2: Core compatible, cantidad y precio */}
                                    <div className="grid grid-cols-12 items-end gap-2.5">
                                        <div className="col-span-12 sm:col-span-5">
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Core / Tubo {selectedRaw ? `de ${Number(selectedRaw.width_cm)} cm` : ''} *
                                            </label>
                                            <select
                                                required
                                                value={item.core_id}
                                                onChange={(e) => setItem({ ...item, core_id: e.target.value })}
                                                disabled={!selectedRaw || compatibleCores.length === 0}
                                                className="w-full rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none disabled:bg-gray-50 disabled:text-[#949E97]"
                                            >
                                                {compatibleCores.length === 0 ? (
                                                    <option value="">
                                                        {selectedRaw ? 'Sin cores de este ancho' : 'Elige primero la bobina'}
                                                    </option>
                                                ) : (
                                                    compatibleCores.map((c) => (
                                                        <option key={c.id} value={c.id}>
                                                            {c.name} — {formatG(Number(c.weight_grams || 0))} g — {c.current_stock_units} und
                                                        </option>
                                                    ))
                                                )}
                                            </select>
                                        </div>
                                        <div className="col-span-6 sm:col-span-3">
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">Cantidad (rollos) *</label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                step="1"
                                                value={item.quantity}
                                                onChange={(e) => updateItemField('quantity', e.target.value)}
                                                className={`w-full rounded border px-2.5 py-1.5 text-xs focus:outline-none ${
                                                    selectedCore && !roll.coresOk
                                                        ? 'border-red-500 bg-red-50/50 font-bold text-red-900'
                                                        : 'border-[#C8CDC9] focus:border-[#3F8346]'
                                                }`}
                                            />
                                        </div>
                                        <div className="col-span-6 sm:col-span-4">
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">Precio Unit. ($) *</label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                step="1"
                                                value={item.unit_price}
                                                onChange={(e) => updateItemField('unit_price', e.target.value)}
                                                className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    {/* Fila 3: Peso total por rollo + datos derivados */}
                                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                                        <div>
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">Peso total por rollo (g) *</label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                step="1"
                                                value={item.weight_grams}
                                                onChange={(e) => updateItemField('weight_grams', e.target.value)}
                                                placeholder="Core + película. Ej: 1500"
                                                className={`w-full rounded border px-2.5 py-1.5 text-xs focus:outline-none ${
                                                    selectedCore && hasWeight && !roll.weightOk
                                                        ? 'border-red-500 bg-red-50/50 font-bold text-red-900'
                                                        : 'border-[#C8CDC9] focus:border-[#3F8346]'
                                                }`}
                                            />
                                        </div>
                                        <div>
                                            <span className="block text-[10px] font-semibold text-[#949E97] mb-1">Calibre (de la bobina)</span>
                                            <div className="rounded border border-dashed border-[#C8CDC9] bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-[#2E4040]">
                                                {selectedRaw ? `${Number(selectedRaw.caliber_microns)} µ` : '—'}
                                            </div>
                                        </div>
                                        <div>
                                            <span className="block text-[10px] font-semibold text-[#949E97] mb-1">Peso del core</span>
                                            <div className="rounded border border-dashed border-[#C8CDC9] bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-[#2E4040]">
                                                {selectedCore ? `${formatG(roll.coreWeight)} g` : '—'}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Desglose de consumo y validaciones */}
                                    {selectedRaw && !selectedCore && (
                                        <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-[11px] font-semibold text-red-700">
                                            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                                            <span>
                                                No hay cores de {Number(selectedRaw.width_cm)} cm registrados. Crea la medida en
                                                &quot;Inventarios &amp; Kardex → Cores&quot;.
                                            </span>
                                        </div>
                                    )}

                                    {selectedRaw && selectedCore && hasWeight && (
                                        <div className="space-y-1.5 rounded-md border border-[#C8CDC9]/70 bg-[#F8F9FA] p-2.5 text-[11px]">
                                            {roll.coreWeight === 0 && (
                                                <div className="flex items-center gap-1.5 font-semibold text-amber-700">
                                                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                                    <span>
                                                        El core &quot;{selectedCore.name}&quot; no tiene peso promedio definido (se
                                                        toma 0 g). Edítalo en Inventarios → Cores.
                                                    </span>
                                                </div>
                                            )}

                                            {!roll.weightOk ? (
                                                <div className="flex items-center gap-1.5 font-semibold text-red-700">
                                                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                                                    <span>
                                                        El peso por rollo ({formatG(formWeight)} g) debe ser mayor al peso del
                                                        core ({formatG(roll.coreWeight)} g).
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex flex-wrap items-center gap-x-1.5 text-[#2E4040]">
                                                    <Weight className="h-3.5 w-3.5 text-[#949E97]" />
                                                    <span>Por rollo:</span>
                                                    <b>{formatG(roll.coreWeight)} g core</b>
                                                    <span>+</span>
                                                    <b>{formatG(roll.filmPerRoll)} g película</b>
                                                    <span>=</span>
                                                    <b>{formatG(formWeight)} g</b>
                                                </div>
                                            )}

                                            {roll.weightOk && (
                                                <div
                                                    className={`flex items-center gap-1.5 ${
                                                        roll.kgOk ? 'text-[#3F8346]' : 'rounded border border-orange-200 bg-orange-50 p-1.5 font-semibold text-orange-800'
                                                    }`}
                                                >
                                                    {roll.kgOk ? (
                                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                                    ) : (
                                                        <AlertCircle className="h-3.5 w-3.5 shrink-0 text-orange-600" />
                                                    )}
                                                    <span>
                                                        Película a descontar: <b>{formatKg(roll.filmKgTotal)} kg</b> de{' '}
                                                        {formatKg(roll.availableKg)} kg disponibles en &quot;{selectedRaw.name}&quot;
                                                        {!roll.kgOk && ' — kilos insuficientes'}
                                                    </span>
                                                </div>
                                            )}

                                            <div
                                                className={`flex items-center gap-1.5 ${
                                                    roll.coresOk ? 'text-[#3F8346]' : 'rounded border border-red-200 bg-red-50 p-1.5 font-semibold text-red-700'
                                                }`}
                                            >
                                                {roll.coresOk ? (
                                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                                ) : (
                                                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                                                )}
                                                <span>
                                                    Cores a descontar: <b>{formQty}</b> de {roll.availableCores} armados
                                                    {!roll.coresOk && ' — cores insuficientes'}
                                                    {!roll.coresOk && selectedCore && (() => {
                                                        const mat = coreMaterials.find((m) => m.id === selectedCore.core_material_id);
                                                        const w = Number(selectedCore.weight_grams || 0);
                                                        if (!mat || w <= 0) return null;
                                                        const buildable = Math.floor((Number(mat.current_stock_kg || 0) * 1000) / w);
                                                        const missing = formQty - roll.availableCores;
                                                        return (
                                                            <span className="block font-normal">
                                                                Hay material para armar {buildable.toLocaleString('es-CO')} más
                                                                {buildable >= missing
                                                                    ? `: pide a planta armar ${missing} cores de ${Number(selectedCore.length_cm)} cm.`
                                                                    : ' (no alcanza: se requiere comprar material de cores).'}
                                                            </span>
                                                        );
                                                    })()}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>

                            {/* Productos de inventario (bodega) */}
                            <OrderProductsEditor
                                lines={productLines}
                                onChange={setProductLines}
                                catalog={catalog}
                                checks={productAnalysis.checks}
                                total={productAnalysis.total}
                            />

                            {/* Facturación: IVA, plazo y total */}
                            <div className="rounded-lg border border-[#C8CDC9] bg-white p-3.5">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={applyVat}
                                                onClick={() => setApplyVat((v) => !v)}
                                                className={`relative h-5 w-9 rounded-full transition ${
                                                    applyVat ? 'bg-[#3F8346]' : 'bg-[#C8CDC9]'
                                                }`}
                                                title={applyVat ? 'Desactivar IVA' : 'Activar IVA'}
                                            >
                                                <span
                                                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                                                        applyVat ? 'left-[18px]' : 'left-0.5'
                                                    }`}
                                                />
                                            </button>
                                            <span className="text-xs font-semibold text-[#2E4040]">
                                                {applyVat ? 'Con IVA (19%)' : 'Sin IVA'}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-[#949E97]">
                                            Los precios unitarios se digitan antes de IVA.
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <label className="text-[11px] font-semibold text-[#2E4040]">Plazo de pago</label>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={paymentTerms}
                                                onChange={(e) => setPaymentTerms(e.target.value)}
                                                className="w-16 rounded border border-[#C8CDC9] px-2 py-1 text-xs focus:border-[#3F8346] focus:outline-none"
                                            />
                                            <span className="text-[11px] text-[#949E97]">
                                                días {termsDays === 0 ? '(contado)' : ''} · vence aprox. {estimatedDue}
                                            </span>
                                        </div>
                                        {selectedClient && (
                                            <p className="text-[10px] text-[#949E97]">
                                                Pactado con el cliente:{' '}
                                                {Number(selectedClient.payment_terms_days) > 0
                                                    ? `${selectedClient.payment_terms_days} días`
                                                    : 'contado'}
                                                . El vencimiento final se cuenta desde la fecha real de despacho.
                                            </p>
                                        )}
                                    </div>
                                    <div className="min-w-[200px] space-y-0.5 text-right text-xs text-[#2E4040]">
                                        <div className="flex justify-between gap-4">
                                            <span className="text-[#949E97]">Subtotal</span>
                                            <span>{formatCOP(orderSubtotal)}</span>
                                        </div>
                                        <div className="flex justify-between gap-4">
                                            <span className="text-[#949E97]">IVA {applyVat ? '19%' : '(no aplica)'}</span>
                                            <span>{formatCOP(orderTax)}</span>
                                        </div>
                                        <div className="flex justify-between gap-4 border-t border-[#C8CDC9] pt-1 text-base font-bold">
                                            <span>Total</span>
                                            <span className="text-[#3F8346]">{formatCOP(orderTotal)}</span>
                                        </div>
                                    </div>
                                </div>
                                {exceedsCredit && (
                                    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>
                                            Supera el cupo del cliente: saldo pendiente {formatCOP(clientOpenBalance)} + este pedido{' '}
                                            {formatCOP(orderTotal)} &gt; cupo {formatCOP(creditLimit || 0)}. Puedes crearlo igual.
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="mt-4">
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Notas / Observaciones del Pedido
                                    </label>
                                    <textarea
                                        rows={2}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Instrucciones especiales para planta o entrega..."
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>

                            {/* Botones de acción */}
                            <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || !canSubmit}
                                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    {blockReason ??
                                        (includeStretch ? 'Crear Pedido y Enviar a Planta' : 'Crear Pedido (Listo Despacho)')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
