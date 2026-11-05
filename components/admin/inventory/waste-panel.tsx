'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, FileSpreadsheet, Loader2, Plus, Recycle, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type {
    CoreMaterial,
    CoreSpecification,
    InventoryItem,
    RawMaterial,
    WasteKind,
    WasteReason,
    WasteRecord,
} from '@/lib/types';
import { WASTE_KIND_LABEL, WASTE_REASON_LABEL, reasonsFor } from '@/lib/waste';
import { downloadCSV, formatCOP } from '@/components/admin/suppliers/utils';

const INPUT =
    'w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';
const fmtQty = (n: number) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const todayISO = () => new Date().toLocaleDateString('en-CA');

type Period = 'month' | 'prev' | '90' | 'custom';
function periodRange(p: Period, from: string, to: string) {
    const now = new Date();
    const iso = (d: Date) => d.toLocaleDateString('en-CA');
    if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    if (p === 'prev')
        return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    if (p === '90') return [iso(new Date(now.getTime() - 89 * 86400000)), iso(now)];
    return [from, to];
}

type OrderOption = {
    id: string;
    order_number: number;
    status: string;
    client: { business_name: string } | null;
    items: { raw_material_id: string | null; core_id: string | null }[];
};

type Props = {
    rawMaterials: RawMaterial[];
    cores: CoreSpecification[];
    coreMaterials: CoreMaterial[];
    invItems: InventoryItem[];
    isAdmin: boolean;
    /** Refresca el resto del inventario (stock) tras registrar o anular */
    onChanged: () => void;
};

/**
 * Desperdicios / mermas: documento fuente con causa, pedido de producción opcional y anulación.
 * Todo pasa por RPC (register_waste / annul_waste): stock, Kardex 'merma_desperdicio' y P&G.
 */
export default function WastePanel({ rawMaterials, cores, coreMaterials, invItems, isAdmin, onChanged }: Props) {
    const [supabase] = useState(() => createClient());
    const [records, setRecords] = useState<WasteRecord[]>([]);
    const [filmUsedKg, setFilmUsedKg] = useState(0);
    const [loading, setLoading] = useState(true);
    const [period, setPeriod] = useState<Period>('month');
    const [customFrom, setCustomFrom] = useState(todayISO());
    const [customTo, setCustomTo] = useState(todayISO());
    const [kindFilter, setKindFilter] = useState<'all' | WasteKind>('all');
    const [reasonFilter, setReasonFilter] = useState<'all' | WasteReason>('all');
    const [showAnnulled, setShowAnnulled] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [annulTarget, setAnnulTarget] = useState<WasteRecord | null>(null);

    const [from, to] = periodRange(period, customFrom, customTo);

    const load = useCallback(async () => {
        setLoading(true);
        const [wRes, kRes] = await Promise.all([
            supabase
                .from('waste_records')
                .select('*, order:orders(order_number, client:clients(business_name)), creator:profiles!waste_records_created_by_fkey(full_name)')
                .gte('waste_date', from)
                .lte('waste_date', to)
                .order('waste_date', { ascending: false })
                .order('created_at', { ascending: false }),
            // Película consumida por pedidos en el periodo, para el % de desperdicio
            supabase
                .from('inventory_transactions')
                .select('quantity')
                .eq('movement_type', 'consumo_pedido')
                .not('raw_material_id', 'is', null)
                .gte('created_at', from)
                .lte('created_at', to + 'T23:59:59'),
        ]);
        if (wRes.error) toast.error('No se pudieron cargar los desperdicios: ' + wRes.error.message);
        setRecords((wRes.data || []) as unknown as WasteRecord[]);
        setFilmUsedKg(((kRes.data || []) as { quantity: number }[]).reduce((a, r) => a + Number(r.quantity || 0), 0));
        setLoading(false);
    }, [supabase, from, to]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const ch = supabase
            .channel('waste-records')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'waste_records' }, () => load())
            .subscribe();
        return () => {
            supabase.removeChannel(ch);
        };
    }, [supabase, load]);

    const visible = useMemo(
        () =>
            records.filter(
                (r) =>
                    (showAnnulled || r.status === 'activo') &&
                    (kindFilter === 'all' || r.kind === kindFilter) &&
                    (reasonFilter === 'all' || r.reason === reasonFilter)
            ),
        [records, showAnnulled, kindFilter, reasonFilter]
    );

    // KPIs y desgloses solo con registros activos (los anulados no cuentan)
    const stats = useMemo(() => {
        const active = records.filter(
            (r) =>
                r.status === 'activo' &&
                (kindFilter === 'all' || r.kind === kindFilter) &&
                (reasonFilter === 'all' || r.reason === reasonFilter)
        );
        const cost = active.reduce((a, r) => a + Number(r.total_cost), 0);
        const filmKg = active.filter((r) => r.kind === 'bobina').reduce((a, r) => a + Number(r.quantity), 0);
        const byReason = new Map<string, number>();
        const byItem = new Map<string, { cost: number; qty: number; unit: string }>();
        for (const r of active) {
            byReason.set(r.reason, (byReason.get(r.reason) || 0) + Number(r.total_cost));
            const it = byItem.get(r.item_name) || { cost: 0, qty: 0, unit: r.unit };
            it.cost += Number(r.total_cost);
            it.qty += Number(r.quantity);
            byItem.set(r.item_name, it);
        }
        const reasons = Array.from(byReason.entries()).sort((a, b) => b[1] - a[1]);
        const items = Array.from(byItem.entries()).sort((a, b) => b[1].cost - a[1].cost).slice(0, 8);
        const filmPct = filmKg + filmUsedKg > 0 ? filmKg / (filmKg + filmUsedKg) : null;
        return { cost, filmKg, filmPct, count: active.length, reasons, items };
    }, [records, kindFilter, reasonFilter, filmUsedKg]);

    const exportCSV = () => {
        downloadCSV(
            `desperdicios_${from}_${to}.csv`,
            ['Fecha', 'Tipo', 'Producto', 'Cantidad', 'Unidad', 'Causa', 'Pedido', 'Costo unitario', 'Costo total', 'Estado', 'Registró', 'Notas'],
            visible.map((r) => [
                r.waste_date,
                WASTE_KIND_LABEL[r.kind],
                r.item_name,
                Number(r.quantity),
                r.unit,
                WASTE_REASON_LABEL[r.reason] || r.reason,
                r.order ? `#${r.order.order_number}` : '',
                Math.round(Number(r.unit_cost)),
                Math.round(Number(r.total_cost)),
                r.status === 'anulado' ? `Anulado: ${r.annul_reason || ''}` : 'Activo',
                r.creator?.full_name || '',
                r.notes || '',
            ])
        );
    };

    const maxReason = stats.reasons[0]?.[1] || 1;

    return (
        <div className="space-y-4">
            {/* Filtros (una sola fila) */}
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#C8CDC9] bg-white p-3 shadow-sm">
                <div>
                    <label className={LABEL}>Periodo</label>
                    <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={`${INPUT} bg-white`}>
                        <option value="month">Este mes</option>
                        <option value="prev">Mes anterior</option>
                        <option value="90">Últimos 90 días</option>
                        <option value="custom">Personalizado</option>
                    </select>
                </div>
                {period === 'custom' && (
                    <>
                        <div>
                            <label className={LABEL}>Desde</label>
                            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={INPUT} />
                        </div>
                        <div>
                            <label className={LABEL}>Hasta</label>
                            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={INPUT} />
                        </div>
                    </>
                )}
                <div>
                    <label className={LABEL}>Tipo</label>
                    <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)} className={`${INPUT} bg-white`}>
                        <option value="all">Todos</option>
                        {(Object.keys(WASTE_KIND_LABEL) as WasteKind[]).map((k) => (
                            <option key={k} value={k}>
                                {WASTE_KIND_LABEL[k]}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className={LABEL}>Causa</label>
                    <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as any)} className={`${INPUT} bg-white`}>
                        <option value="all">Todas</option>
                        {Object.entries(WASTE_REASON_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                                {v}
                            </option>
                        ))}
                    </select>
                </div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#2E4040]">
                    <input type="checkbox" checked={showAnnulled} onChange={(e) => setShowAnnulled(e.target.checked)} className="accent-[#3F8346]" />
                    Ver anulados
                </label>
                <div className="ml-auto flex gap-2">
                    <button
                        onClick={exportCSV}
                        disabled={visible.length === 0}
                        className="flex items-center gap-1.5 rounded-md border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-40"
                    >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                    </button>
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d6332]"
                    >
                        <Plus className="h-3.5 w-3.5" /> Registrar desperdicio
                    </button>
                </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Costo del desperdicio" value={formatCOP(stats.cost)} sub="Va al P&G como merma" />
                <Kpi
                    label="Película desperdiciada"
                    value={`${fmtQty(stats.filmKg)} kg`}
                    sub={
                        stats.filmPct === null
                            ? 'Sin consumo de película en el periodo'
                            : `${(stats.filmPct * 100).toFixed(1)}% de ${fmtQty(stats.filmKg + filmUsedKg)} kg usados`
                    }
                />
                <Kpi label="Registros" value={String(stats.count)} sub={`${from} a ${to}`} />
                <Kpi
                    label="Causa principal"
                    value={stats.reasons[0] ? WASTE_REASON_LABEL[stats.reasons[0][0]] : '—'}
                    sub={stats.reasons[0] ? formatCOP(stats.reasons[0][1]) : 'Sin desperdicios'}
                />
            </div>

            {/* Desgloses */}
            {stats.count > 0 && (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
                        <h3 className="mb-2 text-sm font-bold text-[#2E4040]">Costo por causa</h3>
                        <div className="space-y-2">
                            {stats.reasons.map(([reason, cost]) => (
                                <div key={reason} title={`${WASTE_REASON_LABEL[reason]}: ${formatCOP(cost)}`}>
                                    <div className="mb-0.5 flex justify-between text-[11px] text-[#2E4040]">
                                        <span>{WASTE_REASON_LABEL[reason] || reason}</span>
                                        <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {formatCOP(cost)} · {stats.cost > 0 ? ((cost / stats.cost) * 100).toFixed(0) : 0}%
                                        </span>
                                    </div>
                                    <div className="h-2 rounded-full bg-[#C8CDC9]/30">
                                        <div className="h-2 rounded-full bg-[#3F8346]" style={{ width: `${(cost / maxReason) * 100}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                    <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
                        <h3 className="mb-2 text-sm font-bold text-[#2E4040]">Productos con más desperdicio</h3>
                        <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            <thead className="text-[#949E97]">
                                <tr className="border-b border-[#C8CDC9]">
                                    <th className="py-1 text-left font-semibold">Producto</th>
                                    <th className="py-1 text-right font-semibold">Cantidad</th>
                                    <th className="py-1 text-right font-semibold">Costo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                                {stats.items.map(([name, it]) => (
                                    <tr key={name}>
                                        <td className="py-1.5">{name}</td>
                                        <td className="py-1.5 text-right">
                                            {fmtQty(it.qty)} {it.unit}
                                        </td>
                                        <td className="py-1.5 text-right font-semibold">{formatCOP(it.cost)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>
                </div>
            )}

            {/* Registros */}
            <div className="overflow-x-auto rounded-xl border border-[#C8CDC9] bg-white shadow-sm">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-[#3F8346]" />
                    </div>
                ) : visible.length === 0 ? (
                    <div className="py-12 text-center">
                        <Recycle className="mx-auto h-8 w-8 text-[#C8CDC9]" />
                        <p className="mt-2 text-sm font-semibold text-[#2E4040]">Sin desperdicios en este periodo</p>
                        <p className="text-[11px] text-[#949E97]">Registra refiles, arranques, rollos defectuosos o daños.</p>
                    </div>
                ) : (
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-[#949E97]">
                            <tr className="border-b border-[#C8CDC9]">
                                <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                                <th className="px-3 py-2 text-left font-semibold">Producto</th>
                                <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                                <th className="px-3 py-2 text-left font-semibold">Causa</th>
                                <th className="px-3 py-2 text-left font-semibold">Pedido</th>
                                <th className="px-3 py-2 text-right font-semibold">Costo</th>
                                <th className="px-3 py-2 text-left font-semibold">Registró</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C8CDC9]/50 text-[#2E4040]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {visible.map((r) => {
                                const annulled = r.status === 'anulado';
                                return (
                                    <tr key={r.id} className={annulled ? 'bg-slate-50 text-[#949E97]' : 'hover:bg-[#F9FBFA]'}>
                                        <td className="whitespace-nowrap px-3 py-2">{r.waste_date}</td>
                                        <td className="px-3 py-2">
                                            <div className={`font-semibold ${annulled ? 'line-through' : ''}`}>{r.item_name}</div>
                                            <div className="text-[10px] text-[#949E97]">{WASTE_KIND_LABEL[r.kind]}</div>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right font-bold">
                                            {fmtQty(r.quantity)} {r.unit}
                                        </td>
                                        <td className="px-3 py-2">
                                            {WASTE_REASON_LABEL[r.reason] || r.reason}
                                            {r.notes && <div className="max-w-[220px] truncate text-[10px] text-[#949E97]">{r.notes}</div>}
                                        </td>
                                        <td className="px-3 py-2">
                                            {r.order ? (
                                                <span>
                                                    #{r.order.order_number}
                                                    {r.order.client?.business_name && (
                                                        <span className="block max-w-[140px] truncate text-[10px] text-[#949E97]">
                                                            {r.order.client.business_name}
                                                        </span>
                                                    )}
                                                </span>
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold">{formatCOP(Number(r.total_cost))}</td>
                                        <td className="px-3 py-2">{r.creator?.full_name || '—'}</td>
                                        <td className="px-3 py-2 text-right">
                                            {annulled ? (
                                                <span
                                                    className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                                                    title={r.annul_reason || ''}
                                                >
                                                    <Ban className="h-3 w-3" /> Anulado
                                                </span>
                                            ) : (
                                                isAdmin && (
                                                    <button
                                                        onClick={() => setAnnulTarget(r)}
                                                        className="rounded-md border border-[#C8CDC9] px-2 py-1 text-[11px] font-semibold text-[#2E4040] hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                                                        title="Anular: devuelve el stock y revierte el costo"
                                                    >
                                                        Anular
                                                    </button>
                                                )
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {showForm && (
                <WasteFormModal
                    rawMaterials={rawMaterials}
                    cores={cores}
                    coreMaterials={coreMaterials}
                    invItems={invItems}
                    onClose={() => setShowForm(false)}
                    onSaved={() => {
                        setShowForm(false);
                        load();
                        onChanged();
                    }}
                />
            )}
            {annulTarget && (
                <AnnulModal
                    record={annulTarget}
                    onClose={() => setAnnulTarget(null)}
                    onDone={() => {
                        setAnnulTarget(null);
                        load();
                        onChanged();
                    }}
                />
            )}
        </div>
    );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
    return (
        <div className="rounded-xl border border-[#C8CDC9] bg-white p-3.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#949E97]">{label}</p>
            <p className="mt-1 text-lg font-bold text-[#2E4040]">{value}</p>
            <p className="text-[11px] text-[#949E97]">{sub}</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Registrar desperdicio
// ---------------------------------------------------------------------------
export function WasteFormModal({
    rawMaterials,
    cores,
    coreMaterials,
    invItems,
    initial,
    onClose,
    onSaved,
}: {
    rawMaterials: RawMaterial[];
    cores: CoreSpecification[];
    coreMaterials: CoreMaterial[];
    invItems: InventoryItem[];
    /** Prellenado (ej. desde un pedido: bobina del pedido + pedido) */
    initial?: { kind: WasteKind; refId?: string; orderId?: string };
    onClose: () => void;
    onSaved: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [kind, setKind] = useState<WasteKind>(initial?.kind || 'bobina');
    const [refId, setRefId] = useState(initial?.refId || '');
    const [qty, setQty] = useState('');
    const [reason, setReason] = useState<WasteReason>(initial?.kind === 'core' ? 'core_danado' : 'refile');
    const [orderId, setOrderId] = useState(initial?.orderId || '');
    const [date, setDate] = useState(todayISO());
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [orders, setOrders] = useState<OrderOption[]>([]);

    // Pedidos recientes con stretch (para asociar el desperdicio de producción)
    useEffect(() => {
        const since = new Date(Date.now() - 60 * 86400000).toISOString();
        supabase
            .from('orders')
            .select('id, order_number, status, client:clients(business_name), items:order_items(raw_material_id, core_id)')
            .neq('status', 'cancelado')
            .gte('created_at', since)
            .order('order_number', { ascending: false })
            .limit(80)
            .then(({ data }) => setOrders(((data || []) as unknown as OrderOption[]).filter((o) => o.items?.length > 0)));
    }, [supabase]);

    const options = useMemo(() => {
        if (kind === 'bobina')
            return rawMaterials.map((r) => ({
                id: r.id,
                label: `${r.name} · ${Number(r.width_cm)} cm · ${Number(r.caliber_microns)} µ`,
                stock: Number(r.current_stock_kg),
                unit: 'kg',
                cost: Number(r.cost_per_kg),
            }));
        if (kind === 'core')
            return cores.map((c) => ({
                id: c.id,
                label: `${Number(c.length_cm)} cm · ${coreMaterials.find((m) => m.id === c.core_material_id)?.name || c.name}`,
                stock: Number(c.current_stock_units),
                unit: 'und',
                cost: Number(c.standard_cost),
            }));
        if (kind === 'material_core')
            return coreMaterials.map((m) => ({
                id: m.id,
                label: m.name,
                stock: Number(m.current_stock_kg),
                unit: 'kg',
                cost: Number(m.cost_per_kg),
            }));
        return invItems
            .filter((i) => i.is_active)
            .map((i) => ({ id: i.id, label: i.name, stock: Number(i.current_stock), unit: i.unit, cost: Number(i.avg_cost) }));
    }, [kind, rawMaterials, cores, coreMaterials, invItems]);

    const selected = options.find((o) => o.id === refId) || null;
    const nQty = Number(qty) || 0;
    const reasons = reasonsFor(kind);
    // Pedidos que usaron este producto primero
    const orderOptions = useMemo(() => {
        const uses = (o: OrderOption) =>
            o.items.some((it) => (kind === 'bobina' && it.raw_material_id === refId) || (kind === 'core' && it.core_id === refId));
        return [...orders].sort((a, b) => Number(uses(b)) - Number(uses(a)));
    }, [orders, kind, refId]);

    const changeKind = (k: WasteKind) => {
        setKind(k);
        setRefId('');
        setQty('');
        if (!reasonsFor(k).some((r) => r.value === reason)) setReason(reasonsFor(k)[0].value);
        if (k === 'material_core' || k === 'insumo') setOrderId('');
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selected) return toast.error('Selecciona el producto');
        if (!(nQty > 0)) return toast.error('La cantidad debe ser mayor a 0');
        if (kind === 'core' && !Number.isInteger(nQty)) return toast.error('Los cores se registran en unidades enteras');
        if (nQty > selected.stock) return toast.error(`Solo hay ${fmtQty(selected.stock)} ${selected.unit} en stock`);
        if (reason === 'otro' && !notes.trim()) return toast.error('Describe la causa en las notas');
        setSaving(true);
        const { error } = await supabase.rpc('register_waste', {
            p_kind: kind,
            p_ref_id: selected.id,
            p_quantity: nQty,
            p_reason: reason,
            p_order_id: orderId || undefined,
            p_notes: notes.trim() || undefined,
            p_date: date,
        });
        setSaving(false);
        if (error) return toast.error('No se pudo registrar: ' + error.message);
        toast.success(`Desperdicio registrado: ${fmtQty(nQty)} ${selected.unit} de ${selected.label} (${formatCOP(nQty * selected.cost)})`);
        onSaved();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-base font-bold text-[#2E4040]">Registrar desperdicio</h3>
                        <p className="text-[11px] text-[#949E97]">Descuenta el stock, queda en el Kardex y en el P&amp;G como merma.</p>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <form onSubmit={submit} className="space-y-3 px-6 py-5">
                    <div>
                        <span className={LABEL}>Qué se desperdició</span>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                            {(Object.keys(WASTE_KIND_LABEL) as WasteKind[]).map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => changeKind(k)}
                                    className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold ${
                                        kind === k
                                            ? 'border-[#2E4040] bg-[#2E4040] text-white'
                                            : 'border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
                                    }`}
                                >
                                    {WASTE_KIND_LABEL[k]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className={LABEL}>Producto *</label>
                        <select value={refId} onChange={(e) => setRefId(e.target.value)} className={`${INPUT} bg-white font-semibold`}>
                            <option value="">Selecciona...</option>
                            {options.map((o) => (
                                <option key={o.id} value={o.id} disabled={o.stock <= 0}>
                                    {o.label} — {fmtQty(o.stock)} {o.unit}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={LABEL}>Cantidad ({selected?.unit || '—'}) *</label>
                            <input
                                type="number"
                                min="0"
                                step={kind === 'core' ? '1' : 'any'}
                                value={qty}
                                onChange={(e) => setQty(e.target.value)}
                                className={`${INPUT} text-sm font-bold ${selected && nQty > selected.stock ? 'border-red-500 bg-red-50' : ''}`}
                            />
                        </div>
                        <div>
                            <label className={LABEL}>Fecha</label>
                            <input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                        </div>
                    </div>

                    <div>
                        <label className={LABEL}>Causa *</label>
                        <select value={reason} onChange={(e) => setReason(e.target.value as WasteReason)} className={`${INPUT} bg-white`}>
                            {reasons.map((r) => (
                                <option key={r.value} value={r.value}>
                                    {r.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {(kind === 'bobina' || kind === 'core') && (
                        <div>
                            <label className={LABEL}>Pedido de producción (opcional)</label>
                            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={`${INPUT} bg-white`}>
                                <option value="">Sin pedido (desperdicio general)</option>
                                {orderOptions.map((o) => (
                                    <option key={o.id} value={o.id}>
                                        #{o.order_number} — {o.client?.business_name || 'Cliente'} ({o.status.replace('_', ' ')})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className={LABEL}>Notas {reason === 'otro' ? '*' : ''}</label>
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Detalle de lo ocurrido" className={INPUT} />
                    </div>

                    {selected && nQty > 0 && (
                        <p className="rounded-md border border-[#C8CDC9]/70 bg-[#F8F9FA] p-2 text-[11px] text-[#2E4040]">
                            Costo del desperdicio: <b>{formatCOP(nQty * selected.cost)}</b> ({fmtQty(nQty)} {selected.unit} ×{' '}
                            {formatCOP(selected.cost)}) · quedan {fmtQty(Math.max(selected.stock - nQty, 0))} {selected.unit}
                        </p>
                    )}

                    <div className="flex justify-end gap-2 border-t border-[#C8CDC9] pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                        >
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Registrar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function AnnulModal({ record, onClose, onDone }: { record: WasteRecord; onClose: () => void; onDone: () => void }) {
    const [supabase] = useState(() => createClient());
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (reason.trim().length < 3) return toast.error('Indica el motivo de la anulación');
        setSaving(true);
        const { error } = await supabase.rpc('annul_waste', { p_id: record.id, p_reason: reason.trim() });
        setSaving(false);
        if (error) return toast.error('No se pudo anular: ' + error.message);
        toast.success(`Desperdicio anulado: se devolvieron ${fmtQty(record.quantity)} ${record.unit} a ${record.item_name}`);
        onDone();
    };
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] p-6 shadow-2xl">
                <h3 className="font-heading text-base font-bold text-[#2E4040]">Anular desperdicio</h3>
                <p className="text-xs text-[#2E4040]">
                    {fmtQty(record.quantity)} {record.unit} de <b>{record.item_name}</b> ({formatCOP(Number(record.total_cost))}). Se devuelve
                    el stock y se revierte el costo en el Kardex y el P&amp;G. El registro queda como anulado.
                </p>
                <div>
                    <label className={LABEL}>Motivo *</label>
                    <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej: error de digitación" className={INPUT} />
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="flex items-center gap-1.5 rounded-md bg-red-600 px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Anular
                    </button>
                </div>
            </form>
        </div>
    );
}
