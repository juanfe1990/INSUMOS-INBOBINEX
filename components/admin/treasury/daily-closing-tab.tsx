'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Coins, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { DailyClosing, TreasuryAccount } from '@/lib/types';
import { INPUT, LABEL, dbErrorMessage, formatCOP, formatDate, todayISO } from '@/components/admin/suppliers/utils';
import { ACCOUNT_TYPE_SHORT } from './utils';

/** Billetes y monedas en circulación en Colombia */
const DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

export default function DailyClosingTab({
    accounts,
    closings,
    onChanged,
}: {
    accounts: TreasuryAccount[];
    closings: DailyClosing[];
    onChanged: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [accountId, setAccountId] = useState(accounts.find((a) => a.account_type === 'caja_general')?.id || accounts[0]?.id || '');
    const [date, setDate] = useState(todayISO());
    const [counted, setCounted] = useState('');
    const [useDenoms, setUseDenoms] = useState(false);
    const [denoms, setDenoms] = useState<Record<number, string>>({});
    const [adjust, setAdjust] = useState(true);
    const [notes, setNotes] = useState('');
    const [systemBalance, setSystemBalance] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    const account = accounts.find((a) => a.id === accountId) || null;
    const isCash = account?.account_type !== 'banco';

    // Saldo del sistema al final del día elegido
    useEffect(() => {
        if (!account) return;
        setSystemBalance(null);
        supabase
            .from('treasury_movements')
            .select('amount, direction')
            .eq('account_id', account.id)
            .lte('movement_date', date)
            .then(({ data }) => {
                const sum = (data || []).reduce(
                    (s: number, m: any) => s + (m.direction === 'ingreso' ? Number(m.amount) : -Number(m.amount)),
                    0
                );
                setSystemBalance(Number(account.opening_balance) + sum);
            });
    }, [supabase, account, date]);

    const denomTotal = useMemo(
        () => DENOMINATIONS.reduce((s, d) => s + d * (Math.floor(Number(denoms[d])) || 0), 0),
        [denoms]
    );
    const countedValue = useDenoms ? denomTotal : Number(counted) || 0;
    const hasValue = useDenoms ? denomTotal > 0 || Object.values(denoms).some((v) => v !== '') : counted !== '';
    const diff = systemBalance !== null && hasValue ? countedValue - systemBalance : null;

    const save = async () => {
        if (!account || !hasValue) return toast.error('Ingresa el saldo contado');
        try {
            setSaving(true);
            const detail = useDenoms
                ? DENOMINATIONS.filter((d) => Number(denoms[d]) > 0)
                      .map((d) => `${denoms[d]}×${d.toLocaleString('es-CO')}`)
                      .join(', ')
                : '';
            const { data, error } = await supabase.rpc('register_daily_closing', {
                p_account_id: account.id,
                p_date: date,
                p_counted: countedValue,
                p_create_adjustment: adjust,
                p_notes: [notes.trim(), detail].filter(Boolean).join(' · '),
            });
            if (error) throw error;
            const r = (data || {}) as { difference?: number };
            const d = Number(r.difference || 0);
            toast.success(
                d === 0
                    ? `Cierre de ${account.name}: cuadra exacto`
                    : `Cierre registrado con ${d > 0 ? 'sobrante' : 'faltante'} de ${formatCOP(Math.abs(d))}${adjust ? ' (ajustado)' : ''}`
            );
            setCounted('');
            setDenoms({});
            setNotes('');
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo registrar el cierre: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const accName = (id: string) => accounts.find((a) => a.id === id)?.name || 'Cuenta';

    return (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_1fr]">
            <div className="h-fit space-y-3 rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-[#2E4040]">Cierre del día</h3>
                <p className="text-[11px] text-[#949E97]">
                    Efectivo: cuenta lo que hay físicamente en la caja. Banco: escribe el saldo que muestra la banca en línea al
                    final del día.
                </p>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Cuenta</label>
                        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${INPUT} bg-white`}>
                            {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name} ({ACCOUNT_TYPE_SHORT[a.account_type]})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Fecha</label>
                        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                    </div>
                </div>

                <div className="rounded-lg bg-[#F8F9FA] p-3 text-xs">
                    <div className="text-[#949E97]">Saldo según el sistema al cierre del {formatDate(date)}</div>
                    <div className="text-xl font-bold text-[#2E4040]">
                        {systemBalance === null ? <Loader2 className="h-4 w-4 animate-spin" /> : formatCOP(systemBalance)}
                    </div>
                </div>

                {isCash && (
                    <label className="flex items-center gap-2 text-xs font-semibold text-[#2E4040]">
                        <input type="checkbox" checked={useDenoms} onChange={(e) => setUseDenoms(e.target.checked)} className="accent-[#3F8346]" />
                        <Coins className="h-4 w-4 text-[#3F8346]" /> Contar por billetes y monedas
                    </label>
                )}

                {useDenoms && isCash ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {DENOMINATIONS.map((d) => (
                            <div key={d} className="flex items-center gap-2">
                                <span className="w-16 text-right text-[11px] font-semibold text-[#2E4040]">${d.toLocaleString('es-CO')}</span>
                                <span className="text-[10px] text-[#949E97]">×</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={denoms[d] || ''}
                                    onChange={(e) => setDenoms((x) => ({ ...x, [d]: e.target.value }))}
                                    className="w-full rounded border border-[#C8CDC9] px-2 py-1 text-xs"
                                />
                            </div>
                        ))}
                        <div className="col-span-2 mt-1 text-right text-sm font-bold text-[#2E4040]">Total contado: {formatCOP(denomTotal)}</div>
                    </div>
                ) : (
                    <div>
                        <label className={LABEL}>{isCash ? 'Efectivo contado ($)' : 'Saldo en el banco ($)'}</label>
                        <input
                            type="number"
                            value={counted}
                            onChange={(e) => setCounted(e.target.value)}
                            className={`${INPUT} text-sm font-bold`}
                        />
                    </div>
                )}

                {diff !== null && (
                    <div
                        className={`flex items-center gap-2 rounded-lg p-3 text-xs font-semibold ${
                            Math.round(diff) === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                        }`}
                    >
                        {Math.round(diff) === 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                        {Math.round(diff) === 0
                            ? 'Cuadra exacto'
                            : `${diff > 0 ? 'Sobrante' : 'Faltante'} de ${formatCOP(Math.abs(diff))}`}
                    </div>
                )}

                {diff !== null && Math.round(diff) !== 0 && (
                    <label className="flex items-start gap-2 text-xs text-[#2E4040]">
                        <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} className="mt-0.5 accent-[#3F8346]" />
                        <span>
                            Registrar un ajuste por la diferencia para que el saldo del sistema quede igual al real. Si la diferencia
                            es porque falta registrar algo (un pago, un gasto), mejor regístralo y vuelve a cerrar.
                        </span>
                    </label>
                )}

                <div>
                    <label className={LABEL}>Observaciones</label>
                    <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Cierre turno tarde" className={INPUT} />
                </div>
                <button
                    onClick={save}
                    disabled={saving || !hasValue || systemBalance === null}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#3F8346] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Registrar cierre
                </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                        <tr>
                            <th className="px-3 py-2.5">Fecha</th>
                            <th className="px-3 py-2.5">Cuenta</th>
                            <th className="px-3 py-2.5 text-right">Sistema</th>
                            <th className="px-3 py-2.5 text-right">Real</th>
                            <th className="px-3 py-2.5">Resultado</th>
                            <th className="px-3 py-2.5">Observaciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C8CDC9]/40">
                        {closings.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-3 py-10 text-center text-[#949E97]">
                                    Aún no hay cierres registrados.
                                </td>
                            </tr>
                        ) : (
                            closings.map((c) => {
                                const d = Math.round(Number(c.difference));
                                return (
                                    <tr key={c.id}>
                                        <td className="whitespace-nowrap px-3 py-2">{formatDate(c.closing_date)}</td>
                                        <td className="px-3 py-2">{accName(c.account_id)}</td>
                                        <td className="px-3 py-2 text-right">{formatCOP(Number(c.system_balance))}</td>
                                        <td className="px-3 py-2 text-right font-semibold">{formatCOP(Number(c.counted_balance))}</td>
                                        <td className="px-3 py-2">
                                            {d === 0 ? (
                                                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> Cuadra
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                                                    <AlertTriangle className="h-3.5 w-3.5" />
                                                    {d > 0 ? 'Sobrante' : 'Faltante'} {formatCOP(Math.abs(d))}
                                                    {c.adjustment_movement_id ? ' · ajustado' : ''}
                                                </span>
                                            )}
                                        </td>
                                        <td className="max-w-[260px] truncate px-3 py-2 text-[#949E97]" title={c.notes || ''}>
                                            {c.notes || '—'}
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
