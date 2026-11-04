'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { downloadCSV, formatCOP, formatDate, todayISO } from '@/components/admin/suppliers/utils';

type Preset = 'mes' | 'mes_anterior' | 'trimestre' | 'anio' | 'ultimos_12' | 'personalizado';

const PRESETS: { key: Preset; label: string }[] = [
    { key: 'mes', label: 'Este mes' },
    { key: 'mes_anterior', label: 'Mes anterior' },
    { key: 'trimestre', label: 'Trimestre actual' },
    { key: 'anio', label: 'Año actual' },
    { key: 'ultimos_12', label: 'Últimos 12 meses' },
    { key: 'personalizado', label: 'Personalizado' },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetRange(p: Preset): [string, string] {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (p) {
        case 'mes_anterior':
            return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
        case 'trimestre': {
            const q = Math.floor(m / 3) * 3;
            return [iso(new Date(y, q, 1)), todayISO()];
        }
        case 'anio':
            return [`${y}-01-01`, todayISO()];
        case 'ultimos_12':
            return [iso(new Date(y, m - 11, 1)), todayISO()];
        default:
            return [iso(new Date(y, m, 1)), todayISO()];
    }
}

/** Periodo anterior de igual duración, justo antes del actual */
function previousRange(from: string, to: string): [string, string] {
    const f = new Date(from + 'T00:00:00');
    const t = new Date(to + 'T00:00:00');
    const len = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
    const pTo = new Date(f.getTime() - 86400000);
    const pFrom = new Date(pTo.getTime() - (len - 1) * 86400000);
    return [iso(pFrom), iso(pTo)];
}

type Line = { key: string; label: string; cur: number; prev: number | null; level: 'item' | 'sub' | 'total' | 'result'; sign?: 1 | -1; group?: string };

export default function IncomeStatement() {
    const [supabase] = useState(() => createClient());
    const [preset, setPreset] = useState<Preset>('mes');
    const [[from, to], setRange] = useState<[string, string]>(presetRange('mes'));
    const [basis, setBasis] = useState<'despacho' | 'pedido'>('despacho');
    const [clientId, setClientId] = useState('');
    const [compare, setCompare] = useState(true);
    const [taxRate, setTaxRate] = useState('35');
    const [clients, setClients] = useState<{ id: string; business_name: string }[]>([]);
    const [cur, setCur] = useState<any>(null);
    const [prev, setPrev] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState<Record<string, boolean>>({ opex: true, nonop: true });

    useEffect(() => {
        supabase
            .from('clients')
            .select('id, business_name')
            .order('business_name')
            .then(({ data }) => setClients((data || []) as { id: string; business_name: string }[]));
    }, [supabase]);

    const load = useCallback(async () => {
        if (!from || !to || from > to) return;
        try {
            setLoading(true);
            const args = {
                p_basis: basis,
                p_tax_rate: (Number(taxRate) || 0) / 100,
                ...(clientId ? { p_client: clientId } : {}),
            };
            const [pf, pt] = previousRange(from, to);
            const [c, p] = await Promise.all([
                supabase.rpc('income_statement', { p_from: from, p_to: to, ...args }),
                compare ? supabase.rpc('income_statement', { p_from: pf, p_to: pt, ...args }) : Promise.resolve({ data: null, error: null }),
            ]);
            if (c.error) throw c.error;
            setCur(c.data);
            setPrev(p.data);
        } catch (err: any) {
            toast.error('No se pudo calcular el estado de resultados: ' + (err.message || ''));
        } finally {
            setLoading(false);
        }
    }, [supabase, from, to, basis, clientId, compare, taxRate]);

    useEffect(() => {
        load();
    }, [load]);

    const lines: Line[] = useMemo(() => {
        if (!cur) return [];
        const v = (o: any, k: string) => (o ? Number(o[k]) || 0 : null);
        const L: Line[] = [];
        const push = (key: string, label: string, level: Line['level'], group?: string) =>
            L.push({ key, label, level, cur: v(cur, key) ?? 0, prev: v(prev, key), group });

        push('revenue', 'Ingresos operacionales (ventas)', 'total');
        push('revenue_stretch', 'Stretch fabricado', 'sub');
        push('revenue_products', 'Productos de bodega', 'sub');
        push('cost_sales', 'Costo de ventas', 'total');
        push('cost_film', 'Película consumida', 'sub');
        push('cost_cores', 'Cores', 'sub');
        push('cost_products', 'Productos vendidos', 'sub');
        if (!cur.client_filtered) {
            push('mermas', 'Mermas de inventario', 'item');
            push('consumo_interno', 'Consumo interno de inventario', 'item');
        }
        push('gross_profit', 'Utilidad bruta', 'result');
        if (!cur.client_filtered) {
            push('opex_total', 'Gastos operacionales', 'total');
            const prevOpex = new Map<string, number>(((prev?.opex || []) as any[]).map((o) => [o.name, Number(o.amount)]));
            for (const o of cur.opex as any[])
                L.push({ key: 'opex:' + o.name, label: `${o.name}${o.puc ? ` (${o.puc})` : ''}`, level: 'sub', cur: Number(o.amount), prev: prev ? prevOpex.get(o.name) ?? 0 : null, group: 'opex' });
            push('operating_profit', 'Utilidad operacional', 'result');
            push('other_income', 'Otros ingresos', 'item');
            push('non_operating_total', 'Gastos no operacionales', 'total');
            push('financial_total', 'Gastos financieros (intereses)', 'total');
            const prevNon = new Map<string, number>(((prev?.non_operating || []) as any[]).map((o) => [o.name, Number(o.amount)]));
            for (const o of cur.non_operating as any[])
                L.push({ key: 'non:' + o.name, label: `${o.name}${o.puc ? ` (${o.puc})` : ''}`, level: 'sub', cur: Number(o.amount), prev: prev ? prevNon.get(o.name) ?? 0 : null, group: 'nonop' });
            push('cash_adjustments', 'Faltantes de caja y otros egresos', 'item');
            push('pretax_profit', 'Utilidad antes de impuestos', 'result');
            push('income_tax', `Provisión impuesto de renta (${taxRate}%)`, 'item');
            push('net_profit', 'Utilidad neta', 'result');
        }
        return L;
    }, [cur, prev, taxRate]);

    const revenue = Number(cur?.revenue) || 0;
    const prevRevenue = Number(prev?.revenue) || 0;

    const exportCSV = () =>
        downloadCSV(
            `estado-resultados-${from}-a-${to}.csv`,
            ['Concepto', `${from} a ${to}`, '% ventas', ...(prev ? ['Periodo anterior', 'Variación %'] : [])],
            lines.map((l) => [
                (l.level === 'sub' ? '   ' : '') + l.label,
                Math.round(l.cur),
                revenue ? ((l.cur / revenue) * 100).toFixed(1) : '',
                ...(prev ? [Math.round(l.prev || 0), l.prev ? (((l.cur - l.prev) / Math.abs(l.prev)) * 100).toFixed(1) : ''] : []),
            ])
        );

    const [pFrom, pTo] = previousRange(from, to);

    return (
        <div className="space-y-4">
            {/* Una sola fila de filtros */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#C8CDC9]/60 bg-white p-3 print:hidden">
                <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Periodo</label>
                    <select
                        value={preset}
                        onChange={(e) => {
                            const p = e.target.value as Preset;
                            setPreset(p);
                            if (p !== 'personalizado') setRange(presetRange(p));
                        }}
                        className="rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs"
                    >
                        {PRESETS.map((p) => (
                            <option key={p.key} value={p.key}>
                                {p.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Desde</label>
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => {
                            setPreset('personalizado');
                            setRange([e.target.value, to]);
                        }}
                        className="rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Hasta</label>
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => {
                            setPreset('personalizado');
                            setRange([from, e.target.value]);
                        }}
                        className="rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs"
                    />
                </div>
                <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Reconocer ventas por</label>
                    <select value={basis} onChange={(e) => setBasis(e.target.value as 'despacho' | 'pedido')} className="rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs">
                        <option value="despacho">Fecha de despacho (facturación)</option>
                        <option value="pedido">Fecha del pedido</option>
                    </select>
                </div>
                <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Cliente</label>
                    <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="max-w-[200px] rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs">
                        <option value="">Todos (empresa completa)</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.business_name}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Renta %</label>
                    <input type="number" min="0" max="100" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} className="w-16 rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs" />
                </div>
                <label className="flex items-center gap-1.5 pb-1.5 text-xs text-[#2E4040]">
                    <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[#3F8346]" />
                    Comparar con periodo anterior
                </label>
                <div className="ml-auto flex gap-2">
                    <button onClick={exportCSV} disabled={!cur} className="flex items-center gap-1.5 rounded border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20">
                        <Download className="h-3.5 w-3.5 text-[#3F8346]" /> Excel
                    </button>
                    <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20">
                        <Printer className="h-3.5 w-3.5 text-[#3F8346]" /> Imprimir / PDF
                    </button>
                </div>
            </div>

            {!cur && loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : cur ? (
                <div className={`grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px] ${loading ? 'opacity-60' : ''}`}>
                    <section className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                        <div className="mb-3">
                            <h3 className="font-heading text-lg font-bold text-[#2E4040]">Estado de resultados</h3>
                            <p className="text-[11px] text-[#949E97]">
                                Del {formatDate(from)} al {formatDate(to)} · {cur.orders_count} pedido(s) · ventas por{' '}
                                {basis === 'despacho' ? 'fecha de despacho' : 'fecha de pedido'} · valores sin IVA
                                {clientId && ` · cliente: ${clients.find((c) => c.id === clientId)?.business_name}`}
                            </p>
                            {cur.client_filtered && (
                                <p className="mt-1 text-[11px] text-amber-700">
                                    Con filtro de cliente se muestra hasta la utilidad bruta (los gastos son de toda la empresa).
                                </p>
                            )}
                        </div>
                        <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            <thead className="text-[#949E97]">
                                <tr className="border-b border-[#C8CDC9]">
                                    <th className="py-2 text-left font-semibold">Concepto</th>
                                    <th className="py-2 text-right font-semibold">Valor</th>
                                    <th className="py-2 text-right font-semibold">% ventas</th>
                                    {prev && (
                                        <>
                                            <th className="py-2 text-right font-semibold" title={`${pFrom} a ${pTo}`}>
                                                Periodo anterior
                                            </th>
                                            <th className="py-2 text-right font-semibold">Variación</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="text-[#2E4040]">
                                {lines.map((l) => {
                                    if (l.level === 'sub' && l.group && !open[l.group]) return null;
                                    const variation = l.prev !== null && l.prev !== 0 ? (l.cur - l.prev) / Math.abs(l.prev) : null;
                                    const isGroupHead = l.key === 'opex_total' || l.key === 'non_operating_total';
                                    const groupKey = l.key === 'opex_total' ? 'opex' : 'nonop';
                                    const negative = l.level === 'result' && l.cur < 0;
                                    return (
                                        <tr
                                            key={l.key}
                                            className={
                                                l.level === 'result'
                                                    ? 'border-y border-[#2E4040]/20 bg-[#F8F9FA] font-bold'
                                                    : l.level === 'total'
                                                      ? 'border-t border-[#C8CDC9]/60 font-semibold'
                                                      : ''
                                            }
                                        >
                                            <td className={`py-1.5 ${l.level === 'sub' ? 'pl-6 text-[#949E97]' : ''}`}>
                                                {isGroupHead ? (
                                                    <button
                                                        onClick={() => setOpen((o) => ({ ...o, [groupKey]: !o[groupKey] }))}
                                                        className="inline-flex items-center gap-1"
                                                    >
                                                        {open[groupKey] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                                        {l.label}
                                                    </button>
                                                ) : (
                                                    l.label
                                                )}
                                            </td>
                                            <td className={`py-1.5 text-right ${negative ? 'text-red-700' : ''}`}>{formatCOP(l.cur)}</td>
                                            <td className="py-1.5 text-right text-[#949E97]">{revenue ? `${((l.cur / revenue) * 100).toFixed(1)}%` : '—'}</td>
                                            {prev && (
                                                <>
                                                    <td className="py-1.5 text-right text-[#949E97]">{formatCOP(l.prev || 0)}</td>
                                                    <td className="py-1.5 text-right text-[#949E97]">
                                                        {variation === null ? '—' : `${variation >= 0 ? '+' : ''}${(variation * 100).toFixed(1)}%`}
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <p className="mt-3 text-[10px] text-[#949E97]">
                            Base de causación: el costo de ventas es lo consumido por esos mismos pedidos (Kardex); los gastos se
                            reconocen por su fecha de vencimiento y en créditos solo cuentan los intereses. La provisión de renta es
                            informativa.
                        </p>
                    </section>

                    <aside className="h-fit space-y-4">
                        <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-4 shadow-sm">
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#949E97]">Márgenes</h4>
                            {[
                                ['Margen bruto', 'gross_profit'],
                                ...(!cur.client_filtered
                                    ? [
                                          ['Margen operacional', 'operating_profit'],
                                          ['Margen neto', 'net_profit'],
                                      ]
                                    : []),
                            ].map(([label, key]) => {
                                const m = revenue ? Number(cur[key]) / revenue : null;
                                const pm = prevRevenue ? Number(prev?.[key]) / prevRevenue : null;
                                return (
                                    <div key={key} className="flex items-baseline justify-between border-b border-[#C8CDC9]/40 py-1.5 text-xs last:border-0">
                                        <span className="text-[#2E4040]">{label}</span>
                                        <span>
                                            <b className={`text-base ${m !== null && m < 0 ? 'text-red-700' : 'text-[#2E4040]'}`}>
                                                {m === null ? '—' : `${(m * 100).toFixed(1)}%`}
                                            </b>
                                            {prev && pm !== null && <span className="ml-1.5 text-[#949E97]">antes {(pm * 100).toFixed(1)}%</span>}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-4 shadow-sm">
                            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#949E97]">Ventas por cliente</h4>
                            {(cur.top_clients as any[]).length === 0 ? (
                                <p className="text-xs text-[#949E97]">Sin ventas en el periodo.</p>
                            ) : (
                                <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    <tbody className="divide-y divide-[#C8CDC9]/40">
                                        {(cur.top_clients as any[]).map((c) => (
                                            <tr key={c.name}>
                                                <td className="py-1.5 text-[#2E4040]">
                                                    {c.name}
                                                    <span className="ml-1 text-[#949E97]">({c.orders})</span>
                                                </td>
                                                <td className="py-1.5 text-right font-semibold text-[#2E4040]">{formatCOP(Number(c.revenue))}</td>
                                                <td className="py-1.5 text-right text-[#949E97]">
                                                    {revenue ? `${((Number(c.revenue) / revenue) * 100).toFixed(0)}%` : ''}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </aside>
                </div>
            ) : null}
        </div>
    );
}
