'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, HandCoins, Loader2, Scissors, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { CoreAssemblyLabor } from '@/lib/types';
import { downloadCSV, formatCOP } from '@/components/admin/suppliers/utils';

const INPUT =
    'rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const fmtCm = (n: number) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });

type Period = 'q_current' | 'q_prev' | 'month' | 'prev_month' | 'custom';

/** Quincenas de nómina: 1–15 y 16–fin de mes */
function rangeFor(p: Period, from: string, to: string): [string, string] {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    const endOfMonth = (yy: number, mm: number) => new Date(yy, mm + 1, 0);
    if (p === 'q_current') return d <= 15 ? [iso(new Date(y, m, 1)), iso(new Date(y, m, 15))] : [iso(new Date(y, m, 16)), iso(endOfMonth(y, m))];
    if (p === 'q_prev')
        return d <= 15 ? [iso(new Date(y, m - 1, 16)), iso(endOfMonth(y, m - 1))] : [iso(new Date(y, m, 1)), iso(new Date(y, m, 15))];
    if (p === 'month') return [iso(new Date(y, m, 1)), iso(endOfMonth(y, m))];
    if (p === 'prev_month') return [iso(new Date(y, m - 1, 1)), iso(endOfMonth(y, m - 1))];
    return [from, to];
}

/**
 * Mano de obra de cores por periodo: lo que corresponde pagar por ARMADO y por
 * CORTE DE CARTÓN (registrado en cada armado, tabla core_assembly_labor).
 * El pago en sí se registra en Gastos (Nómina) o Caja menor.
 */
export default function CoreLaborSummary({ refreshKey }: { refreshKey?: number }) {
    const [supabase] = useState(() => createClient());
    const [period, setPeriod] = useState<Period>('q_current');
    const [customFrom, setCustomFrom] = useState(iso(new Date()));
    const [customTo, setCustomTo] = useState(iso(new Date()));
    const [rows, setRows] = useState<CoreAssemblyLabor[]>([]);
    const [loading, setLoading] = useState(true);
    const [from, to] = rangeFor(period, customFrom, customTo);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('core_assembly_labor')
            .select('*, creator:profiles(full_name)')
            .gte('assembly_date', from)
            .lte('assembly_date', to)
            .order('assembly_date', { ascending: false })
            .order('created_at', { ascending: false });
        if (error) toast.error('No se pudo cargar la mano de obra: ' + error.message);
        setRows((data || []) as unknown as CoreAssemblyLabor[]);
        setLoading(false);
    }, [supabase, from, to]);

    useEffect(() => {
        load();
    }, [load, refreshKey]);

    const totals = useMemo(() => {
        const t = { units: 0, assembly: 0, cut: 0, cutUnits: 0 };
        const byCore = new Map<string, { name: string; length: number; units: number; assembly: number; cutUnits: number; cut: number }>();
        for (const r of rows) {
            t.units += r.units;
            t.assembly += Number(r.assembly_total);
            t.cut += Number(r.cardboard_cut_total);
            if (r.has_cardboard_part) t.cutUnits += r.units;
            const k = `${r.core_name}|${r.length_cm}`;
            const b = byCore.get(k) || { name: r.core_name, length: Number(r.length_cm), units: 0, assembly: 0, cutUnits: 0, cut: 0 };
            b.units += r.units;
            b.assembly += Number(r.assembly_total);
            if (r.has_cardboard_part) b.cutUnits += r.units;
            b.cut += Number(r.cardboard_cut_total);
            byCore.set(k, b);
        }
        return { ...t, byCore: Array.from(byCore.values()).sort((a, b) => a.length - b.length) };
    }, [rows]);

    const exportCSV = () =>
        downloadCSV(
            `mano_obra_cores_${from}_${to}.csv`,
            ['Fecha', 'Medida', 'Cm', 'Cores', 'Armado c/u', 'Total armado', 'Lleva cartón', 'Corte cartón c/u', 'Total corte cartón', 'Registró', 'Notas'],
            rows.map((r) => [
                r.assembly_date,
                r.core_name,
                fmtCm(r.length_cm),
                r.units,
                Math.round(Number(r.assembly_cost_per_unit)),
                Math.round(Number(r.assembly_total)),
                r.has_cardboard_part ? 'Sí' : 'No',
                Math.round(Number(r.cardboard_cut_cost_per_unit)),
                Math.round(Number(r.cardboard_cut_total)),
                r.creator?.full_name || '',
                r.notes || '',
            ])
        );

    return (
        <section className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-[#2E4040]">
                        <HandCoins className="h-4 w-4 text-[#3F8346]" /> 3. Mano de obra por pagar
                    </h3>
                    <p className="text-[11px] text-[#949E97]">
                        Lo causado en cada armado, separado por oficio. Regístralo luego como pago en Gastos (Nómina) o Caja menor.
                    </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <div>
                        <label className={LABEL}>Periodo</label>
                        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={INPUT}>
                            <option value="q_current">Quincena actual</option>
                            <option value="q_prev">Quincena anterior</option>
                            <option value="month">Este mes</option>
                            <option value="prev_month">Mes anterior</option>
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
                    <button
                        onClick={exportCSV}
                        disabled={rows.length === 0}
                        className="flex items-center gap-1 rounded-md border border-[#C8CDC9] px-2.5 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-40"
                    >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                    </button>
                </div>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-[#C8CDC9] p-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-[#949E97]">
                        <Wrench className="h-3 w-3" /> Armado
                    </p>
                    <p className="text-lg font-bold text-[#2E4040]">{formatCOP(totals.assembly)}</p>
                    <p className="text-[11px] text-[#949E97]">{totals.units.toLocaleString('es-CO')} cores armados</p>
                </div>
                <div className="rounded-lg border border-[#C8CDC9] p-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase text-[#949E97]">
                        <Scissors className="h-3 w-3" /> Corte de cartón
                    </p>
                    <p className="text-lg font-bold text-[#2E4040]">{formatCOP(totals.cut)}</p>
                    <p className="text-[11px] text-[#949E97]">{totals.cutUnits.toLocaleString('es-CO')} cores con parte de cartón</p>
                </div>
                <div className="rounded-lg border border-[#3F8346]/40 bg-[#3F8346]/5 p-3">
                    <p className="text-[10px] font-semibold uppercase text-[#949E97]">Total mano de obra</p>
                    <p className="text-lg font-bold text-[#2E4040]">{formatCOP(totals.assembly + totals.cut)}</p>
                    <p className="text-[11px] text-[#949E97]">
                        {from} a {to}
                    </p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-[#3F8346]" />
                </div>
            ) : rows.length === 0 ? (
                <p className="py-4 text-center text-xs text-[#949E97]">No hay armados registrados en este periodo.</p>
            ) : (
                <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <thead className="text-[#949E97]">
                        <tr className="border-b border-[#C8CDC9]">
                            <th className="py-1.5 text-left font-semibold">Medida</th>
                            <th className="py-1.5 text-right font-semibold">Cores</th>
                            <th className="py-1.5 text-right font-semibold">Armado</th>
                            <th className="py-1.5 text-right font-semibold">Corte de cartón</th>
                            <th className="py-1.5 text-right font-semibold">Total</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                        {totals.byCore.map((b) => (
                            <tr key={`${b.name}|${b.length}`}>
                                <td className="py-1.5">
                                    <span className="font-semibold">{fmtCm(b.length)} cm</span> <span className="text-[#949E97]">{b.name}</span>
                                </td>
                                <td className="py-1.5 text-right">{b.units.toLocaleString('es-CO')}</td>
                                <td className="py-1.5 text-right">{formatCOP(b.assembly)}</td>
                                <td className="py-1.5 text-right">
                                    {b.cutUnits > 0 ? `${formatCOP(b.cut)} (${b.cutUnits} und)` : '—'}
                                </td>
                                <td className="py-1.5 text-right font-semibold">{formatCOP(b.assembly + b.cut)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}
