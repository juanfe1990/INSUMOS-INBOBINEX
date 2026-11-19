'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Ban,
    ChevronDown,
    ChevronRight,
    Edit2,
    FileSpreadsheet,
    HandCoins,
    HardHat,
    Loader2,
    Plus,
    Trash2,
    UserPlus,
    Users,
    Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import type { Worker, WorkerEarning, WorkerPayment } from '@/lib/types';
import { useConfirm } from '@/components/admin/confirm-dialog';
import CoreAssemblyModal from './core-assembly-modal';
import { METHOD_LABELS, dbErrorMessage, downloadCSV, formatCOP } from '@/components/admin/suppliers/utils';
import {
    AssignEarningModal,
    EarningFormModal,
    KIND_LABEL,
    PayEarningsModal,
    WORK_TYPE_LABEL,
    WorkerFormModal,
} from './worker-modals';

type Tab = 'pending' | 'payments' | 'people';
type Period = 'all' | 'week' | 'prev_week' | 'month' | 'custom';

const INPUT = 'rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';
const iso = (d: Date) => d.toLocaleDateString('en-CA');
const dayLabel = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });

function periodRange(p: Period, from: string, to: string): [string | null, string | null] {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    if (p === 'week') return [iso(monday), iso(now)];
    if (p === 'prev_week') {
        const pm = new Date(monday);
        pm.setDate(monday.getDate() - 7);
        const ps = new Date(monday);
        ps.setDate(monday.getDate() - 1);
        return [iso(pm), iso(ps)];
    }
    if (p === 'month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
    if (p === 'custom') return [from || null, to || null];
    return [null, null];
}

/**
 * Trabajadores de cores y prestación de servicios:
 * lo causado por persona (desde el armado o manual), pagos por día / semana / todo
 * con división por persona y egreso en caja o banco, y el directorio de personas.
 */
export default function WorkersPanel() {
    const [supabase] = useState(() => createClient());
    const { profile } = useAuth();
    const [confirmDialog, confirm] = useConfirm();
    const [tab, setTab] = useState<Tab>('pending');
    const [workers, setWorkers] = useState<Worker[]>([]);
    const [pending, setPending] = useState<WorkerEarning[]>([]);
    const [payments, setPayments] = useState<WorkerPayment[]>([]);
    const [loading, setLoading] = useState(true);

    const [period, setPeriod] = useState<Period>('all');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [workerFilter, setWorkerFilter] = useState('all');
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const [workerForm, setWorkerForm] = useState<{ open: boolean; worker: Worker | null }>({ open: false, worker: null });
    // Registrar trabajo: armado de cores (por defecto, como la app) o servicio u otro
    const [workForm, setWorkForm] = useState<null | 'armado' | 'servicio'>(null);
    const [assignTarget, setAssignTarget] = useState<WorkerEarning | null>(null);
    const [paying, setPaying] = useState<WorkerEarning[] | null>(null);
    const [openBatch, setOpenBatch] = useState<string | null>(null);

    const load = useCallback(async () => {
        const [w, e, p] = await Promise.all([
            supabase.from('workers').select('*').order('full_name'),
            supabase.from('worker_earnings').select('*, worker:workers(full_name)').is('payment_id', null).order('work_date', { ascending: false }).order('created_at'),
            supabase
                .from('worker_payments')
                .select('*, worker:workers(full_name, bank_name, bank_account), account:treasury_accounts(name)')
                .order('payment_date', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(300),
        ]);
        if (w.error || e.error || p.error) toast.error('No se pudo cargar: ' + (w.error || e.error || p.error)!.message);
        setWorkers((w.data || []) as Worker[]);
        setPending((e.data || []) as unknown as WorkerEarning[]);
        setPayments((p.data || []) as unknown as WorkerPayment[]);
        setLoading(false);
    }, [supabase]);

    useEffect(() => {
        load();
        const ch = supabase
            .channel('worker-earnings')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'worker_earnings' }, () => load())
            .subscribe();
        return () => {
            supabase.removeChannel(ch);
        };
    }, [supabase, load]);

    const activeWorkers = workers.filter((w) => w.is_active);
    const [from, to] = periodRange(period, customFrom, customTo);

    const visible = useMemo(
        () =>
            pending.filter(
                (e) =>
                    (!from || e.work_date >= from) &&
                    (!to || e.work_date <= to) &&
                    (workerFilter === 'all' || (workerFilter === 'none' ? !e.worker_id : e.worker_id === workerFilter))
            ),
        [pending, from, to, workerFilter]
    );
    const byDay = useMemo(() => {
        const m = new Map<string, WorkerEarning[]>();
        for (const e of visible) m.set(e.work_date, [...(m.get(e.work_date) || []), e]);
        return Array.from(m.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    }, [visible]);

    // Mantener la selección dentro de lo visible
    useEffect(() => {
        setSelected((s) => new Set(Array.from(s).filter((id) => visible.some((e) => e.id === id && e.worker_id))));
    }, [visible]);

    const selectedRows = visible.filter((e) => selected.has(e.id));
    const selectedTotal = selectedRows.reduce((a, e) => a + Number(e.amount), 0);
    const visibleTotal = visible.reduce((a, e) => a + Number(e.amount), 0);
    const unassigned = visible.filter((e) => !e.worker_id);
    const payable = visible.filter((e) => e.worker_id);

    const toggle = (ids: string[], on: boolean) =>
        setSelected((s) => {
            const n = new Set(s);
            ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
            return n;
        });

    const selectedByWorker = useMemo(() => {
        const m = new Map<string, number>();
        for (const e of selectedRows) m.set(e.worker?.full_name || '', (m.get(e.worker?.full_name || '') || 0) + Number(e.amount));
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
    }, [selectedRows]);

    const deleteEarning = async (e: WorkerEarning) => {
        const ok = await confirm({
            title: '¿Eliminar este trabajo por pagar?',
            description: `${e.description} · ${formatCOP(Number(e.amount))}. Úsalo solo si fue un error de registro (el inventario del armado no cambia).`,
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const { error } = await supabase.rpc('delete_worker_earning', { p_id: e.id });
        if (error) return toast.error('No se pudo eliminar: ' + dbErrorMessage(error));
        toast.success('Trabajo eliminado');
        load();
    };

    // Pagos agrupados por lote
    const batches = useMemo(() => {
        const m = new Map<string, WorkerPayment[]>();
        for (const p of payments) m.set(p.batch_id, [...(m.get(p.batch_id) || []), p]);
        return Array.from(m.entries()).map(([id, rows]) => ({
            id,
            rows,
            date: rows[0].payment_date,
            account: rows[0].account?.name || '',
            method: rows[0].method,
            reference: rows[0].reference,
            total: rows.reduce((a, r) => a + Number(r.amount), 0),
        }));
    }, [payments]);

    const annulBatch = async (b: (typeof batches)[number]) => {
        const ok = await confirm({
            title: '¿Anular este pago?',
            description: `${b.date} · ${formatCOP(b.total)} a ${b.rows.length} persona(s) desde ${b.account}. El dinero vuelve a la cuenta y los trabajos quedan otra vez por pagar.`,
            confirmLabel: 'Anular pago',
        });
        if (!ok) return;
        const { error } = await supabase.rpc('annul_worker_payment_batch', { p_batch_id: b.id });
        if (error) return toast.error('No se pudo anular: ' + dbErrorMessage(error));
        toast.success('Pago anulado: los trabajos volvieron a "Por pagar"');
        load();
    };

    const toggleActive = async (w: Worker) => {
        const { data, error } = await supabase
            .from('workers')
            .update({ is_active: !w.is_active, updated_at: new Date().toISOString() })
            .eq('id', w.id)
            .select('id');
        if (error || !data?.length) return toast.error('No se pudo actualizar: ' + (error?.message || 'sin permiso'));
        toast.success(w.is_active ? `${w.full_name} desactivado(a)` : `${w.full_name} activado(a)`);
        load();
    };

    const pendingByWorker = (id: string) => pending.filter((e) => e.worker_id === id).reduce((a, e) => a + Number(e.amount), 0);
    const paidThisMonth = (id: string) => {
        const m = iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
        return payments.filter((p) => p.worker_id === id && p.payment_date >= m).reduce((a, p) => a + Number(p.amount), 0);
    };

    if (profile && profile.role !== 'admin') {
        return (
            <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                El módulo de trabajadores solo está disponible para administradores.
            </div>
        );
    }

    const tabBtn = (k: Tab, label: string, Icon: React.ComponentType<{ className?: string }>, badge?: number) => (
        <button
            onClick={() => setTab(k)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                tab === k ? 'bg-[#2E4040] text-white shadow-sm' : 'border border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
            }`}
        >
            <Icon className="h-3.5 w-3.5 text-[#3F8346]" />
            {label}
            {badge ? <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{badge}</span> : null}
        </button>
    );

    return (
        <div className="space-y-5">
            {confirmDialog}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Trabajadores</h2>
                    <p className="text-sm text-[#949E97]">
                        Armado de cores, corte de cartón y prestación de servicios: lo que se debe a cada persona y sus pagos.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={() => setWorkForm('armado')}
                        disabled={activeWorkers.length === 0}
                        className="flex items-center gap-1.5 rounded-md border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-40"
                    >
                        <Plus className="h-3.5 w-3.5" /> Registrar trabajo
                    </button>
                    <button
                        onClick={() => setWorkerForm({ open: true, worker: null })}
                        className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332]"
                    >
                        <UserPlus className="h-3.5 w-3.5" /> Nueva persona
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-[#C8CDC9]/80 pb-2">
                {tabBtn('pending', `Por pagar (${formatCOP(pending.reduce((a, e) => a + Number(e.amount), 0))})`, Wallet, pending.filter((e) => !e.worker_id).length)}
                {tabBtn('payments', 'Pagos realizados', HandCoins)}
                {tabBtn('people', `Personas (${activeWorkers.length})`, Users)}
            </div>

            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-[#3F8346]" />
                </div>
            ) : tab === 'pending' ? (
                <>
                    {/* Filtros */}
                    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#C8CDC9] bg-white p-3 shadow-sm">
                        <div>
                            <label className={LABEL}>Periodo</label>
                            <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className={INPUT}>
                                <option value="all">Todo lo pendiente</option>
                                <option value="week">Esta semana</option>
                                <option value="prev_week">Semana anterior</option>
                                <option value="month">Este mes</option>
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
                            <label className={LABEL}>Persona</label>
                            <select value={workerFilter} onChange={(e) => setWorkerFilter(e.target.value)} className={INPUT}>
                                <option value="all">Todas</option>
                                <option value="none">Sin asignar</option>
                                {workers.map((w) => (
                                    <option key={w.id} value={w.id}>
                                        {w.full_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={() => toggle(payable.map((e) => e.id), true)}
                            disabled={payable.length === 0}
                            className="mb-px rounded-md border border-[#C8CDC9] px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-40"
                        >
                            Seleccionar todo el periodo
                        </button>
                        {selected.size > 0 && (
                            <button onClick={() => setSelected(new Set())} className="mb-1.5 text-xs font-semibold text-[#949E97] hover:underline">
                                Quitar selección
                            </button>
                        )}
                        <span className="mb-1.5 ml-auto text-xs text-[#2E4040]">
                            Pendiente en el filtro: <b>{formatCOP(visibleTotal)}</b>
                        </span>
                    </div>

                    {unassigned.length > 0 && (
                        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            <span>
                                <b>{unassigned.length}</b> trabajo(s) sin asignar ({formatCOP(unassigned.reduce((a, e) => a + Number(e.amount), 0))}): se
                                armaron sin indicar las personas. Usa <b>Asignar</b> para poder pagarlos.
                            </span>
                        </div>
                    )}

                    {/* Barra de pago de lo seleccionado */}
                    {selectedRows.length > 0 && (
                        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-[#3F8346]/50 bg-[#F4FAF5] p-3 shadow-md">
                            <div className="flex-1 text-xs text-[#2E4040]">
                                <p className="font-bold">
                                    {selectedRows.length} trabajo(s) · {formatCOP(selectedTotal)}
                                </p>
                                <p className="text-[#2E4040]/80">{selectedByWorker.map(([n, a]) => `${n} ${formatCOP(a)}`).join(' · ')}</p>
                            </div>
                            <button
                                onClick={() => setPaying(selectedRows)}
                                className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332]"
                            >
                                <HandCoins className="h-4 w-4" /> Pagar seleccionado
                            </button>
                        </div>
                    )}

                    {byDay.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white py-12 text-center">
                            <HardHat className="mx-auto h-8 w-8 text-[#C8CDC9]" />
                            <p className="mt-2 text-sm font-semibold text-[#2E4040]">No hay trabajos por pagar</p>
                            <p className="text-[11px] text-[#949E97]">
                                Se causan al registrar el armado de cores (app o web) o con &quot;Registrar trabajo&quot;.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {byDay.map(([day, rows]) => {
                                const payableIds = rows.filter((r) => r.worker_id).map((r) => r.id);
                                const allOn = payableIds.length > 0 && payableIds.every((id) => selected.has(id));
                                const dayTotal = rows.reduce((a, r) => a + Number(r.amount), 0);
                                return (
                                    <section key={day} className="overflow-hidden rounded-xl border border-[#C8CDC9] bg-white shadow-sm">
                                        <div className="flex items-center gap-2 border-b border-[#C8CDC9]/70 bg-slate-50 px-3 py-2">
                                            <input
                                                type="checkbox"
                                                checked={allOn}
                                                disabled={payableIds.length === 0}
                                                onChange={(e) => toggle(payableIds, e.target.checked)}
                                                className="accent-[#3F8346]"
                                                aria-label={`Seleccionar el ${day}`}
                                            />
                                            <span className="text-xs font-bold capitalize text-[#2E4040]">{dayLabel(day)}</span>
                                            <span className="ml-auto text-xs font-bold text-[#2E4040]">{formatCOP(dayTotal)}</span>
                                        </div>
                                        <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                            <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                                                {rows.map((e) => (
                                                    <tr key={e.id} className={selected.has(e.id) ? 'bg-[#3F8346]/5' : ''}>
                                                        <td className="w-8 px-3 py-2">
                                                            <input
                                                                type="checkbox"
                                                                checked={selected.has(e.id)}
                                                                disabled={!e.worker_id}
                                                                onChange={(ev) => toggle([e.id], ev.target.checked)}
                                                                className="accent-[#3F8346]"
                                                            />
                                                        </td>
                                                        <td className="py-2 pr-2">
                                                            {e.worker_id ? (
                                                                <span className="font-semibold">{e.worker?.full_name}</span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                                                    <AlertTriangle className="h-3 w-3" /> Sin asignar
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-2 pr-2">
                                                            <span className="mr-1.5 rounded border border-[#C8CDC9] px-1.5 py-0.5 text-[10px] font-semibold text-[#949E97]">
                                                                {KIND_LABEL[e.kind]}
                                                            </span>
                                                            {e.description.replace(/^(Armado|Corte de cartón) — /, '')}
                                                        </td>
                                                        <td className="whitespace-nowrap py-2 pr-2 text-right text-[#949E97]">
                                                            {e.units != null ? `${Number(e.units).toLocaleString('es-CO')} × ${formatCOP(Number(e.rate || 0))}` : ''}
                                                            {Number(e.shared_with || 1) > 1 && (
                                                                <span className="block text-[10px]">÷ {e.shared_with} personas</span>
                                                            )}
                                                        </td>
                                                        <td className="py-2 pr-2 text-right font-bold">{formatCOP(Number(e.amount))}</td>
                                                        <td className="whitespace-nowrap py-2 pr-3 text-right">
                                                            <button
                                                                onClick={() => setAssignTarget(e)}
                                                                className={`mr-1 rounded-md px-2 py-1 text-[11px] font-semibold ${
                                                                    e.worker_id
                                                                        ? 'text-[#949E97] hover:bg-[#C8CDC9]/20 hover:text-[#2E4040]'
                                                                        : 'bg-amber-500 text-white hover:bg-amber-600'
                                                                }`}
                                                                title={e.worker_id ? 'Reasignar o repartir entre varias personas' : 'Asignar a quien lo hizo'}
                                                            >
                                                                {e.worker_id ? 'Reasignar' : 'Asignar'}
                                                            </button>
                                                            <button
                                                                onClick={() => deleteEarning(e)}
                                                                className="rounded-md p-1 text-[#949E97] hover:bg-red-50 hover:text-red-600"
                                                                title="Eliminar (error de registro)"
                                                                aria-label="Eliminar"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </section>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : tab === 'payments' ? (
                <section className="overflow-hidden rounded-xl border border-[#C8CDC9] bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-[#C8CDC9] px-4 py-2.5">
                        <h3 className="text-sm font-bold text-[#2E4040]">Pagos realizados</h3>
                        <button
                            onClick={() =>
                                downloadCSV(
                                    'pagos_mano_obra.csv',
                                    ['Fecha', 'Persona', 'Documento', 'Periodo desde', 'Periodo hasta', 'Valor', 'Cuenta', 'Medio', 'Referencia'],
                                    payments.map((p) => [
                                        p.payment_date,
                                        p.worker?.full_name || '',
                                        workers.find((w) => w.id === p.worker_id)?.document_id || '',
                                        p.period_from || '',
                                        p.period_to || '',
                                        Math.round(Number(p.amount)),
                                        p.account?.name || '',
                                        METHOD_LABELS[p.method],
                                        p.reference || '',
                                    ])
                                )
                            }
                            disabled={payments.length === 0}
                            className="flex items-center gap-1 rounded-md border border-[#C8CDC9] px-2.5 py-1 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-40"
                        >
                            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                        </button>
                    </div>
                    {batches.length === 0 ? (
                        <p className="py-10 text-center text-xs text-[#949E97]">Aún no hay pagos.</p>
                    ) : (
                        <div className="divide-y divide-[#C8CDC9]/60">
                            {batches.map((b) => (
                                <div key={b.id}>
                                    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
                                        <button onClick={() => setOpenBatch(openBatch === b.id ? null : b.id)} className="flex items-center gap-1 font-semibold text-[#2E4040]">
                                            {openBatch === b.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            {b.date}
                                        </button>
                                        <span className="text-[#949E97]">
                                            {b.rows.length} persona(s) · {b.account} · {METHOD_LABELS[b.method]}
                                            {b.reference ? ` · ${b.reference}` : ''}
                                        </span>
                                        <span className="ml-auto font-bold text-[#2E4040]">{formatCOP(b.total)}</span>
                                        <button
                                            onClick={() => annulBatch(b)}
                                            className="flex items-center gap-1 rounded-md border border-[#C8CDC9] px-2 py-1 text-[11px] font-semibold text-[#2E4040] hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                                        >
                                            <Ban className="h-3 w-3" /> Anular
                                        </button>
                                    </div>
                                    {openBatch === b.id && (
                                        <table className="mb-2 ml-9 w-[calc(100%-3rem)] text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                            <tbody className="divide-y divide-[#C8CDC9]/40 text-[#2E4040]">
                                                {b.rows.map((p) => (
                                                    <tr key={p.id}>
                                                        <td className="py-1.5 font-semibold">{p.worker?.full_name}</td>
                                                        <td className="py-1.5 text-[#949E97]">
                                                            {p.period_from === p.period_to ? p.period_from : `${p.period_from} a ${p.period_to}`}
                                                        </td>
                                                        <td className="py-1.5 text-[#949E97]">
                                                            {[p.worker?.bank_name, p.worker?.bank_account].filter(Boolean).join(' · ')}
                                                        </td>
                                                        <td className="py-1.5 text-right font-bold">{formatCOP(Number(p.amount))}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            ) : (
                <section className="overflow-x-auto rounded-xl border border-[#C8CDC9] bg-white shadow-sm">
                    {workers.length === 0 ? (
                        <div className="py-12 text-center">
                            <Users className="mx-auto h-8 w-8 text-[#C8CDC9]" />
                            <p className="mt-2 text-sm font-semibold text-[#2E4040]">Aún no hay personas</p>
                            <p className="text-[11px] text-[#949E97]">Agrégalas para que los operarios puedan elegirlas al registrar el armado.</p>
                        </div>
                    ) : (
                        <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            <thead className="bg-slate-50 text-[#949E97]">
                                <tr className="border-b border-[#C8CDC9]">
                                    <th className="px-3 py-2 text-left font-semibold">Persona</th>
                                    <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                                    <th className="px-3 py-2 text-left font-semibold">Cuenta para pagarle</th>
                                    <th className="px-3 py-2 text-right font-semibold">Por pagar</th>
                                    <th className="px-3 py-2 text-right font-semibold">Pagado este mes</th>
                                    <th className="px-3 py-2" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#C8CDC9]/50 text-[#2E4040]">
                                {workers.map((w) => (
                                    <tr key={w.id} className={w.is_active ? '' : 'text-[#949E97]'}>
                                        <td className="px-3 py-2">
                                            <div className="font-semibold">{w.full_name}</div>
                                            <div className="text-[10px] text-[#949E97]">
                                                {[w.document_id && `CC ${w.document_id}`, w.phone].filter(Boolean).join(' · ') || '—'}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">{WORK_TYPE_LABEL[w.work_type]}</td>
                                        <td className="px-3 py-2">{[w.bank_name, w.bank_account].filter(Boolean).join(' · ') || '—'}</td>
                                        <td className="px-3 py-2 text-right font-bold">{formatCOP(pendingByWorker(w.id))}</td>
                                        <td className="px-3 py-2 text-right">{formatCOP(paidThisMonth(w.id))}</td>
                                        <td className="whitespace-nowrap px-3 py-2 text-right">
                                            <button
                                                onClick={() => setWorkerForm({ open: true, worker: w })}
                                                className="mr-1 rounded-md p-1.5 text-[#2E4040] hover:bg-[#C8CDC9]/30"
                                                title="Editar"
                                                aria-label={`Editar ${w.full_name}`}
                                            >
                                                <Edit2 className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                onClick={() => toggleActive(w)}
                                                className="rounded-md border border-[#C8CDC9] px-2 py-1 text-[11px] font-semibold hover:bg-[#C8CDC9]/20"
                                            >
                                                {w.is_active ? 'Desactivar' : 'Activar'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </section>
            )}

            {workerForm.open && (
                <WorkerFormModal
                    worker={workerForm.worker}
                    onClose={() => setWorkerForm({ open: false, worker: null })}
                    onSaved={() => {
                        setWorkerForm({ open: false, worker: null });
                        load();
                    }}
                />
            )}
            {workForm === 'armado' && (
                <CoreAssemblyModal
                    workers={activeWorkers}
                    onClose={() => setWorkForm(null)}
                    onServiceInstead={() => setWorkForm('servicio')}
                    onSaved={() => {
                        setWorkForm(null);
                        load();
                    }}
                />
            )}
            {workForm === 'servicio' && (
                <EarningFormModal
                    workers={activeWorkers}
                    onClose={() => setWorkForm(null)}
                    onAssemblyInstead={() => setWorkForm('armado')}
                    onSaved={() => {
                        setWorkForm(null);
                        load();
                    }}
                />
            )}
            {assignTarget && (
                <AssignEarningModal
                    earning={assignTarget}
                    workers={activeWorkers}
                    onClose={() => setAssignTarget(null)}
                    onSaved={() => {
                        setAssignTarget(null);
                        load();
                    }}
                />
            )}
            {paying && (
                <PayEarningsModal
                    earnings={paying}
                    workers={workers}
                    onClose={() => setPaying(null)}
                    onPaid={() => {
                        setPaying(null);
                        setSelected(new Set());
                        load();
                    }}
                />
            )}
        </div>
    );
}
