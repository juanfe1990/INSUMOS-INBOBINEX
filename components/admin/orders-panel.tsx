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
    FilmCutWidth,
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
import StretchLinesEditor from '@/components/admin/orders/stretch-lines-editor';
import { analyzeStretch, compatibleCores, newStretchLine, stretchPayload, type StretchLine } from '@/lib/stretch-lines';
import { templatesToLines } from '@/lib/client-templates';
import type { ClientOrderTemplate } from '@/lib/types';
import {
    Clock,
    AlertCircle,
    Plus,
    Loader2,
    Calendar,
    CheckCircle2,
    Truck,
    RotateCw,
    Scissors,
    X,
    Filter,
    Trash2,
    Weight,
    Factory,
    Package,
    Receipt,
    Search,
    AlertTriangle,
    CalendarClock,
    History,
    PackageCheck,
} from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CONFIG: Record<OrderStatus, { label: string; bg: string; text: string; icon: any }> = {
    pendiente: { label: 'Pendiente Oficina', bg: 'bg-gray-100', text: 'text-gray-700', icon: Clock },
    en_cola: { label: 'En Cola Planta', bg: 'bg-amber-100', text: 'text-amber-800', icon: Clock },
    en_embobinado: { label: 'En Embobinado', bg: 'bg-blue-100', text: 'text-blue-800', icon: RotateCw },
    listo_despacho: { label: 'Listo Despacho', bg: 'bg-purple-100', text: 'text-purple-800', icon: PackageCheck },
    enviado: { label: 'Enviado', bg: 'bg-green-100', text: 'text-green-800', icon: Truck },
    entregado: { label: 'Entregado', bg: 'bg-emerald-100', text: 'text-emerald-800', icon: CheckCircle2 },
    cancelado: { label: 'Cancelado', bg: 'bg-red-100', text: 'text-red-700', icon: AlertCircle },
};

/** Vistas del listado: "por despachar" agrupa lo que aún no ha salido de la empresa */
type OrderView = 'despachar' | 'en_cola' | 'en_embobinado' | 'listo_despacho' | 'enviado' | 'entregado' | 'historico' | 'todos';
const PENDING_DISPATCH: OrderStatus[] = ['pendiente', 'en_cola', 'en_embobinado', 'listo_despacho'];

const PRIORITY_CONFIG: Record<OrderPriority, { label: string; bg: string; text: string }> = {
    baja: { label: 'Baja', bg: 'bg-slate-100', text: 'text-slate-600' },
    normal: { label: 'Normal', bg: 'bg-blue-50', text: 'text-blue-700' },
    alta: { label: 'Alta', bg: 'bg-amber-100', text: 'text-amber-800' },
    urgente: { label: '¡Urgente!', bg: 'bg-red-100', text: 'text-red-700 font-bold animate-pulse' },
};

/** IVA general en Colombia; los precios del pedido se digitan antes de IVA */
const VAT_RATE = 0.19;
const formatCOP = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');

export default function OrdersPanel() {
    const supabase = createClient();
    const [orders, setOrders] = useState<Order[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<OrderView>('despachar');
    const [search, setSearch] = useState('');
    const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'late' | 'today' | 'week'>('all');
    const [sortBy, setSortBy] = useState<'entrega' | 'prioridad' | 'numero'>('entrega');
    const [visibleCount, setVisibleCount] = useState(50);
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
    const [cuts, setCuts] = useState<FilmCutWidth[]>([]);
    const [invItems, setInvItems] = useState<InventoryItem[]>([]);
    const [invCategories, setInvCategories] = useState<InventoryCategory[]>([]);
    // Stretch fabricado (una o varias medidas) y productos de bodega
    const [stretchLines, setStretchLines] = useState<StretchLine[]>([]);
    const [productLines, setProductLines] = useState<ProductLine[]>([]);
    // Pedido habitual del cliente seleccionado
    const [clientTemplates, setClientTemplates] = useState<ClientOrderTemplate[]>([]);
    // Facturación: IVA opcional y plazo de pago (por defecto el pactado con el cliente)
    const [applyVat, setApplyVat] = useState(true);
    const [paymentTerms, setPaymentTerms] = useState('0');
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDialog, confirm] = useConfirm();

    // Primera medida por defecto: bobina con stock y su primer core compatible
    const defaultStretchLine = () => {
        const raw = rawMaterials.find((m) => Number(m.current_stock_kg) > 0) || null;
        const core = compatibleCores(raw, cores, cuts)[0];
        return newStretchLine({ raw_material_id: raw?.id || '', core_id: core?.id || '' });
    };

    const openNewOrder = () => {
        setStretchLines([defaultStretchLine()]);
        setProductLines([]);
        setClientTemplates([]);
        setSelectedClientId('');
        setShowModal(true);
    };

    // Cargar datos iniciales
    const fetchData = async () => {
        try {
            setLoading(true);
            const [ordersRes, clientsRes, coresRes, rawRes, coreMatRes, itemsRes, catRes, cutsRes] = await Promise.all([
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
                supabase.from('film_cut_widths').select('*').order('bobina_width_cm').order('roll_width_cm'),
            ]);
            if (cutsRes.data) setCuts(cutsRes.data as FilmCutWidth[]);

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

    // Medidas de stretch: validación por línea + stock combinado (lo mismo que hace create_order)
    const stretchAnalysis = useMemo(
        () => analyzeStretch(stretchLines, rawMaterials, cores, cuts),
        [stretchLines, rawMaterials, cores, cuts]
    );
    const stretchReserved = stretchAnalysis.reserved;

    const productAnalysis = useMemo(
        () => analyzeLines(productLines, catalog, stretchReserved),
        [productLines, catalog, stretchReserved]
    );

    // Actualizar dirección al seleccionar cliente
    const handleClientChange = async (clientId: string) => {
        setSelectedClientId(clientId);
        const cli = clients.find((c) => c.id === clientId);
        if (cli) {
            setDeliveryAddress(cli.delivery_address);
            setPaymentTerms(String(cli.payment_terms_days ?? 0));
        }
        setClientTemplates([]);
        if (!clientId) return;
        const { data } = await supabase
            .from('client_order_templates')
            .select('*')
            .eq('client_id', clientId)
            .order('position');
        const rows = (data || []) as ClientOrderTemplate[];
        setClientTemplates(rows);
        if (rows.length > 0) applyTemplate(rows, cli?.business_name);
    };

    // Carga el pedido habitual del cliente (reemplaza las líneas del formulario)
    const applyTemplate = (rows: ClientOrderTemplate[], clientName?: string) => {
        const { stretch, products } = templatesToLines(rows);
        setStretchLines(stretch);
        setProductLines(products);
        toast.success(
            `Pedido habitual${clientName ? ` de ${clientName}` : ''} cargado: ${stretch.length} medida(s) de stretch y ${products.length} producto(s). Revisa cantidades antes de crear.`
        );
    };

    // Enviar formulario: stretch (una o varias medidas) + productos de bodega, en una sola RPC atómica
    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedClientId) {
            toast.error('Selecciona un cliente');
            return;
        }
        if (stretchLines.length === 0 && productLines.length === 0) {
            toast.error('Agrega rollos de stretch o al menos un producto');
            return;
        }
        if (stretchAnalysis.firstError) {
            toast.error(stretchAnalysis.firstError);
            return;
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
                p_stretch: stretchLines.length > 0 ? stretchPayload(stretchLines) : null,
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
            setStretchLines([]);
            setClientTemplates([]);
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
    // Solo los pedidos "En cola" se pueden eliminar (aún no han movido inventario ni producción)
    const handleDeleteOrder = async (order: Order) => {
        if (order.status !== 'en_cola') {
            toast.error('Solo se pueden eliminar pedidos en estado "En cola".');
            return;
        }
        const statusLabel = (STATUS_CONFIG[order.status] || STATUS_CONFIG.pendiente).label;
        const ok = await confirm({
            title: `¿Eliminar el pedido #${order.order_number}?`,
            description: (
                <>
                    {order.client?.business_name || 'Cliente'} · Estado: <b>{statusLabel}</b>
                    <br />
                    Se borrará el pedido y su medida de la base de datos. También desaparecerá de la app de
                    operarios. Esta acción no se puede deshacer.
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

    // ---------- Vista de pedidos: por despachar primero, históricos aparte ----------
    const todayStr = new Date().toLocaleDateString('en-CA');
    const daysTo = (d?: string | null) =>
        d ? Math.round((new Date(d + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 864e5) : null;
    const isPendingDispatch = (o: Order) => PENDING_DISPATCH.includes(o.status);

    const live = useMemo(() => orders.filter((o) => !o.is_historical), [orders]);
    const toDispatch = useMemo(() => live.filter(isPendingDispatch), [live]);
    const lateOrders = toDispatch.filter((o) => (daysTo(o.delivery_date) ?? 0) < 0);
    const todayOrders = toDispatch.filter((o) => daysTo(o.delivery_date) === 0);
    const countBy = (st: OrderStatus) => live.filter((o) => o.status === st).length;
    const historicalCount = orders.length - live.length;

    const filteredOrders = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list =
            view === 'despachar'
                ? toDispatch
                : view === 'historico'
                  ? orders.filter((o) => o.is_historical)
                  : view === 'todos'
                    ? live
                    : live.filter((o) => o.status === view);
        if (deliveryFilter !== 'all') {
            list = list.filter((o) => {
                const d = daysTo(o.delivery_date);
                if (d === null) return false;
                if (deliveryFilter === 'late') return d < 0 && isPendingDispatch(o);
                if (deliveryFilter === 'today') return d === 0;
                return d >= 0 && d <= 7;
            });
        }
        if (q) {
            list = list.filter(
                (o) =>
                    String(o.order_number).includes(q) ||
                    (o.invoice_number || '').toLowerCase().includes(q) ||
                    (o.client?.business_name || '').toLowerCase().includes(q) ||
                    (o.historical_description || o.notes || '').toLowerCase().includes(q)
            );
        }
        const rank: Record<OrderPriority, number> = { urgente: 0, alta: 1, normal: 2, baja: 3 };
        const byNumberDesc = (a: Order, b: Order) => b.order_number - a.order_number;
        return [...list].sort((a, b) => {
            if (sortBy === 'numero') return byNumberDesc(a, b);
            if (sortBy === 'prioridad') return rank[a.priority] - rank[b.priority] || (a.delivery_date || '').localeCompare(b.delivery_date || '');
            // Por despachar: lo más próximo a entregar primero; en el resto, lo más reciente primero
            return view === 'despachar' || view === 'en_cola' || view === 'en_embobinado' || view === 'listo_despacho'
                ? (a.delivery_date || '').localeCompare(b.delivery_date || '') || rank[a.priority] - rank[b.priority]
                : (b.delivery_date || '').localeCompare(a.delivery_date || '') || byNumberDesc(a, b);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orders, live, toDispatch, view, search, deliveryFilter, sortBy]);
    const shownOrders = filteredOrders.slice(0, visibleCount);

    const changeView = (v: OrderView) => {
        setView(v);
        setVisibleCount(50);
        if (v !== 'despachar') setDeliveryFilter('all');
    };

    // --- Derivados del formulario ---
    const blockReason =
        stretchLines.length === 0 && productLines.length === 0
            ? 'Agrega rollos o productos'
            : stretchAnalysis.firstError
              ? 'Revisa las medidas de stretch'
              : productAnalysis.firstError
                ? 'Revisa los productos'
                : null;
    const canSubmit = blockReason === null;
    const stretchSubtotal = stretchAnalysis.subtotal;
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
                    onClick={openNewOrder}
                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                >
                    <Plus className="h-4 w-4" /> Nueva Solicitud de Pedido
                </button>
            </div>

            {/* Resumen de despacho (clic para filtrar) */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                {(
                    [
                        {
                            key: 'despachar',
                            label: 'Por despachar',
                            value: toDispatch.length,
                            sub: formatCOP(toDispatch.reduce((a, o) => a + Number(o.total_amount || 0), 0)),
                            icon: Truck,
                            tone: 'text-[#2E4040]',
                            onClick: () => { changeView('despachar'); setDeliveryFilter('all'); },
                            active: view === 'despachar' && deliveryFilter === 'all',
                        },
                        {
                            key: 'late',
                            label: 'Atrasados',
                            value: lateOrders.length,
                            sub: lateOrders.length ? 'Fecha de entrega vencida' : 'Al día',
                            icon: AlertTriangle,
                            tone: lateOrders.length ? 'text-red-700' : 'text-[#2E4040]',
                            onClick: () => { changeView('despachar'); setDeliveryFilter('late'); },
                            active: view === 'despachar' && deliveryFilter === 'late',
                        },
                        {
                            key: 'today',
                            label: 'Se entregan hoy',
                            value: todayOrders.length,
                            sub: 'Pendientes de salir',
                            icon: CalendarClock,
                            tone: todayOrders.length ? 'text-amber-700' : 'text-[#2E4040]',
                            onClick: () => { changeView('despachar'); setDeliveryFilter('today'); },
                            active: view === 'despachar' && deliveryFilter === 'today',
                        },
                        {
                            key: 'planta',
                            label: 'En planta',
                            value: countBy('en_cola') + countBy('en_embobinado'),
                            sub: `${countBy('en_cola')} en cola · ${countBy('en_embobinado')} embobinando`,
                            icon: Factory,
                            tone: 'text-[#2E4040]',
                            onClick: () => changeView('en_cola'),
                            active: view === 'en_cola' || view === 'en_embobinado',
                        },
                        {
                            key: 'listo',
                            label: 'Listos para despacho',
                            value: countBy('listo_despacho'),
                            sub: 'Esperando salida',
                            icon: PackageCheck,
                            tone: 'text-[#2E4040]',
                            onClick: () => changeView('listo_despacho'),
                            active: view === 'listo_despacho',
                        },
                    ] as const
                ).map((k) => (
                    <button
                        key={k.key}
                        onClick={k.onClick}
                        className={`rounded-xl border bg-white p-3.5 text-left shadow-sm transition hover:border-[#3F8346] ${
                            k.active ? 'border-[#3F8346] ring-1 ring-[#3F8346]' : 'border-[#C8CDC9]'
                        }`}
                    >
                        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#949E97]">
                            <k.icon className="h-3.5 w-3.5" /> {k.label}
                        </p>
                        <p className={`mt-1 text-2xl font-bold ${k.tone}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {k.value}
                        </p>
                        <p className="truncate text-[11px] text-[#949E97]">{k.sub}</p>
                    </button>
                ))}
            </div>

            {/* Vistas por estado + búsqueda, entrega y orden (una sola fila de filtros) */}
            <div className="space-y-3 rounded-xl border border-[#C8CDC9] bg-white p-3 shadow-sm">
                <div className="flex flex-wrap gap-1.5">
                    {(
                        [
                            ['despachar', 'Por despachar', toDispatch.length],
                            ['en_cola', STATUS_CONFIG.en_cola.label, countBy('en_cola')],
                            ['en_embobinado', STATUS_CONFIG.en_embobinado.label, countBy('en_embobinado')],
                            ['listo_despacho', STATUS_CONFIG.listo_despacho.label, countBy('listo_despacho')],
                            ['enviado', 'Enviados', countBy('enviado')],
                            ['entregado', 'Entregados', countBy('entregado')],
                            ['todos', 'Todos', live.length],
                            ['historico', 'Histórico (Excel)', historicalCount],
                        ] as [OrderView, string, number][]
                    ).map(([v, label, n]) => (
                        <button
                            key={v}
                            onClick={() => changeView(v)}
                            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                view === v
                                    ? 'border-[#2E4040] bg-[#2E4040] text-white'
                                    : 'border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
                            }`}
                        >
                            {v === 'historico' && <History className="h-3 w-3" />}
                            {label}
                            <span className={`rounded-full px-1.5 text-[10px] ${view === v ? 'bg-white/20' : 'bg-[#C8CDC9]/40'}`}>{n}</span>
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[220px] flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949E97]" />
                        <input
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setVisibleCount(50); }}
                            placeholder="Buscar por cliente, # de pedido, factura (FE) o producto..."
                            className="w-full rounded-md border border-[#C8CDC9] py-1.5 pl-8 pr-3 text-xs focus:border-[#3F8346] focus:outline-none"
                        />
                    </div>
                    <select
                        value={deliveryFilter}
                        onChange={(e) => { setDeliveryFilter(e.target.value as typeof deliveryFilter); setVisibleCount(50); }}
                        className="rounded-md border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                        aria-label="Filtrar por fecha de entrega"
                    >
                        <option value="all">Cualquier fecha de entrega</option>
                        <option value="late">Atrasados</option>
                        <option value="today">Se entregan hoy</option>
                        <option value="week">Próximos 7 días</option>
                    </select>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        className="rounded-md border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                        aria-label="Ordenar"
                    >
                        <option value="entrega">Ordenar por entrega</option>
                        <option value="prioridad">Ordenar por prioridad</option>
                        <option value="numero">Más recientes primero</option>
                    </select>
                    <span className="text-xs text-[#949E97]">{filteredOrders.length} pedido(s)</span>
                </div>
            </div>

            {/* Tabla de Pedidos */}
            {loading ? (
                <div className="flex justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : filteredOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#C8CDC9] bg-white/50 py-20 text-center">
                    <Filter className="h-10 w-10 text-[#949E97]" />
                    <p className="mt-3 font-semibold text-[#2E4040]">
                        {view === 'despachar' && !search && deliveryFilter === 'all'
                            ? 'Todo despachado: no hay pedidos pendientes de salir'
                            : 'No hay pedidos con estos filtros'}
                    </p>
                    <p className="text-xs text-[#949E97]">
                        Cambia la vista o la búsqueda, o crea uno con &quot;Nueva Solicitud de Pedido&quot;.
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
                                {shownOrders.map((order) => {
                                    const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pendiente;
                                    const priorityCfg = PRIORITY_CONFIG[order.priority] || PRIORITY_CONFIG.normal;
                                    const totalRolls = order.items?.reduce((s, i) => s + i.quantity, 0) || 0;
                                    const prods = order.products || [];

                                    const dDays = daysTo(order.delivery_date);
                                    const pendingOut = isPendingDispatch(order);
                                    const isLate = pendingOut && dDays !== null && dDays < 0;
                                    return (
                                        <tr
                                            key={order.id}
                                            className={`hover:bg-slate-50/80 ${isLate ? 'border-l-4 border-l-red-400' : ''}`}
                                        >
                                            <td className="px-4 py-3.5 font-mono font-bold text-[#2E4040]">
                                                #{order.order_number}
                                                {order.invoice_number && (
                                                    <div className="font-sans text-[10px] font-semibold text-[#949E97]">{order.invoice_number}</div>
                                                )}
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
                                                {pendingOut && dDays !== null && (
                                                    <span
                                                        className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                            dDays < 0
                                                                ? 'bg-red-100 text-red-700'
                                                                : dDays === 0
                                                                  ? 'bg-amber-100 text-amber-800'
                                                                  : 'bg-slate-100 text-slate-600'
                                                        }`}
                                                    >
                                                        {dDays < 0 ? <AlertTriangle className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                                                        {dDays < 0
                                                            ? `Atrasado ${-dDays} d`
                                                            : dDays === 0
                                                              ? 'Hoy'
                                                              : dDays === 1
                                                                ? 'Mañana'
                                                                : `En ${dDays} días`}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3.5">
                                                {order.is_historical && (
                                                    <div className="max-w-[260px] text-[11px] text-[#2E4040]" title={order.historical_description || ''}>
                                                        <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                                            Histórico
                                                        </span>
                                                        <span className="line-clamp-2">{order.historical_description}</span>
                                                    </div>
                                                )}
                                                {totalRolls > 0 && (
                                                    <>
                                                        <div className="flex items-center gap-1 text-xs font-semibold text-[#2E4040]">
                                                            <Factory className="h-3 w-3 text-[#949E97]" />
                                                            {totalRolls} rollos
                                                        </div>
                                                        <div className="text-[11px] text-[#949E97]">
                                                            {order.items
                                                                ?.map((it) => `${it.quantity} × ${it.custom_length_cm ? `${Number(it.custom_length_cm)} cm` : it.notes || 'Vinipel'}`)
                                                                .join(' · ')}
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
                                                    {order.status === 'enviado' && !order.is_historical && (
                                                        <button
                                                            onClick={() => handleStatusChange(order.id, 'entregado')}
                                                            className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
                                                            title="El cliente ya recibió el pedido"
                                                        >
                                                            Marcar entregado
                                                        </button>
                                                    )}
                                                    {order.status === 'entregado' && (
                                                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                                            {order.is_historical ? 'Histórico' : 'Entregado'}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 py-3.5 text-right">
                                                {order.status === 'en_cola' && (
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
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {filteredOrders.length > shownOrders.length && (
                        <div className="border-t border-[#C8CDC9] p-3 text-center">
                            <button
                                onClick={() => setVisibleCount((n) => n + 50)}
                                className="rounded-md border border-[#C8CDC9] px-4 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                            >
                                Ver {Math.min(50, filteredOrders.length - shownOrders.length)} más ({shownOrders.length} de {filteredOrders.length})
                            </button>
                        </div>
                    )}
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

                            {/* Stretch a fabricar: una o varias medidas */}
                            <div className="rounded-lg border border-[#C8CDC9] bg-slate-50/50 p-3.5 space-y-3">
                                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#C8CDC9]/60 pb-2">
                                    <div>
                                        <label className="text-xs font-bold text-[#2E4040]">Stretch a fabricar en planta</label>
                                        <p className="text-[11px] text-[#949E97]">
                                            Agrega una línea por medida (ej. 15 cm y 45 cm). La bobina define color y calibre;
                                            el core debe ser un corte permitido de la bobina.
                                        </p>
                                    </div>
                                    {clientTemplates.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => applyTemplate(clientTemplates, selectedClient?.business_name)}
                                            className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#3F8346] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#3F8346] hover:bg-[#3F8346]/5"
                                            title="Reemplaza las líneas por el pedido habitual del cliente"
                                        >
                                            <RotateCw className="h-3.5 w-3.5" />
                                            Recargar pedido habitual
                                        </button>
                                    )}
                                </div>
                                <StretchLinesEditor
                                    lines={stretchLines}
                                    onChange={setStretchLines}
                                    checks={stretchAnalysis.checks}
                                    raws={rawMaterials}
                                    cores={cores}
                                    coreMaterials={coreMaterials}
                                    cuts={cuts}
                                    subtotal={stretchAnalysis.subtotal}
                                    rolls={stretchAnalysis.rolls}
                                    filmKg={stretchAnalysis.filmKg}
                                />
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
                                        (stretchLines.length > 0 ? 'Crear Pedido y Enviar a Planta' : 'Crear Pedido (Listo Despacho)')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
