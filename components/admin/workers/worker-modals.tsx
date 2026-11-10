'use client';

import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { PaymentMethod, TreasuryAccount, Worker, WorkerEarning, WorkerEarningKind, WorkerType } from '@/lib/types';
import AccountSelect, { suggestAccount } from '@/components/admin/treasury/account-select';
import { INPUT, LABEL, METHOD_LABELS, dbErrorMessage, formatCOP, todayISO } from '@/components/admin/suppliers/utils';
import WorkerSplitEditor, { splitSum, type WorkerSplit } from './worker-split-editor';

export const WORK_TYPE_LABEL: Record<WorkerType, string> = {
    cores: 'Cores (armado / corte)',
    servicios: 'Prestación de servicios',
    ambos: 'Cores y servicios',
};
export const KIND_LABEL: Record<WorkerEarningKind, string> = {
    armado: 'Armado',
    corte_carton: 'Corte de cartón',
    servicio: 'Servicio',
};

function Shell({ title, subtitle, onClose, children, wide }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className={`max-h-[92vh] w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl`}>
                <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-base font-bold text-[#2E4040]">{title}</h3>
                        {subtitle && <p className="text-[11px] text-[#949E97]">{subtitle}</p>}
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30" aria-label="Cerrar">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="px-6 py-5">{children}</div>
            </div>
        </div>
    );
}

function Footer({ onClose, saving, label, disabled }: { onClose: () => void; saving: boolean; label: string; disabled?: boolean }) {
    return (
        <div className="flex justify-end gap-2 border-t border-[#C8CDC9] pt-3">
            <button type="button" onClick={onClose} className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20">
                Cancelar
            </button>
            <button
                type="submit"
                disabled={saving || disabled}
                className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
            >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {label}
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Persona: crear / editar
// ---------------------------------------------------------------------------
export function WorkerFormModal({ worker, onClose, onSaved }: { worker: Worker | null; onClose: () => void; onSaved: () => void }) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const [f, setF] = useState({
        full_name: worker?.full_name || '',
        document_id: worker?.document_id || '',
        phone: worker?.phone || '',
        work_type: (worker?.work_type || 'cores') as WorkerType,
        bank_name: worker?.bank_name || '',
        bank_account: worker?.bank_account || '',
        notes: worker?.notes || '',
    });
    const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!f.full_name.trim()) return toast.error('Escribe el nombre');
        const payload = {
            full_name: f.full_name.trim(),
            document_id: f.document_id.trim() || null,
            phone: f.phone.trim() || null,
            work_type: f.work_type,
            bank_name: f.bank_name.trim() || null,
            bank_account: f.bank_account.trim() || null,
            notes: f.notes.trim() || null,
            updated_at: new Date().toISOString(),
        };
        setSaving(true);
        const { data, error } = worker
            ? await supabase.from('workers').update(payload).eq('id', worker.id).select('id')
            : await supabase.from('workers').insert(payload).select('id');
        setSaving(false);
        if (error) return toast.error(error.code === '23505' ? 'Ya existe una persona con ese documento' : 'No se pudo guardar: ' + error.message);
        if (!data?.length) return toast.error('Solo un administrador puede gestionar trabajadores');
        toast.success(worker ? 'Persona actualizada' : `${payload.full_name} agregado(a)`);
        onSaved();
    };

    return (
        <Shell title={worker ? `Editar ${worker.full_name}` : 'Nueva persona'} onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className={LABEL}>Nombre completo *</label>
                        <input value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>Cédula / NIT</label>
                        <input value={f.document_id} onChange={(e) => set({ document_id: e.target.value })} className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>Teléfono</label>
                        <input value={f.phone} onChange={(e) => set({ phone: e.target.value })} className={INPUT} />
                    </div>
                    <div className="col-span-2">
                        <label className={LABEL}>Tipo de trabajo</label>
                        <select value={f.work_type} onChange={(e) => set({ work_type: e.target.value as WorkerType })} className={`${INPUT} bg-white`}>
                            {Object.entries(WORK_TYPE_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Banco / billetera</label>
                        <input value={f.bank_name} onChange={(e) => set({ bank_name: e.target.value })} placeholder="Ej: Nequi, Bancolombia" className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>N.º de cuenta / celular</label>
                        <input value={f.bank_account} onChange={(e) => set({ bank_account: e.target.value })} className={INPUT} />
                    </div>
                    <div className="col-span-2">
                        <label className={LABEL}>Notas</label>
                        <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} className={INPUT} />
                    </div>
                </div>
                <Footer onClose={onClose} saving={saving} label={worker ? 'Guardar' : 'Agregar persona'} />
            </form>
        </Shell>
    );
}

// ---------------------------------------------------------------------------
// Registrar trabajo manual (servicios u otros)
// ---------------------------------------------------------------------------
export function EarningFormModal({ workers, onClose, onSaved }: { workers: Worker[]; onClose: () => void; onSaved: () => void }) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const [workerId, setWorkerId] = useState(workers[0]?.id || '');
    const [kind, setKind] = useState<WorkerEarningKind>('servicio');
    const [date, setDate] = useState(todayISO());
    const [description, setDescription] = useState('');
    const [byUnits, setByUnits] = useState(false);
    const [units, setUnits] = useState('');
    const [rate, setRate] = useState('');
    const [amount, setAmount] = useState('');
    const total = byUnits ? (Number(units) || 0) * (Number(rate) || 0) : Number(amount) || 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!workerId) return toast.error('Elige la persona');
        if (!description.trim()) return toast.error('Describe el trabajo');
        if (!(total > 0)) return toast.error('El valor debe ser mayor a 0');
        setSaving(true);
        const { error } = await supabase.rpc('add_worker_earning', {
            p_worker_id: workerId,
            p_date: date,
            p_kind: kind,
            p_description: description.trim(),
            p_amount: total,
            ...(byUnits ? { p_units: Number(units), p_rate: Number(rate) } : {}),
        });
        setSaving(false);
        if (error) return toast.error('No se pudo registrar: ' + dbErrorMessage(error));
        toast.success(`Trabajo registrado: ${formatCOP(total)} por pagar`);
        onSaved();
    };

    return (
        <Shell title="Registrar trabajo" subtitle="Servicios u otros trabajos por pagar (el armado de cores se registra solo al armar)." onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                        <label className={LABEL}>Persona *</label>
                        <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={`${INPUT} bg-white font-semibold`}>
                            {workers.map((w) => (
                                <option key={w.id} value={w.id}>
                                    {w.full_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Tipo</label>
                        <select value={kind} onChange={(e) => setKind(e.target.value as WorkerEarningKind)} className={`${INPUT} bg-white`}>
                            {Object.entries(KIND_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Fecha del trabajo</label>
                        <input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                    </div>
                    <div className="col-span-2">
                        <label className={LABEL}>Descripción *</label>
                        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: Cargue de camión, limpieza de bodega" className={INPUT} />
                    </div>
                    <label className="col-span-2 flex items-center gap-2 text-xs font-semibold text-[#2E4040]">
                        <input type="checkbox" checked={byUnits} onChange={(e) => setByUnits(e.target.checked)} className="accent-[#3F8346]" />
                        Calcular por cantidad × valor unitario
                    </label>
                    {byUnits ? (
                        <>
                            <div>
                                <label className={LABEL}>Cantidad</label>
                                <input type="number" min="0" step="any" value={units} onChange={(e) => setUnits(e.target.value)} className={INPUT} />
                            </div>
                            <div>
                                <label className={LABEL}>Valor unitario ($)</label>
                                <input type="number" min="0" step="1" value={rate} onChange={(e) => setRate(e.target.value)} className={INPUT} />
                            </div>
                        </>
                    ) : (
                        <div className="col-span-2">
                            <label className={LABEL}>Valor a pagar ($) *</label>
                            <input type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${INPUT} text-sm font-bold`} />
                        </div>
                    )}
                </div>
                <p className="text-xs text-[#2E4040]">
                    Total: <b>{formatCOP(total)}</b>
                </p>
                <Footer onClose={onClose} saving={saving} label="Registrar" />
            </form>
        </Shell>
    );
}

// ---------------------------------------------------------------------------
// Asignar / repartir una línea por pagar
// ---------------------------------------------------------------------------
export function AssignEarningModal({
    earning,
    workers,
    onClose,
    onSaved,
}: {
    earning: WorkerEarning;
    workers: Worker[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const byUnits = earning.units != null;
    const total = byUnits ? Number(earning.units) : Math.round(Number(earning.amount));
    const [split, setSplit] = useState<WorkerSplit[]>(
        earning.worker_id ? [{ worker_id: earning.worker_id, value: String(total) }] : []
    );
    const valid = split.length > 0 && splitSum(split) === total && split.every((s) => Number(s.value) > 0);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return toast.error(`Reparte exactamente ${total} ${byUnits ? 'cores' : 'pesos'} entre las personas`);
        setSaving(true);
        const { error } = await supabase.rpc('reassign_worker_earning', {
            p_id: earning.id,
            p_splits: split.map((s) => (byUnits ? { worker_id: s.worker_id, units: Number(s.value) } : { worker_id: s.worker_id, amount: Number(s.value) })),
        });
        setSaving(false);
        if (error) return toast.error('No se pudo asignar: ' + dbErrorMessage(error));
        toast.success('Trabajo asignado');
        onSaved();
    };

    return (
        <Shell title={earning.worker_id ? 'Reasignar trabajo' : 'Asignar trabajo'} subtitle={`${earning.description} · ${formatCOP(Number(earning.amount))}`} onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <WorkerSplitEditor
                    workers={workers}
                    total={total}
                    value={split}
                    onChange={setSplit}
                    unitLabel={byUnits ? 'cores' : '$'}
                    rate={byUnits ? Number(earning.rate || 0) : undefined}
                    title="¿Quién hizo este trabajo?"
                />
                <Footer onClose={onClose} saving={saving} label="Asignar" disabled={!valid} />
            </form>
        </Shell>
    );
}

// ---------------------------------------------------------------------------
// Pagar lo seleccionado (dividido por persona)
// ---------------------------------------------------------------------------
export function PayEarningsModal({
    earnings,
    workers,
    onClose,
    onPaid,
}: {
    earnings: WorkerEarning[];
    workers: Worker[];
    onClose: () => void;
    onPaid: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const [accountId, setAccountId] = useState('');
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
    const [method, setMethod] = useState<PaymentMethod>('efectivo');
    const [date, setDate] = useState(todayISO());
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');

    const byWorker = useMemo(() => {
        const m = new Map<string, { worker: Worker | undefined; amount: number; lines: number; from: string; to: string }>();
        for (const e of earnings) {
            const k = e.worker_id!;
            const x = m.get(k) || { worker: workers.find((w) => w.id === k), amount: 0, lines: 0, from: e.work_date, to: e.work_date };
            x.amount += Number(e.amount);
            x.lines += 1;
            if (e.work_date < x.from) x.from = e.work_date;
            if (e.work_date > x.to) x.to = e.work_date;
            m.set(k, x);
        }
        return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
    }, [earnings, workers]);
    const total = byWorker.reduce((a, x) => a + x.amount, 0);
    const account = accounts.find((a) => a.id === accountId);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!accountId) return toast.error('Elige la cuenta de la que sale el pago');
        setSaving(true);
        const { data, error } = await supabase.rpc('pay_worker_earnings', {
            p_earning_ids: earnings.map((x) => x.id),
            p_account_id: accountId,
            p_date: date,
            p_method: method,
            p_reference: reference.trim() || undefined,
            p_notes: notes.trim() || undefined,
        });
        setSaving(false);
        if (error) return toast.error('No se pudo pagar: ' + dbErrorMessage(error));
        const r = (data || {}) as { total?: number; people?: { worker: string; amount: number }[] };
        toast.success(
            `Pago registrado: ${formatCOP(Number(r.total || total))} — ${(r.people || []).map((p) => `${p.worker} ${formatCOP(p.amount)}`).join(' · ')}`,
            { duration: 7000 }
        );
        onPaid();
    };

    return (
        <Shell title="Pagar mano de obra" subtitle={`${earnings.length} trabajo(s) seleccionados`} onClose={onClose} wide>
            <form onSubmit={submit} className="space-y-4">
                <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <thead className="text-[#949E97]">
                        <tr className="border-b border-[#C8CDC9]">
                            <th className="py-1.5 text-left font-semibold">Persona</th>
                            <th className="py-1.5 text-left font-semibold">Periodo</th>
                            <th className="py-1.5 text-left font-semibold">Cuenta de la persona</th>
                            <th className="py-1.5 text-right font-semibold">Le corresponde</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                        {byWorker.map((x) => (
                            <tr key={x.worker?.id}>
                                <td className="py-1.5 font-semibold">
                                    {x.worker?.full_name}
                                    <span className="ml-1 font-normal text-[#949E97]">({x.lines})</span>
                                </td>
                                <td className="py-1.5 text-[#949E97]">{x.from === x.to ? x.from : `${x.from} a ${x.to}`}</td>
                                <td className="py-1.5 text-[#949E97]">
                                    {[x.worker?.bank_name, x.worker?.bank_account].filter(Boolean).join(' · ') || '—'}
                                </td>
                                <td className="py-1.5 text-right font-bold">{formatCOP(x.amount)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr className="border-t-2 border-[#2E4040]/20">
                            <td colSpan={3} className="py-1.5 font-bold text-[#2E4040]">
                                Total a pagar
                            </td>
                            <td className="py-1.5 text-right text-sm font-bold text-[#2E4040]">{formatCOP(total)}</td>
                        </tr>
                    </tfoot>
                </table>

                <div className="grid grid-cols-1 gap-3 rounded-lg border border-[#C8CDC9] bg-slate-50/60 p-3 sm:grid-cols-3">
                    <div className="sm:col-span-3">
                        <label className={LABEL}>Sale de (caja / banco / caja menor) *</label>
                        <AccountSelect
                            value={accountId}
                            onChange={setAccountId}
                            className={`${INPUT} bg-white font-semibold`}
                            onLoaded={(list) => {
                                setAccounts(list);
                                setAccountId((cur) => cur || suggestAccount(list, method));
                            }}
                        />
                        {account && Number(account.current_balance) < total && (
                            <p className="mt-1 text-[11px] font-semibold text-amber-700">
                                Saldo en {account.name}: {formatCOP(Number(account.current_balance))} — quedará negativo.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className={LABEL}>Fecha de pago</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>Medio</label>
                        <select
                            value={method}
                            onChange={(e) => {
                                setMethod(e.target.value as PaymentMethod);
                                setAccountId(suggestAccount(accounts, e.target.value));
                            }}
                            className={`${INPUT} bg-white`}
                        >
                            {Object.entries(METHOD_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Referencia</label>
                        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Recibo / transf." className={INPUT} />
                    </div>
                    <div className="sm:col-span-3">
                        <label className={LABEL}>Notas</label>
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT} />
                    </div>
                </div>
                <p className="text-[11px] text-[#949E97]">
                    Se registra un pago por persona y su egreso en la cuenta elegida. No es un gasto en el P&amp;G: la mano de obra ya está
                    incluida en el costo de los cores.
                </p>
                <Footer onClose={onClose} saving={saving} label={`Pagar ${formatCOP(total)}`} disabled={!accountId || total <= 0} />
            </form>
        </Shell>
    );
}
