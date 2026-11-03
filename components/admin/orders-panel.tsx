'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Order, OrderPriority, OrderStatus, Client, CoreSpecification } from '@/lib/types';
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
    notes: string;
    quantity: NumericDraft;
    custom_length_cm: NumericDraft;
    caliber_microns: NumericDraft;
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

    // Medida única del pedido a fabricar
    const [item, setItem] = useState<OrderItemDraft>({
        notes: "Vinipel Stretch Transparente",
        quantity: 10,
        custom_length_cm: 50,
        caliber_microns: 17,
        weight_grams: 1500,
        unit_price: 25000,
    });

    const updateItemField = (field: keyof Omit<OrderItemDraft, 'notes'>, raw: string) => {
        setItem((prev) => ({
            ...prev,
            [field]: parseNumericDraft(raw),
        }));
    };

    // Cargar datos iniciales
    const fetchData = async () => {
        try {
            setLoading(true);
            const [ordersRes, clientsRes, coresRes] = await Promise.all([
                supabase
                    .from('orders')
                    .select('*, client:clients(*), items:order_items(*)')
                    .order('priority', { ascending: false })
                    .order('delivery_date', { ascending: true }),
                supabase.from('clients').select('*').order('business_name'),
                supabase.from('core_specifications').select('*').order('length_cm', { ascending: true }),
            ]);

            if (ordersRes.data) {
                setOrders(ordersRes.data as unknown as Order[]);
            }
            if (clientsRes.data) {
                setClients(clientsRes.data as Client[]);
            }
            if (coresRes.data && coresRes.data.length > 0) {
                const fetchedCores = coresRes.data as CoreSpecification[];
                setCores(fetchedCores);
                setItem((prev) => ({
                    ...prev,
                    custom_length_cm: prev.custom_length_cm || fetchedCores[0].length_cm,
                }));
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
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // Actualizar dirección al seleccionar cliente
    const handleClientChange = (clientId: string) => {
        setSelectedClientId(clientId);
        const cli = clients.find((c) => c.id === clientId);
        if (cli) {
            setDeliveryAddress(cli.delivery_address);
        }
    };

    // Enviar formulario de creación de pedido (Medida única)
    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedClientId) {
            toast.error('Selecciona un cliente');
            return;
        }

        const quantity = toNumber(item.quantity);
        const unitPrice = toNumber(item.unit_price);
        const customLengthCm = toNumber(item.custom_length_cm);
        const caliberMicrons = toNumber(item.caliber_microns);
        const weightGrams = toNumber(item.weight_grams);

        if (
            !isPositiveNumber(item.quantity, 1) ||
            !isPositiveNumber(item.unit_price, 1) ||
            !isPositiveNumber(item.custom_length_cm, 1) ||
            !isPositiveNumber(item.caliber_microns, 1) ||
            !isPositiveNumber(item.weight_grams, 1)
        ) {
            toast.error('Completa todos los campos con valores mayores a 0');
            return;
        }

        // CONDICIONAL: Validación estricta de stock de cores disponibles
        const selectedCore = cores.find((c) => c.length_cm === customLengthCm);
        if (selectedCore && quantity > selectedCore.current_stock_units) {
            toast.error(
                `No se puede crear el pedido: No hay suficientes cores de ${selectedCore.length_cm} cm en inventario. Disponibles: ${selectedCore.current_stock_units}, solicitados: ${quantity}. No se puede consumir más de lo disponible.`
            );
            return;
        }

        try {
            setSaving(true);
            const { data: userData } = await supabase.auth.getUser();
            if (!userData.user) throw new Error('No hay sesión activa');

            const totalAmount = quantity * unitPrice;

            // 1. Insertar Cabecera de Orden
            const { data: orderData, error: orderError } = await supabase
                .from('orders')
                .insert([
                    {
                        client_id: selectedClientId,
                        created_by: userData.user.id,
                        priority,
                        status: 'en_cola', // Se envía directamente a la cola para planta
                        delivery_date: deliveryDate,
                        delivery_address: deliveryAddress,
                        notes: notes || null,
                        total_amount: totalAmount,
                    },
                ])
                .select()
                .single();

            if (orderError || !orderData) throw orderError || new Error('Error creando orden');

            // 2. Insertar Item único (Medida fija)
            let productId: string | null = null;
            const { data: existingProd } = await supabase
                .from('products')
                .select('id')
                .limit(1)
                .maybeSingle();

            if (existingProd) {
                productId = existingProd.id;
            } else {
                // Crear un producto base de vinipel si no existe
                const { data: newProd } = await supabase
                    .from('products')
                    .insert([
                        {
                            name: 'Bobina Vinipel Estándar',
                            slug: 'bobina-vinipel-estandar-' + Date.now(),
                            film_type: 'manual',
                        },
                    ])
                    .select()
                    .single();
                if (newProd) productId = newProd.id;
            }

            if (productId) {
                const orderItemToInsert = {
                    order_id: orderData.id,
                    product_id: productId!,
                    quantity,
                    custom_length_cm: customLengthCm,
                    custom_caliber_microns: caliberMicrons,
                    weight_grams: weightGrams,
                    unit_price: unitPrice,
                    subtotal: totalAmount,
                    notes: item.notes,
                };

                await supabase.from('order_items').insert([orderItemToInsert]);
            }

            toast.success(`Pedido #${orderData.order_number} registrado y enviado a planta`);
            setShowModal(false);
            setNotes('');
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

    const filteredOrders = orders.filter((o) => {
        if (filterStatus === 'all') return true;
        return o.status === filterStatus;
    });

    const selectedCoreForForm = cores.find((c) => c.length_cm === toNumber(item.custom_length_cm));
    const isStockSufficient = selectedCoreForForm
        ? toNumber(item.quantity) <= selectedCoreForForm.current_stock_units
        : true;

    return (
        <div className="space-y-6">
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
                                    <th className="px-4 py-3">Rollos Requeridas</th>
                                    <th className="px-4 py-3">Estado Actual</th>
                                    <th className="px-4 py-3 text-right">Acción de Planta</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#C8CDC9]/50">
                                {filteredOrders.map((order) => {
                                    const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pendiente;
                                    const priorityCfg = PRIORITY_CONFIG[order.priority] || PRIORITY_CONFIG.normal;
                                    const totalRolls = order.items?.reduce((s, i) => s + i.quantity, 0) || 0;

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
                                                <div className="text-xs font-semibold text-[#2E4040]">
                                                    {totalRolls} rollos
                                                </div>
                                                <div className="text-[11px] text-[#949E97]">
                                                    {order.items?.map((it) => it.notes || 'Vinipel').join(', ')}
                                                </div>
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
                                    Nueva Solicitud de Pedido (Planta)
                                </h3>
                                <p className="text-xs text-[#949E97]">
                                    Los operarios verán este pedido priorizado en la app móvil
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

                            {/* Detalle del Rollo a Fabricar (Medida Única) */}
                            <div className="rounded-lg border border-[#C8CDC9] bg-slate-50/50 p-3.5 space-y-3">
                                <div className="flex items-center justify-between border-b border-[#C8CDC9]/60 pb-2">
                                    <div>
                                        <label className="text-xs font-bold text-[#2E4040]">
                                            Especificación del Rollo a Fabricar
                                        </label>
                                        <p className="text-[11px] text-[#949E97]">
                                            Cada orden se registra con una medida técnica para planta
                                        </p>
                                    </div>
                                    {selectedCoreForForm && (
                                        <div
                                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                                isStockSufficient
                                                    ? 'bg-emerald-100 text-emerald-800'
                                                    : 'bg-red-100 text-red-700 animate-pulse'
                                            }`}
                                        >
                                            Stock de Cores: {selectedCoreForForm.current_stock_units} disponibles
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-lg border border-[#C8CDC9] bg-white p-3 shadow-sm space-y-3">
                                    {/* Fila 1: Tipo y cantidad y precio */}
                                    <div className="grid grid-cols-12 items-end gap-2.5">
                                        <div className="col-span-12 sm:col-span-5">
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Tipo de Stretch *
                                            </label>
                                            <select
                                                value={item.notes}
                                                onChange={(e) => setItem({ ...item, notes: e.target.value })}
                                                className="w-full rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                                            >
                                                <option value="Vinipel Stretch Transparente">Stretch Transparente</option>
                                                <option value="Vinipel Stretch Negro">Stretch Negro</option>
                                                <option value="Vinipel Stretch Azul">Stretch Azul</option>
                                            </select>
                                        </div>
                                        <div className="col-span-6 sm:col-span-3">
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Cantidad (rollos) *
                                            </label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                step="1"
                                                value={item.quantity}
                                                onChange={(e) => updateItemField('quantity', e.target.value)}
                                                className={`w-full rounded border px-2.5 py-1.5 text-xs focus:outline-none ${
                                                    !isStockSufficient && toNumber(item.quantity) > 0
                                                        ? 'border-red-500 bg-red-50/50 text-red-900 font-bold'
                                                        : 'border-[#C8CDC9] focus:border-[#3F8346]'
                                                }`}
                                            />
                                        </div>
                                        <div className="col-span-6 sm:col-span-4">
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Precio Unit. ($) *
                                            </label>
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

                                    {/* Fila 2: Ancho (Desplegable BD de cores), Calibre y Peso */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                        <div>
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Ancho / Medida (cm) *
                                            </label>
                                            <select
                                                required
                                                value={item.custom_length_cm}
                                                onChange={(e) => updateItemField('custom_length_cm', e.target.value)}
                                                className="w-full rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                            >
                                                <option value="">Selecciona una medida</option>
                                                {cores.map((c) => (
                                                    <option key={c.id} value={c.length_cm}>
                                                        {c.length_cm} cm — {c.name} ({c.current_stock_units} cores)
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Calibre (micras) *
                                            </label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                step="1"
                                                value={item.caliber_microns}
                                                onChange={(e) => updateItemField('caliber_microns', e.target.value)}
                                                placeholder="Ej: 17µ"
                                                className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                                Peso (gramos) *
                                            </label>
                                            <input
                                                type="number"
                                                required
                                                min="1"
                                                step="1"
                                                value={item.weight_grams}
                                                onChange={(e) => updateItemField('weight_grams', e.target.value)}
                                                placeholder="Ej: 1500g"
                                                className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                                            />
                                        </div>
                                    </div>

                                    {/* Alerta / Feedback de Cores e Inventario */}
                                    {selectedCoreForForm && (
                                        <div className="pt-1">
                                            {!isStockSufficient ? (
                                                <div className="flex items-center gap-1.5 rounded-md bg-red-50 p-2 text-[11px] font-semibold text-red-700 border border-red-200">
                                                    <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                                                    <span>
                                                        ⚠️ No hay suficientes cores: solicitas {toNumber(item.quantity)} unidades y solo hay {selectedCoreForForm.current_stock_units} cores de {selectedCoreForForm.length_cm} cm en inventario.
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-[11px] text-[#3F8346]">
                                                    <CheckCircle2 className="h-3.5 w-3.5 text-[#3F8346]" />
                                                    <span>
                                                        Cores suficientes disponibles en planta ({selectedCoreForForm.current_stock_units} unidades).
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
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
                                    disabled={saving || !isStockSufficient}
                                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    {!isStockSufficient ? 'Sin Cores Suficientes' : 'Crear Pedido y Enviar a Planta'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
