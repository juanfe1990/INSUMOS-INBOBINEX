'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertOctagon,
    AlertTriangle,
    ArrowDownRight,
    ArrowUpRight,
    CalendarClock,
    FileSpreadsheet,
    Loader2,
    Minus,
    Table2,
    UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { downloadCSV } from '@/components/admin/suppliers/utils';

const INPUT =
    'rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';
const BAR = '#3F8346';
const fmtCOP = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
const fmtShort = (n: number) => {
    const v = Number(n) || 0;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)} mil M`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)} M`;
    if (Math.abs(v) >= 1e3) return `$${Math.round(v / 1e3)} mil`;
    return `$${Math.round(v)}`;
};
const fmtN = (n: number, d = 0) => (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: d });
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const STATUS_LABEL: Record<string, string> = {
    pendiente: 'Pendiente',
    en_cola: 'En cola',
    en_embobinado: 'En embobinado',
    listo_despacho: 'Listo despacho',
    enviado: 'Enviado',
    entregado: 'Entregado',
};

type Preset = 'month' | 'prev' | '30' | '90' | 'year' | 'custom';
function rangeFor(p: Preset, from: string, to: string): [string, string] {
    const now = new Date();
    if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    if (p === 'prev') return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    if (p === '30') return [iso(new Date(now.getTime() - 29 * 864e5)), iso(now)];
    if (p === '90') return [iso(new Date(now.getTime() - 89 * 864e5)), iso(now)];
    if (p === 'year') return [iso(new Date(now.getFullYear(), 0, 1)), iso(now)];
    return [from, to];
}

type Dash = any;

/** Estadísticas de clientes y pedidos por rango de fechas (RPC clients_dashboard) */
export default function ClientsDashboard() {
    const [supabase] = useState(() => createClient());
    const [preset, setPreset] = useState<Preset>('30');
    const [customFrom, setCustomFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)));
    const [customTo, setCustomTo] = useState(iso(new Date()));
    const [data, setData] = useState<Dash | null>(null);
    const [loading, setLoading] = useState(true);
    const [showAllClients, setShowAllClients] = useState(false);
    const [from, to] = rangeFor(preset, customFrom, customTo);

    const load = useCallback(async () => {
        if (!from || !to || to < from) return;
        setLoading(true);
        const { data: d, error } = await supabase.rpc('clients_dashboard', { p_from: from, p_to: to });
        if (error) toast.error('No se pudieron calcular las estadísticas: ' + error.message);
        setData(d);
        setLoading(false);
    }, [supabase, from, to]);

    useEffect(() => {
        load();
    }, [load]);

    const s = data?.summary;
    const prev = data?.previous;
    const clients: any[] = data?.clients || [];

    const exportClients = () =>
        downloadCSV(
            `clientes_${from}_${to}.csv`,
            ['Cliente', 'Pedidos', 'Ventas sin IVA', 'Participación %', 'Rollos', 'Kg película', 'Último pedido', 'Saldo por cobrar', 'Vencido'],
            clients.map((c) => [
                c.name,
                c.orders,
                Math.round(c.revenue),
                s?.revenue ? ((c.revenue / s.revenue) * 100).toFixed(1) : '0',
                c.rolls,
                Number(c.film_kg).toFixed(2),
                c.last_order,
                Math.round(c.balance),
                Math.round(c.overdue),
            ])
        );

    return (
        <div className="space-y-4">
            {/* Filtros: una fila */}
            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#C8CDC9] bg-white p-3 shadow-sm">
                <div>
                    <label className={LABEL}>Periodo</label>
                    <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className={INPUT}>
                        <option value="month">Este mes</option>
                        <option value="prev">Mes anterior</option>
                        <option value="30">Últimos 30 días</option>
                        <option value="90">Últimos 90 días</option>
                        <option value="year">Este año</option>
                        <option value="custom">Personalizado</option>
                    </select>
                </div>
                {preset === 'custom' && (
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
                <p className="mb-1.5 text-[11px] text-[#949E97]">
                    {from} a {to} · pedidos no cancelados, por fecha de creación · valores sin IVA
                    {prev ? ` · se compara con ${prev.from} a ${prev.to}` : ''}
                </p>
                {loading && <Loader2 className="mb-1.5 h-4 w-4 animate-spin text-[#3F8346]" />}
            </div>

            {!data ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-[#3F8346]" />
                </div>
            ) : (
                <>
                    {/* KPIs */}
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                        <Kpi label="Ventas" value={fmtCOP(s.revenue)} delta={delta(s.revenue, prev?.revenue)} sub={`Con IVA ${fmtCOP(s.total_with_tax)}`} />
                        <Kpi label="Pedidos" value={fmtN(s.orders)} delta={delta(s.orders, prev?.orders)} sub={`Ticket promedio ${fmtCOP(s.avg_ticket)}`} />
                        <Kpi
                            label="Clientes que compraron"
                            value={fmtN(s.active_clients)}
                            delta={delta(s.active_clients, prev?.active_clients)}
                            sub={`${s.new_clients} cliente(s) nuevo(s)`}
                        />
                        <Kpi label="Rollos fabricados" value={fmtN(s.rolls)} sub={`${fmtN(s.film_kg, 1)} kg de película`} />
                        <Kpi
                            label="Stretch / bodega"
                            value={s.revenue > 0 ? `${Math.round((s.stretch_revenue / s.revenue) * 100)}% stretch` : '—'}
                            sub={`Bodega ${fmtCOP(s.products_revenue)}`}
                        />
                        <Kpi label="Cobrado en el periodo" value={fmtCOP(s.collected)} sub={`Cartera abierta ${fmtCOP(s.receivable_open)}`} />
                    </div>

                    <SalesChart series={data.series} />

                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
                        {/* Clientes */}
                        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm xl:col-span-3">
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-sm font-bold text-[#2E4040]">Ventas por cliente</h3>
                                <button
                                    onClick={exportClients}
                                    disabled={clients.length === 0}
                                    className="flex items-center gap-1 rounded-md border border-[#C8CDC9] px-2 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-40"
                                >
                                    <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                                </button>
                            </div>
                            {clients.length === 0 ? (
                                <p className="py-6 text-center text-xs text-[#949E97]">Sin ventas en el periodo.</p>
                            ) : (
                                <>
                                    <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                        <thead className="text-[#949E97]">
                                            <tr className="border-b border-[#C8CDC9]">
                                                <th className="py-1.5 text-left font-semibold">Cliente</th>
                                                <th className="w-[34%] py-1.5 text-left font-semibold">Participación</th>
                                                <th className="py-1.5 text-right font-semibold">Pedidos</th>
                                                <th className="py-1.5 text-right font-semibold">Rollos</th>
                                                <th className="py-1.5 text-right font-semibold">Saldo</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                                            {(showAllClients ? clients : clients.slice(0, 10)).map((c) => {
                                                const share = s.revenue > 0 ? c.revenue / s.revenue : 0;
                                                const maxRev = clients[0]?.revenue || 1;
                                                return (
                                                    <tr key={c.id} title={`${c.name}: ${fmtCOP(c.revenue)} · último pedido ${c.last_order}`}>
                                                        <td className="py-1.5 pr-2">
                                                            <div className="max-w-[200px] truncate font-semibold">{c.name}</div>
                                                            <div className="text-[10px] text-[#949E97]">Último: {c.last_order}</div>
                                                        </td>
                                                        <td className="py-1.5 pr-2">
                                                            <div className="flex items-center gap-2">
                                                                <div className="h-2 flex-1 rounded-full bg-[#C8CDC9]/25">
                                                                    <div
                                                                        className="h-2 rounded-r-[4px]"
                                                                        style={{ width: `${(c.revenue / maxRev) * 100}%`, background: BAR }}
                                                                    />
                                                                </div>
                                                                <span className="w-24 text-right">
                                                                    {fmtShort(c.revenue)} · {(share * 100).toFixed(0)}%
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="py-1.5 text-right">{c.orders}</td>
                                                        <td className="py-1.5 text-right">{fmtN(c.rolls)}</td>
                                                        <td className="py-1.5 text-right">
                                                            {fmtShort(c.balance)}
                                                            {Number(c.overdue) > 0 && (
                                                                <span className="ml-1 inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-700" title={`Vencido ${fmtCOP(c.overdue)}`}>
                                                                    <AlertOctagon className="h-3 w-3" /> vencido
                                                                </span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    {clients.length > 10 && (
                                        <button onClick={() => setShowAllClients((v) => !v)} className="mt-2 text-[11px] font-semibold text-[#3F8346] hover:underline">
                                            {showAllClients ? 'Ver solo los 10 primeros' : `Ver los ${clients.length} clientes`}
                                        </button>
                                    )}
                                </>
                            )}
                        </section>

                        {/* Medidas */}
                        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm xl:col-span-2">
                            <h3 className="mb-2 text-sm font-bold text-[#2E4040]">Rollos por medida</h3>
                            <HBars
                                rows={(data.measures as any[]).map((m) => ({
                                    label: `${fmtN(m.width, 1)} cm`,
                                    value: Number(m.rolls),
                                    display: `${fmtN(m.rolls)} rollos`,
                                    tip: `${fmtN(m.width, 1)} cm: ${fmtN(m.rolls)} rollos · ${fmtN(m.film_kg, 1)} kg · ${fmtCOP(m.revenue)} · ${m.clients} cliente(s)`,
                                }))}
                                empty="Sin rollos en el periodo."
                            />
                            {(data.films as any[]).length > 0 && (
                                <>
                                    <h4 className="mb-1.5 mt-4 text-xs font-bold text-[#2E4040]">Película por tipo</h4>
                                    <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                        <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                                            {(data.films as any[]).map((f) => (
                                                <tr key={f.film}>
                                                    <td className="py-1">{f.film}</td>
                                                    <td className="py-1 text-right">{fmtN(f.rolls)} rollos</td>
                                                    <td className="py-1 text-right font-semibold">{fmtN(f.film_kg, 1)} kg</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </>
                            )}
                        </section>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        {/* Recompra */}
                        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
                            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[#2E4040]">
                                <CalendarClock className="h-4 w-4 text-[#3F8346]" /> Deberían pedir pronto
                            </h3>
                            <p className="mb-2 text-[10px] text-[#949E97]">Según la frecuencia de cada cliente (Pedido habitual). Próximos 7 días o atrasados.</p>
                            {(data.reorder as any[]).length === 0 ? (
                                <p className="py-4 text-center text-xs text-[#949E97]">Nadie por ahora.</p>
                            ) : (
                                <ul className="divide-y divide-[#C8CDC9]/40">
                                    {(data.reorder as any[]).map((r) => {
                                        const late = r.days_left < 0;
                                        return (
                                            <li key={r.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                                                <div className="min-w-0">
                                                    <p className="truncate font-semibold text-[#2E4040]">{r.name}</p>
                                                    <p className="text-[10px] text-[#949E97]">
                                                        Cada {r.reorder_days} días · último {r.last_order}
                                                        {r.template_lines > 0 ? ` · ${r.template_lines} línea(s) habituales` : ''}
                                                    </p>
                                                </div>
                                                <span
                                                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                        late ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'
                                                    }`}
                                                >
                                                    {late ? <AlertOctagon className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                                                    {late ? `Atrasado ${-r.days_left} d` : r.days_left === 0 ? 'Hoy' : `En ${r.days_left} d`}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>

                        {/* Inactivos */}
                        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
                            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-[#2E4040]">
                                <UserX className="h-4 w-4 text-[#949E97]" /> Sin compras en el periodo
                            </h3>
                            <p className="mb-2 text-[10px] text-[#949E97]">Compraron antes pero no en este rango.</p>
                            {(data.inactive as any[]).length === 0 ? (
                                <p className="py-4 text-center text-xs text-[#949E97]">Todos los clientes compraron.</p>
                            ) : (
                                <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                                        {(data.inactive as any[]).map((c) => (
                                            <tr key={c.id}>
                                                <td className="max-w-[150px] truncate py-1.5 font-semibold">{c.name}</td>
                                                <td className="py-1.5 text-right text-[#949E97]">{c.last_order}</td>
                                                <td className="py-1.5 text-right" title="Ventas últimos 12 meses">
                                                    {fmtShort(c.revenue_12m || 0)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>

                        {/* Productos de bodega y estados */}
                        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
                            <h3 className="mb-2 text-sm font-bold text-[#2E4040]">Productos de bodega más vendidos</h3>
                            <HBars
                                rows={(data.products as any[]).map((p) => ({
                                    label: p.name,
                                    value: Number(p.revenue),
                                    display: fmtShort(p.revenue),
                                    tip: `${p.name}: ${fmtN(p.quantity, 2)} ${p.unit} · ${fmtCOP(p.revenue)}`,
                                }))}
                                empty="Sin productos de bodega en el periodo."
                            />
                            <h4 className="mb-1.5 mt-4 text-xs font-bold text-[#2E4040]">Estado de los pedidos del periodo</h4>
                            <div className="flex flex-wrap gap-1.5">
                                {Object.entries(data.status as Record<string, number>).map(([k, v]) => (
                                    <span key={k} className="rounded-full border border-[#C8CDC9] bg-slate-50 px-2 py-0.5 text-[11px] text-[#2E4040]">
                                        {STATUS_LABEL[k] || k}: <b>{v}</b>
                                    </span>
                                ))}
                                {Object.keys(data.status || {}).length === 0 && <span className="text-[11px] text-[#949E97]">Sin pedidos.</span>}
                            </div>
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}

function delta(cur: number, prev?: number) {
    if (prev === undefined || prev === null) return null;
    const p = Number(prev);
    const c = Number(cur);
    if (p === 0) return c > 0 ? { pct: null as number | null, dir: 1 } : { pct: 0, dir: 0 };
    const pct = (c - p) / p;
    return { pct, dir: pct > 0.001 ? 1 : pct < -0.001 ? -1 : 0 };
}

function Kpi({ label, value, sub, delta: d }: { label: string; value: string; sub?: string; delta?: ReturnType<typeof delta> }) {
    return (
        <div className="rounded-xl border border-[#C8CDC9] bg-white p-3.5 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#949E97]">{label}</p>
            <p className="mt-1 text-lg font-bold text-[#2E4040]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </p>
            {d && (
                <p
                    className={`flex items-center gap-0.5 text-[11px] font-semibold ${
                        d.dir > 0 ? 'text-[#3F8346]' : d.dir < 0 ? 'text-red-700' : 'text-[#949E97]'
                    }`}
                >
                    {d.dir > 0 ? <ArrowUpRight className="h-3 w-3" /> : d.dir < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                    {d.pct === null ? 'Nuevo vs. periodo anterior' : `${d.pct > 0 ? '+' : ''}${(d.pct * 100).toFixed(0)}% vs. periodo anterior`}
                </p>
            )}
            {sub && <p className="text-[11px] text-[#949E97]">{sub}</p>}
        </div>
    );
}

/** Barras horizontales de una sola serie (un solo tono), con tooltip nativo */
function HBars({ rows, empty }: { rows: { label: string; value: number; display: string; tip: string }[]; empty: string }) {
    if (rows.length === 0) return <p className="py-4 text-center text-xs text-[#949E97]">{empty}</p>;
    const max = Math.max(...rows.map((r) => r.value), 1);
    return (
        <div className="space-y-1.5">
            {rows.map((r) => (
                <div key={r.label} title={r.tip} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-[11px] text-[#2E4040]">
                    <span className="truncate">{r.label}</span>
                    <div className="h-2.5 rounded-full bg-[#C8CDC9]/25">
                        <div className="h-2.5 rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: BAR }} />
                    </div>
                    <span className="font-semibold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {r.display}
                    </span>
                </div>
            ))}
        </div>
    );
}

/** Ventas en el tiempo: barras verticales (día / semana / mes según el largo del rango) */
function SalesChart({ series }: { series: { date: string; revenue: number; orders: number }[] }) {
    const [hover, setHover] = useState<number | null>(null);
    const [asTable, setAsTable] = useState(false);

    const buckets = useMemo(() => {
        const n = series.length;
        const mode: 'day' | 'week' | 'month' = n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
        const map = new Map<string, { label: string; tip: string; revenue: number; orders: number }>();
        for (const p of series) {
            const d = new Date(p.date + 'T00:00:00');
            let key = p.date;
            let label = d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
            let tip = d.toLocaleDateString('es-CO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            if (mode === 'week') {
                const monday = new Date(d);
                monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
                key = iso(monday);
                label = monday.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
                tip = `Semana del ${monday.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}`;
            } else if (mode === 'month') {
                key = p.date.slice(0, 7);
                label = d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
                tip = d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
            }
            const b = map.get(key) || { label, tip, revenue: 0, orders: 0 };
            b.revenue += Number(p.revenue);
            b.orders += Number(p.orders);
            map.set(key, b);
        }
        return { mode, rows: Array.from(map.values()) };
    }, [series]);

    const rows = buckets.rows;
    const max = Math.max(...rows.map((r) => r.revenue), 1);
    const W = 800;
    const H = 220;
    const padL = 56;
    const padB = 26;
    const padT = 10;
    const plotW = W - padL - 8;
    const plotH = H - padB - padT;
    const slot = plotW / Math.max(rows.length, 1);
    const barW = Math.max(Math.min(slot - 2, 28), 2);
    const ticks = [0, 0.5, 1].map((f) => f * max);
    const labelEvery = Math.ceil(rows.length / 12);
    const total = rows.reduce((a, r) => a + r.revenue, 0);

    return (
        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#2E4040]">
                    Ventas por {buckets.mode === 'day' ? 'día' : buckets.mode === 'week' ? 'semana' : 'mes'}
                    <span className="ml-2 text-xs font-normal text-[#949E97]">Total {fmtCOP(total)}</span>
                </h3>
                <button
                    onClick={() => setAsTable((v) => !v)}
                    className="flex items-center gap-1 rounded-md border border-[#C8CDC9] px-2 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                >
                    <Table2 className="h-3.5 w-3.5" /> {asTable ? 'Ver gráfica' : 'Ver tabla'}
                </button>
            </div>
            {asTable ? (
                <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <thead className="sticky top-0 bg-white text-[#949E97]">
                            <tr className="border-b border-[#C8CDC9]">
                                <th className="py-1 text-left font-semibold">Periodo</th>
                                <th className="py-1 text-right font-semibold">Pedidos</th>
                                <th className="py-1 text-right font-semibold">Ventas</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                            {rows.map((r) => (
                                <tr key={r.tip}>
                                    <td className="py-1">{r.tip}</td>
                                    <td className="py-1 text-right">{r.orders}</td>
                                    <td className="py-1 text-right font-semibold">{fmtCOP(r.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="relative">
                    <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label="Ventas en el periodo">
                        {ticks.map((t, i) => {
                            const y = padT + plotH - (t / max) * plotH;
                            return (
                                <g key={i}>
                                    <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="#C8CDC9" strokeOpacity={i === 0 ? 0.9 : 0.4} strokeWidth={1} />
                                    <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill="#949E97">
                                        {fmtShort(t)}
                                    </text>
                                </g>
                            );
                        })}
                        {rows.map((r, i) => {
                            const h = (r.revenue / max) * plotH;
                            const x = padL + i * slot + (slot - barW) / 2;
                            const y = padT + plotH - h;
                            const rad = Math.min(4, barW / 2, h);
                            return (
                                <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                                    {/* zona de hover más grande que la barra */}
                                    <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
                                    {h > 0 && (
                                        <path
                                            d={`M${x},${padT + plotH} L${x},${y + rad} Q${x},${y} ${x + rad},${y} L${x + barW - rad},${y} Q${x + barW},${y} ${x + barW},${y + rad} L${x + barW},${padT + plotH} Z`}
                                            fill={BAR}
                                            opacity={hover === null || hover === i ? 1 : 0.45}
                                        />
                                    )}
                                    {i % labelEvery === 0 && (
                                        <text x={padL + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#949E97">
                                            {r.label}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                    {hover !== null && rows[hover] && (
                        <div
                            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-[11px] text-[#2E4040] shadow-md"
                            style={{ left: `${((padL + hover * slot + slot / 2) / W) * 100}%` }}
                        >
                            <p className="font-semibold">{rows[hover].tip}</p>
                            <p>
                                {fmtCOP(rows[hover].revenue)} · {rows[hover].orders} pedido(s)
                            </p>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
