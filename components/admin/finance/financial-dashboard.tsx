'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertOctagon,
    AlertTriangle,
    CheckCircle2,
    Info,
    Loader2,
    RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { formatCOP } from '@/components/admin/suppliers/utils';

/** Umbrales de las alertas tempranas (ajustables según la política de la empresa) */
const THRESHOLDS = {
    liquidityCoverageWarn: 1.5, // disponible / obligaciones 15 días
    overdueShareCritical: 0.3, // % de la cartera vencida
    grossMarginWarn: 0.25,
    expenseToSalesWarn: 0.4,
    topClientShareWarn: 0.5,
    dsoWarn: 60,
    salesDropWarn: -0.2,
    reconciliationDays: 35,
    pettyMinShare: 0.2,
};

type Severity = 'critical' | 'warning' | 'info';
type Alert = { severity: Severity; process: string; title: string; detail: string };

const SEVERITY = {
    critical: { label: 'Crítico', icon: AlertOctagon, cls: 'border-red-200 bg-red-50 text-red-900', iconCls: 'text-red-600' },
    warning: { label: 'Atención', icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-900', iconCls: 'text-amber-600' },
    info: { label: 'Aviso', icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-900', iconCls: 'text-sky-600' },
} as const;

const pct = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`;
const ratio = (v: number | null) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(2));
const days = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v} días`);
const n = (v: unknown) => Number(v) || 0;

export default function FinancialDashboard() {
    const [supabase] = useState(() => createClient());
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const { data: d, error } = await supabase.rpc('financial_dashboard');
            if (error) throw error;
            setData(d);
        } catch (err: any) {
            toast.error('No se pudieron calcular los indicadores: ' + (err.message || ''));
        } finally {
            setLoading(false);
        }
    }, [supabase]);

    useEffect(() => {
        load();
    }, [load]);

    // ---------- Indicadores derivados ----------
    const k = useMemo(() => {
        if (!data) return null;
        const cash = n(data.cash.total);
        const ar = n(data.receivables.total);
        const ap = n(data.payables.total);
        const inv = n(data.inventory.total);
        const expPending = n(data.expenses.pending_month) + n(data.expenses.overdue);
        const oblig15 = n(data.payables.due_15) + n(data.expenses.due_15);
        const currentLiab = ap + expPending;
        const pm = data.pnl_month;
        const rev = n(pm.revenue);
        const gross = n(pm.gross_profit);
        const grossMargin = rev > 0 ? gross / rev : null;
        const opMargin = rev > 0 ? n(pm.operating_profit) / rev : null;
        const netMargin = rev > 0 ? n(pm.net_profit) / rev : null;
        const fixed = n(data.expenses.fixed_monthly);
        const breakEven = grossMargin && grossMargin > 0 ? fixed / grossMargin : null;
        const salesMonth = n(data.sales.month);
        const prevSame = n(data.sales.prev_month_same_day);
        const growth = prevSame > 0 ? salesMonth / prevSame - 1 : null;
        const dso = data.activity.dso as number | null;
        const dpo = data.activity.dpo as number | null;
        const dio = data.activity.dio as number | null;
        return {
            cash,
            ar,
            ap,
            inv,
            oblig15,
            coverage: oblig15 > 0 ? cash / oblig15 : null,
            workingCapital: cash + ar + inv - currentLiab,
            currentRatio: currentLiab > 0 ? (cash + ar + inv) / currentLiab : null,
            acidTest: currentLiab > 0 ? (cash + ar) / currentLiab : null,
            rev,
            grossMargin,
            opMargin,
            netMargin,
            fixed,
            breakEven,
            breakEvenProgress: breakEven ? salesMonth / breakEven : null,
            salesMonth,
            growth,
            orders: n(data.sales.orders_month),
            avgTicket: n(data.sales.orders_month) > 0 ? salesMonth / n(data.sales.orders_month) : null,
            expenseToSales: rev > 0 ? n(pm.opex_total) / rev : null,
            overdueShare: ar > 0 ? n(data.receivables.overdue) / ar : null,
            dso,
            dpo,
            dio,
            cashCycle: dso !== null && dio !== null ? dso + dio - (dpo ?? 0) : null,
        };
    }, [data]);

    // ---------- Alertas tempranas ----------
    const alerts = useMemo<Alert[]>(() => {
        if (!data || !k) return [];
        const a: Alert[] = [];
        const T = THRESHOLDS;

        // Liquidez
        if (k.oblig15 > 0 && k.cash < k.oblig15)
            a.push({ severity: 'critical', process: 'Liquidez', title: 'El disponible no cubre las obligaciones de los próximos 15 días', detail: `Disponible ${formatCOP(k.cash)} vs. obligaciones ${formatCOP(k.oblig15)} (proveedores + gastos). Prioriza cobros o reprograma pagos.` });
        else if (k.coverage !== null && k.coverage < T.liquidityCoverageWarn)
            a.push({ severity: 'warning', process: 'Liquidez', title: `Cobertura de liquidez baja (${ratio(k.coverage)}x)`, detail: `El disponible alcanza para ${ratio(k.coverage)} veces los pagos de los próximos 15 días.` });
        for (const name of data.cash.negative_accounts as string[])
            a.push({ severity: 'critical', process: 'Tesorería', title: `${name} con saldo negativo`, detail: 'Revisa movimientos faltantes o un sobregiro.' });
        if (n(data.cash.petty_fund) > 0 && n(data.cash.petty) / n(data.cash.petty_fund) < T.pettyMinShare)
            a.push({ severity: 'warning', process: 'Tesorería', title: 'Caja menor casi agotada', detail: `Quedan ${formatCOP(n(data.cash.petty))} de un fondo de ${formatCOP(n(data.cash.petty_fund))}. Programa el reembolso.` });

        // Cartera
        if (n(data.receivables.overdue) > 0)
            a.push({
                severity: k.overdueShare !== null && k.overdueShare >= T.overdueShareCritical ? 'critical' : 'warning',
                process: 'Cartera',
                title: `Cartera vencida: ${formatCOP(n(data.receivables.overdue))} (${pct(k.overdueShare)} del total)`,
                detail: `${data.receivables.overdue_count} pedido(s) vencidos${n(data.receivables.overdue_30) > 0 ? `; ${formatCOP(n(data.receivables.overdue_30))} con más de 30 días` : ''}. Gestiona el cobro en Cuentas por Cobrar.`,
            });
        for (const c of data.receivables.over_credit as any[])
            a.push({ severity: 'warning', process: 'Cartera', title: `${c.name} supera su cupo de crédito`, detail: `Saldo ${formatCOP(n(c.balance))} vs. cupo ${formatCOP(n(c.limit))}. Evalúa suspender despachos a crédito.` });
        if (k.dso !== null && k.dso > T.dsoWarn)
            a.push({ severity: 'warning', process: 'Cartera', title: `Rotación de cartera lenta (${k.dso} días)`, detail: 'Los clientes tardan más de 60 días en promedio en pagar.' });

        // Proveedores
        if (n(data.payables.overdue) > 0)
            a.push({ severity: 'critical', process: 'Proveedores', title: `Facturas de proveedor vencidas: ${formatCOP(n(data.payables.overdue))}`, detail: `${data.payables.overdue_count} factura(s). Riesgo de suspensión de suministro o intereses.` });
        else if (n(data.payables.due_7) > 0)
            a.push({ severity: 'info', process: 'Proveedores', title: `Vencen ${formatCOP(n(data.payables.due_7))} a proveedores en 7 días`, detail: 'Asegura fondos en banco.' });

        // Gastos
        if (n(data.expenses.overdue) > 0)
            a.push({ severity: 'warning', process: 'Gastos fijos', title: `Gastos fijos vencidos: ${formatCOP(n(data.expenses.overdue))}`, detail: `${data.expenses.overdue_count} pago(s) sin registrar (nómina, arriendo, servicios...).` });
        if (k.expenseToSales !== null && k.expenseToSales > T.expenseToSalesWarn)
            a.push({ severity: 'warning', process: 'Gastos fijos', title: `Gastos operacionales altos: ${pct(k.expenseToSales)} de las ventas del mes`, detail: 'Revisa el estado de resultados por categoría.' });

        // Rentabilidad y ventas
        if (k.rev > 0 && k.netMargin !== null && k.netMargin < 0)
            a.push({ severity: 'critical', process: 'Rentabilidad', title: 'El mes va con pérdida neta', detail: `Margen neto ${pct(k.netMargin, 1)} a la fecha.` });
        if (k.grossMargin !== null && k.grossMargin < T.grossMarginWarn)
            a.push({ severity: 'warning', process: 'Rentabilidad', title: `Margen bruto bajo (${pct(k.grossMargin, 1)})`, detail: 'Revisa precios vs. costo de película, cores y productos.' });
        if (k.breakEven && k.breakEvenProgress !== null && k.breakEvenProgress < 1) {
            const dayOfMonth = new Date().getDate();
            const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
            if (k.breakEvenProgress < dayOfMonth / daysInMonth)
                a.push({ severity: 'warning', process: 'Ventas', title: `Por debajo del ritmo del punto de equilibrio (${pct(k.breakEvenProgress)})`, detail: `Se necesitan ${formatCOP(k.breakEven)} de ventas al mes para cubrir los gastos fijos.` });
        }
        if (k.growth !== null && k.growth < T.salesDropWarn)
            a.push({ severity: 'warning', process: 'Ventas', title: `Ventas ${pct(k.growth)} vs. el mes anterior a la misma fecha`, detail: 'Caída significativa del ritmo comercial.' });
        if (n(data.sales.top_client_share_90) > T.topClientShareWarn && n(data.sales.active_clients_90) > 1)
            a.push({ severity: 'warning', process: 'Ventas', title: `Alta dependencia de un cliente (${pct(n(data.sales.top_client_share_90))})`, detail: `${data.sales.top_client_90} concentra la mayoría de las ventas de 90 días.` });

        // Inventario y producción
        if (n(data.inventory.low_stock) > 0)
            a.push({ severity: 'warning', process: 'Inventario', title: `${data.inventory.low_stock} ítem(s) en o bajo el mínimo`, detail: (data.inventory.low_stock_names as string[]).join(', ') });
        if (n(data.production.late) > 0)
            a.push({ severity: 'critical', process: 'Producción', title: `${data.production.late} pedido(s) atrasados`, detail: 'Fecha de entrega vencida y aún no despachados.' });
        if (n(data.production.due_today) > 0)
            a.push({ severity: 'info', process: 'Producción', title: `${data.production.due_today} pedido(s) se entregan hoy`, detail: 'Verifica que estén listos para despacho.' });

        // Controles de tesorería
        const c = data.controls;
        for (const name of c.cash_accounts_without_closing_yesterday as string[])
            a.push({ severity: 'warning', process: 'Control', title: `${name} sin cierre diario reciente`, detail: 'Haz el arqueo en Caja y Bancos → Cierre diario.' });
        if (n(c.closing_differences_30) > 0)
            a.push({ severity: 'warning', process: 'Control', title: `${c.closing_differences_30} cierre(s) con diferencias en 30 días`, detail: 'Investiga faltantes o sobrantes recurrentes.' });
        if (n(c.egresos_without_support_30) > 0)
            a.push({ severity: 'warning', process: 'Control', title: `${c.egresos_without_support_30} egreso(s) sin soporte en 30 días`, detail: 'Adjunta la factura o comprobante (requisito para deducirlos en renta).' });
        for (const b of c.banks_reconciliation as any[]) {
            const ref = b.last || b.oldest_unreconciled;
            const age = ref ? Math.round((Date.now() - new Date(ref + 'T00:00:00').getTime()) / 86400000) : null;
            if (n(b.unreconciled) > 0 && (age === null || age > T.reconciliationDays))
                a.push({ severity: 'warning', process: 'Control', title: `${b.name} sin conciliar ${b.last ? `desde ${b.last}` : 'nunca'}`, detail: `${b.unreconciled} movimiento(s) pendientes de conciliar con el extracto.` });
        }
        if (n(c.payments_without_account_30) > 0)
            a.push({ severity: 'info', process: 'Control', title: `${c.payments_without_account_30} pago(s) sin cuenta de caja/banco`, detail: 'No se reflejan en tesorería; asígnales cuenta al registrarlos.' });

        const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
        return a.sort((x, y) => order[x.severity] - order[y.severity]);
    }, [data, k]);

    if (loading && !data) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
            </div>
        );
    }
    if (!data || !k) return null;

    const pm = data.pnl_month;
    const pp = data.pnl_prev_month;
    const counts = {
        critical: alerts.filter((x) => x.severity === 'critical').length,
        warning: alerts.filter((x) => x.severity === 'warning').length,
        info: alerts.filter((x) => x.severity === 'info').length,
    };
    const invRows = [
        { label: 'Película (bobinas madre)', value: n(data.inventory.film) },
        { label: 'Cores armados', value: n(data.inventory.cores) },
        { label: 'Material de cores', value: n(data.inventory.core_material) },
        { label: 'Otros inventarios', value: n(data.inventory.items) },
    ];
    const invMax = Math.max(1, ...invRows.map((r) => r.value));

    return (
        <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between">
                <p className="text-xs text-[#949E97]">
                    Calculado {new Date(data.generated_at).toLocaleString('es-CO')} · rentabilidad del mes a la fecha (por fecha de
                    pedido, sin IVA)
                </p>
                <button
                    onClick={load}
                    className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                >
                    <RefreshCw className="h-3.5 w-3.5 text-[#3F8346]" /> Recalcular
                </button>
            </div>

            {/* Alertas tempranas */}
            <section className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#2E4040]">Alertas tempranas</h3>
                    <div className="flex gap-2 text-[11px] font-semibold">
                        {(Object.keys(counts) as Severity[]).map((s) => {
                            const S = SEVERITY[s];
                            return (
                                <span key={s} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${S.cls}`}>
                                    <S.icon className={`h-3 w-3 ${S.iconCls}`} /> {counts[s]} {S.label}
                                </span>
                            );
                        })}
                    </div>
                </div>
                {alerts.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                        <CheckCircle2 className="h-5 w-5" /> Sin alertas: todos los procesos dentro de los parámetros.
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {alerts.map((al, i) => {
                            const S = SEVERITY[al.severity];
                            return (
                                <li key={i} className={`flex gap-2.5 rounded-lg border p-3 ${S.cls}`}>
                                    <S.icon className={`mt-0.5 h-4 w-4 shrink-0 ${S.iconCls}`} />
                                    <div className="text-xs">
                                        <div className="font-bold">
                                            <span className="mr-1 rounded bg-white/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                                {S.label} · {al.process}
                                            </span>
                                            {al.title}
                                        </div>
                                        <div className="mt-0.5 opacity-90">{al.detail}</div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            {/* Indicadores por proceso */}
            <Group title="Liquidez">
                <Tile label="Disponible (caja + bancos)" value={formatCOP(k.cash)} sub={`Bancos ${formatCOP(n(data.cash.banks))} · efectivo ${formatCOP(n(data.cash.cash) + n(data.cash.petty))}`} />
                <Tile label="Obligaciones próximos 15 días" value={formatCOP(k.oblig15)} sub={`Cobertura ${ratio(k.coverage)}x`} />
                <Tile label="Capital de trabajo" value={formatCOP(k.workingCapital)} sub="Disponible + cartera + inventario − pasivos corrientes" />
                <Tile label="Razón corriente / Prueba ácida" value={`${ratio(k.currentRatio)} / ${ratio(k.acidTest)}`} sub="Activo corriente ÷ pasivo corriente (ácida sin inventario)" />
            </Group>

            <Group title="Rentabilidad del mes">
                <Tile label="Ventas del mes (sin IVA)" value={formatCOP(k.salesMonth)} sub={k.growth === null ? 'Sin base comparable' : `${k.growth >= 0 ? '+' : ''}${pct(k.growth)} vs. mes anterior a la fecha`} />
                <Tile label="Margen bruto" value={pct(k.grossMargin, 1)} sub={`Utilidad bruta ${formatCOP(n(pm.gross_profit))}`} />
                <Tile label="Margen operacional / neto" value={`${pct(k.opMargin, 1)} / ${pct(k.netMargin, 1)}`} sub={`Utilidad neta ${formatCOP(n(pm.net_profit))}`} />
                <Tile
                    label="Punto de equilibrio mensual"
                    value={k.breakEven ? formatCOP(k.breakEven) : '—'}
                    sub={k.breakEven ? `Avance ${pct(k.breakEvenProgress)} · gastos fijos ${formatCOP(k.fixed)}` : 'Requiere gastos fijos y margen'}
                    progress={k.breakEvenProgress}
                />
            </Group>

            <Group title="Cartera, proveedores y ciclo de caja">
                <Tile label="Cuentas por cobrar" value={formatCOP(k.ar)} sub={`Vencido ${formatCOP(n(data.receivables.overdue))} (${pct(k.overdueShare)})`} />
                <Tile label="Cuentas por pagar" value={formatCOP(k.ap)} sub={`Vencido ${formatCOP(n(data.payables.overdue))}`} />
                <Tile label="Días cartera / proveedores / inventario" value={`${k.dso ?? '—'} / ${k.dpo ?? '—'} / ${k.dio ?? '—'}`} sub="Base últimos 90 días" />
                <Tile label="Ciclo de conversión de efectivo" value={days(k.cashCycle)} sub="Días cartera + inventario − proveedores" />
            </Group>

            <Group title="Ventas, inventario y producción">
                <Tile label="Pedidos del mes / ticket promedio" value={`${k.orders} / ${k.avgTicket ? formatCOP(k.avgTicket) : '—'}`} sub={`${data.sales.active_clients_90} clientes activos en 90 días`} />
                <Tile label="Cliente principal (90 días)" value={pct(n(data.sales.top_client_share_90))} sub={data.sales.top_client_90 || 'Sin ventas'} />
                <Tile label="Inventario valorizado" value={formatCOP(k.inv)} sub={`${data.inventory.low_stock} ítem(s) bajo mínimo`} />
                <Tile
                    label="Producción"
                    value={`${data.production.queue + data.production.winding} en proceso`}
                    sub={`${data.production.ready} listos · ${data.production.late} atrasados`}
                />
            </Group>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                {/* P&G resumido: mes actual vs anterior */}
                <section className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-[#2E4040]">Resultados: mes actual vs. mes anterior</h3>
                    <table className="w-full text-xs">
                        <thead className="text-[#949E97]">
                            <tr className="border-b border-[#C8CDC9]">
                                <th className="py-1.5 text-left font-semibold">Concepto</th>
                                <th className="py-1.5 text-right font-semibold">Mes a la fecha</th>
                                <th className="py-1.5 text-right font-semibold">Mes anterior</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {[
                                ['Ventas', 'revenue'],
                                ['Costo de ventas', 'cost_sales'],
                                ['Utilidad bruta', 'gross_profit'],
                                ['Gastos operacionales', 'opex_total'],
                                ['Utilidad operacional', 'operating_profit'],
                                ['Utilidad neta (después de renta)', 'net_profit'],
                            ].map(([label, key]) => (
                                <tr key={key} className={key.includes('profit') ? 'font-bold' : ''}>
                                    <td className="py-1.5">{label}</td>
                                    <td className="py-1.5 text-right">{formatCOP(n(pm[key]))}</td>
                                    <td className="py-1.5 text-right text-[#949E97]">{formatCOP(n(pp[key]))}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>

                {/* Composición del inventario: barras de un solo tono + valores en texto */}
                <section className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <h3 className="mb-3 text-sm font-bold text-[#2E4040]">Composición del inventario</h3>
                    <div className="space-y-2.5">
                        {invRows.map((r) => (
                            <div key={r.label} className="text-xs" title={`${r.label}: ${formatCOP(r.value)}`}>
                                <div className="mb-0.5 flex justify-between text-[#2E4040]">
                                    <span>{r.label}</span>
                                    <span className="font-semibold">
                                        {formatCOP(r.value)}
                                        <span className="ml-1 font-normal text-[#949E97]">{k.inv > 0 ? pct(r.value / k.inv) : ''}</span>
                                    </span>
                                </div>
                                <div className="h-2 rounded-full bg-[#EEF1EF]">
                                    <div className="h-2 rounded-full bg-[#3F8346]" style={{ width: `${(r.value / invMax) * 100}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <h3 className="mb-2 mt-5 text-sm font-bold text-[#2E4040]">Saldos por cuenta</h3>
                    <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <tbody className="divide-y divide-[#C8CDC9]/40">
                            {(data.cash.accounts as any[]).map((a) => (
                                <tr key={a.name}>
                                    <td className="py-1.5 text-[#2E4040]">
                                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: a.color }} />
                                        {a.name}
                                    </td>
                                    <td className={`py-1.5 text-right font-semibold ${n(a.balance) < 0 ? 'text-red-700' : 'text-[#2E4040]'}`}>
                                        {formatCOP(n(a.balance))}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            </div>
        </div>
    );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#949E97]">{title}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
        </section>
    );
}

function Tile({ label, value, sub, progress }: { label: string; value: string; sub?: string; progress?: number | null }) {
    return (
        <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-4 shadow-sm">
            <div className="text-[11px] font-semibold text-[#949E97]">{label}</div>
            <div className="mt-1 text-xl font-bold text-[#2E4040]">{value}</div>
            {progress !== undefined && progress !== null && (
                <div className="mt-2 h-1.5 rounded-full bg-[#EEF1EF]">
                    <div className="h-1.5 rounded-full bg-[#3F8346]" style={{ width: `${Math.min(progress, 1) * 100}%` }} />
                </div>
            )}
            {sub && <div className="mt-1 text-[11px] text-[#949E97]">{sub}</div>}
        </div>
    );
}
