'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Landmark, Loader2, Plus, RotateCcw, Scale } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { BankReconciliation, TreasuryAccount, TreasuryMovement } from '@/lib/types';
import { INPUT, LABEL, dbErrorMessage, formatCOP, formatDate, todayISO } from '@/components/admin/suppliers/utils';
import { MOVEMENT_LABELS, signedAmount } from './utils';

/**
 * Conciliación bancaria: el saldo del extracto debe ser igual al saldo inicial +
 * movimientos ya conciliados + los que se marquen ahora. Lo no marcado queda como
 * partida en tránsito (cheques no cobrados, consignaciones aún no reflejadas, etc.).
 */
export default function ReconciliationTab({ accounts, onChanged }: { accounts: TreasuryAccount[]; onChanged: () => void }) {
    const [supabase] = useState(() => createClient());
    const [confirmDialog, confirm] = useConfirm();
    const [accountId, setAccountId] = useState(accounts[0]?.id || '');
    const [statementDate, setStatementDate] = useState(todayISO());
    const [statementBalance, setStatementBalance] = useState('');
    const [pending, setPending] = useState<TreasuryMovement[]>([]);
    const [reconciledSum, setReconciledSum] = useState(0);
    const [history, setHistory] = useState<BankReconciliation[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notes, setNotes] = useState('');
    const [quick, setQuick] = useState<null | 'gasto' | 'ingreso'>(null);
    const [quickAmount, setQuickAmount] = useState('');
    const [quickDesc, setQuickDesc] = useState('');

    const account = accounts.find((a) => a.id === accountId) || null;

    const load = useCallback(async () => {
        if (!accountId) return;
        setLoading(true);
        const [pRes, rRes, hRes] = await Promise.all([
            supabase
                .from('treasury_movements')
                .select('*')
                .eq('account_id', accountId)
                .eq('reconciled', false)
                .lte('movement_date', statementDate)
                .order('movement_date'),
            supabase.from('treasury_movements').select('amount, direction').eq('account_id', accountId).eq('reconciled', true),
            supabase.from('bank_reconciliations').select('*').eq('account_id', accountId).order('created_at', { ascending: false }),
        ]);
        const list = (pRes.data || []) as TreasuryMovement[];
        setPending(list);
        // Por defecto se marcan todos: el usuario desmarca lo que NO aparece en el extracto
        setSelected(new Set(list.map((m) => m.id)));
        setReconciledSum((rRes.data || []).reduce((s: number, m: any) => s + signedAmount(m.direction, m.amount), 0));
        setHistory((hRes.data || []) as BankReconciliation[]);
        setLoading(false);
    }, [supabase, accountId, statementDate]);

    useEffect(() => {
        load();
    }, [load]);

    const previous = Number(account?.opening_balance || 0) + reconciledSum;
    const selectedSum = useMemo(
        () => pending.filter((m) => selected.has(m.id)).reduce((s, m) => s + signedAmount(m.direction, m.amount), 0),
        [pending, selected]
    );
    const book = previous + selectedSum;
    const hasStatement = statementBalance !== '';
    const diff = hasStatement ? Number(statementBalance) - book : null;
    const balanced = diff !== null && Math.round(diff) === 0;
    const inTransit = pending.filter((m) => !selected.has(m.id));

    const toggle = (id: string) =>
        setSelected((s) => {
            const n = new Set(s);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });

    const close = async () => {
        if (!account || !balanced) return;
        try {
            setSaving(true);
            const { error } = await supabase.rpc('close_bank_reconciliation', {
                p_account_id: account.id,
                p_statement_date: statementDate,
                p_statement_balance: Number(statementBalance),
                p_movement_ids: [...selected],
                ...(notes.trim() ? { p_notes: notes.trim() } : {}),
            });
            if (error) throw error;
            toast.success(`Conciliación de ${account.name} al ${formatDate(statementDate)} cerrada`);
            setStatementBalance('');
            setNotes('');
            load();
            onChanged();
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const undo = async (r: BankReconciliation) => {
        const ok = await confirm({
            title: '¿Deshacer esta conciliación?',
            description: `Los ${r.movements_count} movimientos del ${formatDate(r.statement_date)} vuelven a quedar sin conciliar.`,
            confirmLabel: 'Deshacer',
        });
        if (!ok) return;
        const { error } = await supabase.rpc('undo_bank_reconciliation', { p_reconciliation_id: r.id });
        if (error) return toast.error(dbErrorMessage(error));
        toast.success('Conciliación deshecha');
        load();
        onChanged();
    };

    // Partidas del extracto que faltan en libros: gastos bancarios / GMF o ingresos (intereses)
    const saveQuick = async () => {
        if (!account || !quick) return;
        const value = Number(quickAmount);
        if (!(value > 0)) return toast.error('Ingresa el valor');
        try {
            if (quick === 'gasto') {
                const { data: cat } = await supabase.from('expense_categories').select('id').eq('name', 'Gastos bancarios y GMF').maybeSingle();
                if (!cat) throw new Error('Falta la categoría "Gastos bancarios y GMF"');
                const { error } = await supabase.from('expenses').insert({
                    category_id: cat.id,
                    description: quickDesc.trim() || 'Gastos bancarios / 4x1000',
                    payee_name: account.bank_name || account.name,
                    period_month: statementDate.slice(0, 7) + '-01',
                    due_date: statementDate,
                    amount: value,
                    status: 'pagado',
                    paid_date: statementDate,
                    payment_method: 'transferencia',
                    account_id: account.id,
                    notes: 'Registrado desde conciliación bancaria',
                });
                if (error) throw error;
            } else {
                const { error } = await supabase.rpc('register_treasury_movement', {
                    p_account_id: account.id,
                    p_direction: 'ingreso',
                    p_type: 'otro_ingreso',
                    p_amount: value,
                    p_date: statementDate,
                    p_description: quickDesc.trim() || 'Rendimientos financieros',
                    p_third_party: account.bank_name || account.name,
                });
                if (error) throw error;
            }
            toast.success('Partida registrada');
            setQuick(null);
            setQuickAmount('');
            setQuickDesc('');
            load();
            onChanged();
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        }
    };

    if (accounts.length === 0) {
        return (
            <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                <Landmark className="mx-auto h-10 w-10 text-[#949E97]" />
                <p className="mt-2 text-sm text-[#949E97]">Crea primero una cuenta bancaria con &quot;Nueva cuenta&quot;.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {confirmDialog}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_1fr]">
                {/* Datos del extracto + cuadre */}
                <div className="h-fit space-y-3 rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <h3 className="flex items-center gap-2 text-sm font-bold text-[#2E4040]">
                        <Scale className="h-4 w-4 text-[#3F8346]" /> Datos del extracto
                    </h3>
                    <div>
                        <label className={LABEL}>Cuenta bancaria</label>
                        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${INPUT} bg-white`}>
                            {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={LABEL}>Fecha de corte</label>
                            <input type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} className={INPUT} />
                        </div>
                        <div>
                            <label className={LABEL}>Saldo del extracto ($)</label>
                            <input
                                type="number"
                                value={statementBalance}
                                onChange={(e) => setStatementBalance(e.target.value)}
                                className={`${INPUT} font-bold`}
                            />
                        </div>
                    </div>

                    <div className="space-y-1 rounded-lg bg-[#F8F9FA] p-3 text-xs">
                        <Row label="Saldo conciliado anterior" value={previous} />
                        <Row label={`+ Movimientos marcados (${selected.size})`} value={selectedSum} />
                        <div className="border-t border-[#C8CDC9] pt-1">
                            <Row label="Saldo en libros a conciliar" value={book} strong />
                        </div>
                        {hasStatement && <Row label="Saldo del extracto" value={Number(statementBalance)} />}
                    </div>

                    {diff !== null && (
                        <div
                            className={`flex items-center gap-2 rounded-lg p-3 text-xs font-semibold ${
                                balanced ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
                            }`}
                        >
                            {balanced ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                            {balanced ? 'Cuadra: puedes cerrar la conciliación' : `Diferencia: ${formatCOP(diff)}`}
                        </div>
                    )}
                    {diff !== null && !balanced && (
                        <p className="text-[11px] text-[#949E97]">
                            Revisa qué movimientos no aparecen en el extracto (desmárcalos) y registra lo que el banco cobró o pagó y
                            no está en el sistema:
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setQuick('gasto')}
                            className="flex flex-1 items-center justify-center gap-1 rounded border border-[#C8CDC9] px-2 py-1.5 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                        >
                            <Plus className="h-3 w-3" /> Gasto bancario / 4x1000
                        </button>
                        <button
                            onClick={() => setQuick('ingreso')}
                            className="flex flex-1 items-center justify-center gap-1 rounded border border-[#C8CDC9] px-2 py-1.5 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                        >
                            <Plus className="h-3 w-3" /> Intereses / ingreso
                        </button>
                    </div>
                    {quick && (
                        <div className="space-y-2 rounded-lg border border-[#C8CDC9] p-3">
                            <div className="text-xs font-semibold text-[#2E4040]">
                                {quick === 'gasto' ? 'Gasto cobrado por el banco' : 'Ingreso abonado por el banco'}
                            </div>
                            <input
                                value={quickDesc}
                                onChange={(e) => setQuickDesc(e.target.value)}
                                placeholder={quick === 'gasto' ? 'Ej: GMF 4x1000 octubre' : 'Ej: Intereses cuenta de ahorros'}
                                className={INPUT}
                            />
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    value={quickAmount}
                                    onChange={(e) => setQuickAmount(e.target.value)}
                                    placeholder="Valor"
                                    className={INPUT}
                                />
                                <button onClick={saveQuick} className="rounded bg-[#3F8346] px-3 text-xs font-semibold text-white">
                                    Registrar
                                </button>
                                <button onClick={() => setQuick(null)} className="rounded border border-[#C8CDC9] px-3 text-xs">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}
                    <div>
                        <label className={LABEL}>Notas</label>
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Extracto de octubre" className={INPUT} />
                    </div>
                    <button
                        onClick={close}
                        disabled={!balanced || saving}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#3F8346] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        Cerrar conciliación
                    </button>
                </div>

                {/* Movimientos por conciliar */}
                <div className="space-y-3">
                    <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] bg-[#F8F9FA] px-3 py-2">
                            <span className="text-xs font-bold text-[#2E4040]">
                                Movimientos sin conciliar hasta el {formatDate(statementDate)} ({pending.length})
                            </span>
                            <div className="flex gap-2 text-[11px]">
                                <button onClick={() => setSelected(new Set(pending.map((m) => m.id)))} className="font-semibold text-[#3F8346] hover:underline">
                                    Marcar todos
                                </button>
                                <button onClick={() => setSelected(new Set())} className="font-semibold text-[#949E97] hover:underline">
                                    Ninguno
                                </button>
                            </div>
                        </div>
                        {loading ? (
                            <div className="flex justify-center py-10">
                                <Loader2 className="h-6 w-6 animate-spin text-[#3F8346]" />
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs">
                                <thead className="text-[#2E4040]">
                                    <tr className="border-b border-[#C8CDC9]/60">
                                        <th className="w-10 px-3 py-2">Está</th>
                                        <th className="px-3 py-2">Fecha</th>
                                        <th className="px-3 py-2">Movimiento</th>
                                        <th className="px-3 py-2 text-right">Valor</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/40">
                                    {pending.length === 0 ? (
                                        <tr>
                                            <td colSpan={4} className="px-3 py-10 text-center text-[#949E97]">
                                                No hay movimientos pendientes de conciliar.
                                            </td>
                                        </tr>
                                    ) : (
                                        pending.map((m) => (
                                            <tr
                                                key={m.id}
                                                onClick={() => toggle(m.id)}
                                                className={`cursor-pointer hover:bg-[#F9FBFA] ${selected.has(m.id) ? '' : 'bg-amber-50/50'}`}
                                            >
                                                <td className="px-3 py-2">
                                                    <input type="checkbox" checked={selected.has(m.id)} readOnly className="accent-[#3F8346]" />
                                                </td>
                                                <td className="whitespace-nowrap px-3 py-2">{formatDate(m.movement_date)}</td>
                                                <td className="px-3 py-2">
                                                    <div className="font-semibold text-[#2E4040]">{m.description}</div>
                                                    <div className="text-[10px] text-[#949E97]">
                                                        {MOVEMENT_LABELS[m.movement_type]}
                                                        {m.third_party ? ` · ${m.third_party}` : ''}
                                                        {m.reference ? ` · Ref. ${m.reference}` : ''}
                                                    </div>
                                                </td>
                                                <td
                                                    className={`px-3 py-2 text-right font-semibold ${
                                                        m.direction === 'ingreso' ? 'text-emerald-700' : 'text-[#2E4040]'
                                                    }`}
                                                >
                                                    {m.direction === 'ingreso' ? '+' : '−'}
                                                    {formatCOP(Number(m.amount))}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>
                    {inTransit.length > 0 && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
                            <b>Partidas en tránsito ({inTransit.length}):</b> quedarán pendientes para la próxima conciliación (ej:
                            cheques girados no cobrados o consignaciones aún no reflejadas).
                        </div>
                    )}

                    {/* Historial */}
                    <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                        <div className="border-b border-[#C8CDC9] bg-[#F8F9FA] px-3 py-2 text-xs font-bold text-[#2E4040]">
                            Conciliaciones cerradas
                        </div>
                        <table className="w-full text-left text-xs">
                            <tbody className="divide-y divide-[#C8CDC9]/40">
                                {history.length === 0 ? (
                                    <tr>
                                        <td className="px-3 py-6 text-center text-[#949E97]">Aún no hay conciliaciones para esta cuenta.</td>
                                    </tr>
                                ) : (
                                    history.map((r, i) => (
                                        <tr key={r.id}>
                                            <td className="px-3 py-2 font-semibold text-[#2E4040]">Corte {formatDate(r.statement_date)}</td>
                                            <td className="px-3 py-2">Saldo {formatCOP(Number(r.statement_balance))}</td>
                                            <td className="px-3 py-2 text-[#949E97]">{r.movements_count} movimientos</td>
                                            <td className="px-3 py-2 text-[#949E97]">{r.notes || ''}</td>
                                            <td className="px-3 py-2 text-right">
                                                {i === 0 && (
                                                    <button
                                                        onClick={() => undo(r)}
                                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#949E97] hover:text-red-600"
                                                    >
                                                        <RotateCcw className="h-3 w-3" /> Deshacer
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
    return (
        <div className={`flex justify-between ${strong ? 'font-bold text-[#2E4040]' : 'text-[#2E4040]'}`}>
            <span className={strong ? '' : 'text-[#949E97]'}>{label}</span>
            <span>{formatCOP(value)}</span>
        </div>
    );
}
