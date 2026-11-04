'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CalendarClock,
    Download,
    HandCoins,
    Loader2,
    RefreshCw,
    Search,
    Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import type { Order } from '@/lib/types';
import {
    AGING_LABELS,
    type AgingBucket,
    agingBucket,
    daysUntil,
    downloadCSV,
    formatCOP,
    formatDate,
    todayISO,
} from '@/components/admin/suppliers/utils';
import OrderPaymentsModal from './order-payments-modal';

type Filter = 'abiertas' | 'vencidas' | 'por_vencer' | 'pagadas' | 'todas';

const FILTERS: { key: Filter; label: string }[] = [
    { key: 'abiertas', label: 'Por cobrar' },
    { key: 'vencidas', label: 'Vencidas' },
    { key: 'por_vencer', label: 'Por vencer' },
    { key: 'pagadas', label: 'Pagadas' },
    { key: 'todas', label: 'Todas' },
];

const PAY_STATUS: Record<string, { label: string; cls: string }> = {
    pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
    parcial: { label: 'Abono parcial', cls: 'bg-blue-100 text-blue-800' },
    pagado: { label: 'Pagado', cls: 'bg-emerald-100 text-emerald-800' },
};

const balanceOf = (o: Order) => Math.max(Number(o.total_amount) - Number(o.paid_amount || 0), 0);

export default function ReceivablesPanel() {
    const supabase = createClient();
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'admin';

    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<Filter>('abiertas');
    const [clientId, setClientId] = useState('');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Order | null>(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('orders')
                .select('*, client:clients(*), payments:customer_payments(*)')
                .neq('status', 'cancelado')
                .order('due_date', { ascending: true });
            if (error) throw error;
            const list = (data || []) as unknown as Order[];
            setOrders(list);
            // mantener el modal sincronizado con los datos nuevos
            setSelected((prev) => (prev ? list.find((o) => o.id === prev.id) || null : null));
        } catch (err: any) {
            toast.error('Error cargando cartera: ' + (err.message || 'Error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const channel = supabase
            .channel('realtime-receivables')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_payments' }, () => fetchData())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchData())
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const open = useMemo(() => orders.filter((o) => balanceOf(o) > 0), [orders]);

    // ---------- KPIs ----------
    const kpis = useMemo(() => {
        const month = todayISO().slice(0, 7);
        let porCobrar = 0;
        let vencido = 0;
        let vence7 = 0;
        for (const o of open) {
            const b = balanceOf(o);
            porCobrar += b;
            if (o.due_date) {
                const d = daysUntil(o.due_date);
                if (d < 0) vencido += b;
                else if (d <= 7) vence7 += b;
            }
        }
        const cobradoMes = orders
            .flatMap((o) => o.payments || [])
            .filter((p) => p.payment_date.slice(0, 7) === month)
            .reduce((acc, p) => acc + Number(p.amount) + Number(p.withholding_amount), 0);
        return { porCobrar, vencido, vence7, cobradoMes };
    }, [open, orders]);

    const aging = useMemo(() => {
        const buckets: Record<AgingBucket, number> = { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 };
        for (const o of open) buckets[o.due_date ? agingBucket(o.due_date) : 'por_vencer'] += balanceOf(o);
        return buckets;
    }, [open]);

    const byClient = useMemo(() => {
        const m = new Map<string, { name: string; balance: number; overdue: number; count: number }>();
        for (const o of open) {
            const cur = m.get(o.client_id) || { name: o.client?.business_name || 'Cliente', balance: 0, overdue: 0, count: 0 };
            const b = balanceOf(o);
            cur.balance += b;
            cur.count += 1;
            if (o.due_date && daysUntil(o.due_date) < 0) cur.overdue += b;
            m.set(o.client_id, cur);
        }
        return [...m.entries()].sort((a, b) => b[1].balance - a[1].balance);
    }, [open]);

    const clientsInList = useMemo(() => {
        const m = new Map<string, string>();
        orders.forEach((o) => m.set(o.client_id, o.client?.business_name || 'Cliente'));
        return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    }, [orders]);

    // ---------- Lista filtrada ----------
    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        return orders
            .filter((o) => {
                const b = balanceOf(o);
                const d = o.due_date ? daysUntil(o.due_date) : 0;
                if (filter === 'abiertas' && b <= 0) return false;
                if (filter === 'vencidas' && !(b > 0 && d < 0)) return false;
                if (filter === 'por_vencer' && !(b > 0 && d >= 0)) return false;
                if (filter === 'pagadas' && b > 0) return false;
                return true;
            })
            .filter((o) => !clientId || o.client_id === clientId)
            .filter(
                (o) =>
                    !q ||
                    String(o.order_number).includes(q) ||
                    (o.client?.business_name || '').toLowerCase().includes(q) ||
                    (o.client?.nit_rut || '').toLowerCase().includes(q)
            );
    }, [orders, filter, clientId, search]);

    const rowsBalance = rows.reduce((acc, o) => acc + balanceOf(o), 0);

    const exportCSV = () => {
        downloadCSV(
            `cuentas-por-cobrar-${todayISO()}.csv`,
            ['Pedido', 'Cliente', 'NIT', 'Fecha pedido', 'Plazo (días)', 'Vence', 'Días', 'Subtotal', 'IVA', 'Total', 'Abonado', 'Saldo', 'Estado'],
            rows.map((o) => [
                o.order_number,
                o.client?.business_name || '',
                o.client?.nit_rut || '',
                o.created_at.slice(0, 10),
                o.payment_terms_days,
                o.due_date || '',
                o.due_date ? daysUntil(o.due_date) : '',
                Math.round(Number(o.subtotal || 0)),
                Math.round(Number(o.tax_amount || 0)),
                Math.round(Number(o.total_amount)),
                Math.round(Number(o.paid_amount || 0)),
                Math.round(balanceOf(o)),
                PAY_STATUS[o.payment_status]?.label || o.payment_status,
            ])
        );
    };

    const maxAging = Math.max(1, ...Object.values(aging));

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Cuentas por Cobrar (Cartera)</h2>
                    <p className="text-sm text-[#949E97]">
                        Saldos de clientes según el plazo pactado. El vencimiento corre desde la fecha de despacho.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={fetchData}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3.5 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <RefreshCw className="h-3.5 w-3.5 text-[#3F8346]" /> Refrescar
                    </button>
                    <button
                        onClick={exportCSV}
                        disabled={rows.length === 0}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3.5 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-50"
                    >
                        <Download className="h-3.5 w-3.5 text-[#3F8346]" /> Exportar Excel
                    </button>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                    { label: 'Total por cobrar', value: kpis.porCobrar, icon: Wallet, cls: 'bg-[#3F8346]/10 text-[#3F8346]', sub: `${open.length} pedido(s) con saldo` },
                    { label: 'Vencido', value: kpis.vencido, icon: AlertTriangle, cls: 'bg-red-50 text-red-600', sub: 'Requiere gestión de cobro' },
                    { label: 'Vence en 7 días', value: kpis.vence7, icon: CalendarClock, cls: 'bg-amber-50 text-amber-600', sub: 'Próximos a vencer' },
                    { label: 'Cobrado este mes', value: kpis.cobradoMes, icon: HandCoins, cls: 'bg-blue-50 text-blue-600', sub: 'Incluye retenciones' },
                ].map((k) => (
                    <div key={k.label} className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">{k.label}</span>
                            <div className={`rounded-lg p-2 ${k.cls}`}>
                                <k.icon className="h-5 w-5" />
                            </div>
                        </div>
                        <div className="mt-3 text-2xl font-bold text-[#2E4040]">{formatCOP(k.value)}</div>
                        <div className="mt-1 text-xs text-[#949E97]">{k.sub}</div>
                    </div>
                ))}
            </div>

            {/* Antigüedad y clientes */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-[#2E4040]">Antigüedad de cartera</h3>
                    <div className="space-y-2">
                        {(Object.keys(aging) as AgingBucket[]).map((b) => (
                            <div key={b} className="text-xs">
                                <div className="mb-0.5 flex justify-between">
                                    <span className="text-[#2E4040]">{AGING_LABELS[b]}</span>
                                    <span className="font-semibold text-[#2E4040]">{formatCOP(aging[b])}</span>
                                </div>
                                <div className="h-2 rounded-full bg-[#C8CDC9]/40">
                                    <div
                                        className={`h-2 rounded-full ${b === 'por_vencer' ? 'bg-[#3F8346]' : b === 'd1_30' ? 'bg-amber-500' : 'bg-red-500'}`}
                                        style={{ width: `${(aging[b] / maxAging) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-[#2E4040]">Saldo por cliente</h3>
                    {byClient.length === 0 ? (
                        <p className="py-6 text-center text-xs text-[#949E97]">No hay saldos pendientes.</p>
                    ) : (
                        <ul className="divide-y divide-[#C8CDC9]/50 text-xs">
                            {byClient.slice(0, 6).map(([id, c]) => (
                                <li key={id}>
                                    <button
                                        onClick={() => {
                                            setClientId(id);
                                            setFilter('abiertas');
                                        }}
                                        className="flex w-full items-center justify-between py-2 text-left hover:bg-[#F9FBFA]"
                                    >
                                        <span>
                                            <span className="font-semibold text-[#2E4040]">{c.name}</span>
                                            <span className="ml-1 text-[#949E97]">({c.count})</span>
                                            {c.overdue > 0 && (
                                                <span className="ml-1.5 rounded-full bg-red-100 px-1.5 text-[10px] font-semibold text-red-700">
                                                    vencido {formatCOP(c.overdue)}
                                                </span>
                                            )}
                                        </span>
                                        <span className="font-bold text-[#2E4040]">{formatCOP(c.balance)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* Filtros */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                    {FILTERS.map((f) => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                                filter === f.key ? 'bg-[#2E4040] text-white' : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2">
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                    >
                        <option value="">Todos los clientes</option>
                        {clientsInList.map(([id, name]) => (
                            <option key={id} value={id}>
                                {name}
                            </option>
                        ))}
                    </select>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="# pedido, cliente o NIT"
                            className="w-56 rounded-lg border border-[#C8CDC9] bg-white py-2 pl-9 pr-3 text-xs focus:border-[#3F8346] focus:outline-none"
                        />
                    </div>
                </div>
            </div>

            {/* Tabla */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                    No hay pedidos en este filtro.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                            <tr>
                                <th className="px-4 py-3">Pedido</th>
                                <th className="px-4 py-3">Cliente</th>
                                <th className="px-4 py-3">Vencimiento</th>
                                <th className="px-4 py-3 text-right">Total</th>
                                <th className="px-4 py-3 text-right">Abonado</th>
                                <th className="px-4 py-3 text-right">Saldo</th>
                                <th className="px-4 py-3">Estado</th>
                                <th className="px-4 py-3 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C8CDC9]/40">
                            {rows.map((o) => {
                                const b = balanceOf(o);
                                const d = o.due_date ? daysUntil(o.due_date) : null;
                                const shipped = o.status === 'enviado' || o.status === 'entregado';
                                const st = PAY_STATUS[o.payment_status] || PAY_STATUS.pendiente;
                                return (
                                    <tr key={o.id} className="hover:bg-[#F9FBFA]">
                                        <td className="px-4 py-3">
                                            <div className="font-mono font-bold text-[#2E4040]">#{o.order_number}</div>
                                            <div className="text-[10px] text-[#949E97]">{formatDate(o.created_at)}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-semibold text-[#2E4040]">{o.client?.business_name || 'Cliente'}</div>
                                            <div className="text-[10px] text-[#949E97]">
                                                {o.payment_terms_days > 0 ? `Crédito ${o.payment_terms_days} días` : 'Contado'}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="text-[#2E4040]">{formatDate(o.due_date)}</div>
                                            {b > 0 && d !== null && (
                                                <div
                                                    className={`text-[10px] font-semibold ${
                                                        d < 0 ? 'text-red-600' : d <= 7 ? 'text-amber-700' : 'text-[#949E97]'
                                                    }`}
                                                >
                                                    {d < 0 ? `Vencido hace ${-d} d` : d === 0 ? 'Vence hoy' : `En ${d} d`}
                                                    {!shipped && ' · estimado'}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <div className="text-[#2E4040]">{formatCOP(Number(o.total_amount))}</div>
                                            <div className="text-[10px] text-[#949E97]">{o.apply_vat ? 'con IVA' : 'sin IVA'}</div>
                                        </td>
                                        <td className="px-4 py-3 text-right text-[#949E97]">{formatCOP(Number(o.paid_amount || 0))}</td>
                                        <td className="px-4 py-3 text-right font-bold text-[#2E4040]">{formatCOP(b)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => setSelected(o)}
                                                className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                                                    b > 0
                                                        ? 'bg-[#3F8346] text-white hover:bg-[#2d6332]'
                                                        : 'border border-[#C8CDC9] text-[#2E4040] hover:bg-[#C8CDC9]/20'
                                                }`}
                                            >
                                                {b > 0 ? 'Registrar pago' : 'Ver pagos'}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="border-t border-[#C8CDC9] bg-[#F8F9FA]">
                            <tr>
                                <td colSpan={5} className="px-4 py-2.5 text-right text-xs font-semibold text-[#2E4040]">
                                    Saldo de los {rows.length} pedido(s) listados
                                </td>
                                <td className="px-4 py-2.5 text-right text-sm font-bold text-[#2E4040]">{formatCOP(rowsBalance)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {selected && (
                <OrderPaymentsModal
                    order={selected}
                    isAdmin={isAdmin}
                    onClose={() => setSelected(null)}
                    onChanged={fetchData}
                />
            )}
        </div>
    );
}
