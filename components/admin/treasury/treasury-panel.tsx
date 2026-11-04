'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowDownRight,
    ArrowLeftRight,
    ArrowUpRight,
    Banknote,
    CheckCircle2,
    ClipboardCheck,
    Download,
    Landmark,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Scale,
    Search,
    ShieldCheck,
    Trash2,
    Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { DailyClosing, ExpenseCategory, TreasuryAccount, TreasuryMovement } from '@/lib/types';
import { daysUntil, dbErrorMessage, downloadCSV, formatCOP, formatDate, todayISO } from '@/components/admin/suppliers/utils';
import { ACCOUNT_TYPE_SHORT, MOVEMENT_LABELS, NEEDS_SUPPORT } from './utils';
import SupportButton from './support-button';
import { AccountModal, MovementModal, PettyExpenseModal } from './treasury-modals';
import DailyClosingTab from './daily-closing-tab';
import ReconciliationTab from './reconciliation-tab';

type Tab = 'resumen' | 'movimientos' | 'caja_menor' | 'cierre' | 'conciliacion';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'resumen', label: 'Resumen', icon: Wallet },
    { key: 'movimientos', label: 'Movimientos', icon: ArrowLeftRight },
    { key: 'caja_menor', label: 'Caja menor', icon: Banknote },
    { key: 'cierre', label: 'Cierre diario', icon: ClipboardCheck },
    { key: 'conciliacion', label: 'Conciliación bancaria', icon: Scale },
];

const ACCOUNT_ICON = { caja_general: Wallet, banco: Landmark, caja_menor: Banknote } as const;

const firstOfMonth = () => todayISO().slice(0, 7) + '-01';

export default function TreasuryPanel() {
    const [supabase] = useState(() => createClient());
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'admin';
    const [confirmDialog, confirm] = useConfirm();

    const [tab, setTab] = useState<Tab>('resumen');
    const [loading, setLoading] = useState(true);
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
    const [movements, setMovements] = useState<TreasuryMovement[]>([]);
    const [closings, setClosings] = useState<DailyClosing[]>([]);
    const [categories, setCategories] = useState<ExpenseCategory[]>([]);

    // Filtros de movimientos
    const [fAccount, setFAccount] = useState('');
    const [fFrom, setFFrom] = useState(firstOfMonth());
    const [fTo, setFTo] = useState(todayISO());
    const [fSearch, setFSearch] = useState('');
    const [fNoSupport, setFNoSupport] = useState(false);
    const [fUnreconciled, setFUnreconciled] = useState(false);

    const [accountModal, setAccountModal] = useState<{ account: TreasuryAccount | null } | null>(null);
    const [movementModal, setMovementModal] = useState<{ accountId?: string } | null>(null);
    const [pettyModal, setPettyModal] = useState<TreasuryAccount | null>(null);
    const [pettyId, setPettyId] = useState('');

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const [aRes, mRes, cRes, catRes] = await Promise.all([
                supabase.from('treasury_accounts').select('*').order('account_type').order('name'),
                supabase
                    .from('treasury_movements')
                    .select('*')
                    .gte('movement_date', fFrom)
                    .lte('movement_date', fTo)
                    .order('movement_date', { ascending: false })
                    .order('created_at', { ascending: false })
                    .limit(1000),
                supabase.from('daily_closings').select('*').order('closing_date', { ascending: false }).limit(200),
                supabase.from('expense_categories').select('*').eq('is_active', true).order('display_order'),
            ]);
            if (aRes.error) throw aRes.error;
            setAccounts((aRes.data || []) as TreasuryAccount[]);
            setMovements((mRes.data || []) as TreasuryMovement[]);
            setClosings((cRes.data || []) as DailyClosing[]);
            setCategories((catRes.data || []) as ExpenseCategory[]);
        } catch (err: any) {
            toast.error('Error cargando tesorería: ' + dbErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [supabase, fFrom, fTo]);

    useEffect(() => {
        if (isAdmin) load();
    }, [isAdmin, load]);

    useEffect(() => {
        const ch = supabase
            .channel('realtime-treasury')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'treasury_movements' }, () => load())
            .subscribe();
        return () => {
            supabase.removeChannel(ch);
        };
    }, [supabase, load]);

    const activeAccounts = accounts.filter((a) => a.is_active);
    const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
    const pettyAccounts = activeAccounts.filter((a) => a.account_type === 'caja_menor');
    const petty = pettyAccounts.find((a) => a.id === pettyId) || pettyAccounts[0] || null;

    const totals = useMemo(() => {
        const t = { total: 0, cash: 0, banks: 0, petty: 0 };
        for (const a of activeAccounts) {
            const b = Number(a.current_balance);
            t.total += b;
            if (a.account_type === 'banco') t.banks += b;
            else if (a.account_type === 'caja_menor') t.petty += b;
            else t.cash += b;
        }
        return t;
    }, [activeAccounts]);

    // Alertas propias de tesorería
    const alerts = useMemo(() => {
        const list: { level: 'critical' | 'warning'; text: string }[] = [];
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        for (const a of activeAccounts) {
            if (Number(a.current_balance) < 0) list.push({ level: 'critical', text: `${a.name} tiene saldo negativo (${formatCOP(Number(a.current_balance))})` });
            if (a.account_type !== 'banco') {
                const last = closings.find((c) => c.account_id === a.id);
                if (!last || last.closing_date < yesterday)
                    list.push({ level: 'warning', text: `${a.name}: sin cierre diario desde ${last ? formatDate(last.closing_date) : 'nunca'}` });
            }
            if (a.account_type === 'caja_menor' && Number(a.petty_cash_fund) > 0) {
                const pct = Number(a.current_balance) / Number(a.petty_cash_fund);
                if (pct < 0.2) list.push({ level: 'warning', text: `${a.name} al ${Math.round(pct * 100)}% del fondo: requiere reembolso` });
            }
        }
        const noSupport = movements.filter((m) => NEEDS_SUPPORT.includes(m.movement_type) && !m.support_path).length;
        if (noSupport > 0) list.push({ level: 'warning', text: `${noSupport} egreso(s) del periodo sin soporte adjunto` });
        const recentDiffs = closings.filter((c) => Number(c.difference) !== 0 && daysUntil(c.closing_date) >= -30);
        if (recentDiffs.length > 0) list.push({ level: 'warning', text: `${recentDiffs.length} cierre(s) con diferencia en los últimos 30 días` });
        return list;
    }, [activeAccounts, closings, movements]);

    // ---------- Movimientos filtrados ----------
    const filtered = useMemo(() => {
        const q = fSearch.trim().toLowerCase();
        return movements.filter(
            (m) =>
                (!fAccount || m.account_id === fAccount) &&
                (!fNoSupport || (!m.support_path && m.direction === 'egreso')) &&
                (!fUnreconciled || !m.reconciled) &&
                (!q || `${m.description} ${m.third_party || ''} ${m.reference || ''}`.toLowerCase().includes(q))
        );
    }, [movements, fAccount, fNoSupport, fUnreconciled, fSearch]);

    const sumIn = filtered.filter((m) => m.direction === 'ingreso').reduce((s, m) => s + Number(m.amount), 0);
    const sumOut = filtered.filter((m) => m.direction === 'egreso').reduce((s, m) => s + Number(m.amount), 0);

    const deleteMovement = async (m: TreasuryMovement) => {
        const isTransfer = !!m.transfer_group;
        const ok = await confirm({
            title: isTransfer ? '¿Eliminar la transferencia?' : '¿Eliminar este movimiento?',
            description: isTransfer
                ? 'Se eliminarán las dos partes (salida y entrada) y se recalcularán los saldos.'
                : `"${m.description}" por ${formatCOP(Number(m.amount))}. El saldo de la cuenta se recalcula.`,
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        try {
            const q = supabase.from('treasury_movements').delete();
            const { data, error } = isTransfer
                ? await q.eq('transfer_group', m.transfer_group!).select('id')
                : await q.eq('id', m.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Sin permiso para eliminar');
            toast.success('Movimiento eliminado');
            load();
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        }
    };

    const exportCSV = () =>
        downloadCSV(
            `tesoreria-${fFrom}-a-${fTo}.csv`,
            ['Fecha', 'Cuenta', 'PUC', 'Tipo', 'Descripción', 'Tercero', 'Referencia', 'Ingreso', 'Egreso', 'Conciliado', 'Soporte'],
            filtered.map((m) => {
                const a = accById.get(m.account_id);
                return [
                    m.movement_date,
                    a?.name || '',
                    a?.puc_code || '',
                    MOVEMENT_LABELS[m.movement_type],
                    m.description,
                    m.third_party || '',
                    m.reference || '',
                    m.direction === 'ingreso' ? Math.round(Number(m.amount)) : '',
                    m.direction === 'egreso' ? Math.round(Number(m.amount)) : '',
                    m.reconciled ? 'Sí' : 'No',
                    m.support_path ? 'Sí' : 'No',
                ];
            })
        );

    if (!isAdmin) {
        return (
            <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                Tesorería solo está disponible para administradores.
            </div>
        );
    }

    const pettyMovements = petty ? movements.filter((m) => m.account_id === petty.id) : [];
    const pettyFund = Number(petty?.petty_cash_fund || 0);
    const pettyBalance = Number(petty?.current_balance || 0);
    const pettySpent = Math.max(pettyFund - pettyBalance, 0);

    return (
        <div className="space-y-6">
            {confirmDialog}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Caja, Bancos y Conciliación</h2>
                    <p className="text-sm text-[#949E97]">
                        Los cobros, pagos y gastos con cuenta asignada se registran aquí solos. Solo digita transferencias y
                        movimientos extraordinarios.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={load}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3.5 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <RefreshCw className="h-3.5 w-3.5 text-[#3F8346]" /> Refrescar
                    </button>
                    <button
                        onClick={() => setAccountModal({ account: null })}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3.5 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <Plus className="h-3.5 w-3.5" /> Nueva cuenta
                    </button>
                    <button
                        onClick={() => setMovementModal({})}
                        disabled={activeAccounts.length === 0}
                        className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                    >
                        <ArrowLeftRight className="h-4 w-4" /> Movimiento / transferencia
                    </button>
                </div>
            </div>

            {/* Totales */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {[
                    { label: 'Disponible total', value: totals.total, icon: Wallet },
                    { label: 'Bancos', value: totals.banks, icon: Landmark },
                    { label: 'Efectivo (caja general)', value: totals.cash, icon: Banknote },
                    { label: 'Caja menor', value: totals.petty, icon: Banknote },
                ].map((k) => (
                    <div key={k.label} className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">{k.label}</span>
                            <k.icon className="h-5 w-5 text-[#3F8346]" />
                        </div>
                        <div className={`mt-2 text-2xl font-bold ${k.value < 0 ? 'text-red-700' : 'text-[#2E4040]'}`}>{formatCOP(k.value)}</div>
                    </div>
                ))}
            </div>

            {/* Pestañas */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[#C8CDC9]/80 pb-2">
                {TABS.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                            tab === t.key ? 'bg-[#2E4040] text-white shadow-sm' : 'border border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
                        }`}
                    >
                        <t.icon className="h-3.5 w-3.5 text-[#3F8346]" />
                        {t.label}
                    </button>
                ))}
            </div>

            {loading && accounts.length === 0 ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : (
                <>
                    {/* ===================== RESUMEN ===================== */}
                    {tab === 'resumen' && (
                        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                {accounts.map((a) => {
                                    const Icon = ACCOUNT_ICON[a.account_type];
                                    const accMov = movements.filter((m) => m.account_id === a.id);
                                    const inM = accMov.filter((m) => m.direction === 'ingreso').reduce((s, m) => s + Number(m.amount), 0);
                                    const outM = accMov.filter((m) => m.direction === 'egreso').reduce((s, m) => s + Number(m.amount), 0);
                                    const lastClosing = closings.find((c) => c.account_id === a.id);
                                    return (
                                        <div
                                            key={a.id}
                                            className={`rounded-xl border border-[#C8CDC9]/70 bg-white p-5 shadow-sm ${a.is_active ? '' : 'opacity-50'}`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="rounded-lg p-2" style={{ backgroundColor: a.color + '1A' }}>
                                                        <Icon className="h-5 w-5" style={{ color: a.color }} />
                                                    </div>
                                                    <div>
                                                        <div className="font-bold text-[#2E4040]">{a.name}</div>
                                                        <div className="text-[11px] text-[#949E97]">
                                                            {ACCOUNT_TYPE_SHORT[a.account_type]}
                                                            {a.bank_name ? ` · ${a.bank_name}` : ''}
                                                            {a.account_number ? ` · ${a.account_number}` : ''}
                                                            {a.puc_code ? ` · PUC ${a.puc_code}` : ''}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => setAccountModal({ account: a })}
                                                    className="rounded p-1 text-gray-500 hover:bg-gray-100"
                                                    title="Editar cuenta"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                            <div className={`mt-3 text-2xl font-bold ${Number(a.current_balance) < 0 ? 'text-red-700' : 'text-[#2E4040]'}`}>
                                                {formatCOP(Number(a.current_balance))}
                                            </div>
                                            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                                                <div className="flex items-center gap-1 text-[#2E4040]">
                                                    <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" /> Entradas {formatCOP(inM)}
                                                </div>
                                                <div className="flex items-center gap-1 text-[#2E4040]">
                                                    <ArrowDownRight className="h-3.5 w-3.5 text-red-600" /> Salidas {formatCOP(outM)}
                                                </div>
                                            </div>
                                            <div className="mt-2 border-t border-[#C8CDC9]/50 pt-2 text-[11px] text-[#949E97]">
                                                {a.account_type === 'caja_menor' && Number(a.petty_cash_fund) > 0
                                                    ? `Fondo ${formatCOP(Number(a.petty_cash_fund))} · `
                                                    : ''}
                                                {a.account_type === 'banco'
                                                    ? `${accMov.filter((m) => !m.reconciled).length} movimiento(s) sin conciliar en el periodo`
                                                    : `Último cierre: ${lastClosing ? formatDate(lastClosing.closing_date) : 'nunca'}`}
                                            </div>
                                            <div className="mt-3 flex gap-2">
                                                <button
                                                    onClick={() => {
                                                        setFAccount(a.id);
                                                        setTab('movimientos');
                                                    }}
                                                    className="rounded border border-[#C8CDC9] px-2.5 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                                >
                                                    Ver movimientos
                                                </button>
                                                <button
                                                    onClick={() => setMovementModal({ accountId: a.id })}
                                                    className="rounded border border-[#C8CDC9] px-2.5 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                                >
                                                    Registrar movimiento
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {accounts.every((a) => a.account_type !== 'banco') && (
                                    <button
                                        onClick={() => setAccountModal({ account: null })}
                                        className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#C8CDC9] p-6 text-sm font-semibold text-[#2E4040] hover:bg-white"
                                    >
                                        <Landmark className="h-8 w-8 text-[#3F8346]" />
                                        Agregar tu cuenta bancaria
                                    </button>
                                )}
                            </div>

                            {/* Alertas */}
                            <div className="h-fit rounded-xl border border-[#C8CDC9]/60 bg-white p-4 shadow-sm">
                                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#2E4040]">
                                    <ShieldCheck className="h-4 w-4 text-[#3F8346]" /> Controles de tesorería
                                </h3>
                                {alerts.length === 0 ? (
                                    <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                                        <CheckCircle2 className="h-4 w-4" /> Todo en orden
                                    </div>
                                ) : (
                                    <ul className="space-y-2">
                                        {alerts.map((al, i) => (
                                            <li
                                                key={i}
                                                className={`flex items-start gap-2 rounded-lg p-2.5 text-xs ${
                                                    al.level === 'critical' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
                                                }`}
                                            >
                                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                                <span>
                                                    <b>{al.level === 'critical' ? 'Crítico: ' : 'Atención: '}</b>
                                                    {al.text}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <p className="mt-3 text-[10px] text-[#949E97]">
                                    Para que un pago mueva caja o banco, elige la cuenta al registrarlo (cobros, pagos a proveedores y
                                    gastos).
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ===================== MOVIMIENTOS ===================== */}
                    {tab === 'movimientos' && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#C8CDC9]/60 bg-white p-3">
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Cuenta</label>
                                    <select
                                        value={fAccount}
                                        onChange={(e) => setFAccount(e.target.value)}
                                        className="rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs"
                                    >
                                        <option value="">Todas</option>
                                        {accounts.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Desde</label>
                                    <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs" />
                                </div>
                                <div>
                                    <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Hasta</label>
                                    <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs" />
                                </div>
                                <div className="relative min-w-[200px] flex-1">
                                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <input
                                        value={fSearch}
                                        onChange={(e) => setFSearch(e.target.value)}
                                        placeholder="Descripción, tercero o referencia"
                                        className="w-full rounded border border-[#C8CDC9] py-1.5 pl-8 pr-3 text-xs"
                                    />
                                </div>
                                <label className="flex items-center gap-1.5 text-xs text-[#2E4040]">
                                    <input type="checkbox" checked={fNoSupport} onChange={(e) => setFNoSupport(e.target.checked)} className="accent-[#3F8346]" />
                                    Egresos sin soporte
                                </label>
                                <label className="flex items-center gap-1.5 text-xs text-[#2E4040]">
                                    <input type="checkbox" checked={fUnreconciled} onChange={(e) => setFUnreconciled(e.target.checked)} className="accent-[#3F8346]" />
                                    Sin conciliar
                                </label>
                                <button
                                    onClick={exportCSV}
                                    disabled={filtered.length === 0}
                                    className="flex items-center gap-1.5 rounded border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-50"
                                >
                                    <Download className="h-3.5 w-3.5 text-[#3F8346]" /> Excel
                                </button>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                                <table className="w-full text-left text-xs">
                                    <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                                        <tr>
                                            <th className="px-3 py-2.5">Fecha</th>
                                            <th className="px-3 py-2.5">Cuenta</th>
                                            <th className="px-3 py-2.5">Movimiento</th>
                                            <th className="px-3 py-2.5 text-right">Ingreso</th>
                                            <th className="px-3 py-2.5 text-right">Egreso</th>
                                            <th className="px-3 py-2.5">Soporte</th>
                                            <th className="px-3 py-2.5 text-center">Conc.</th>
                                            <th className="w-8" />
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#C8CDC9]/40">
                                        {filtered.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="px-3 py-10 text-center text-[#949E97]">
                                                    Sin movimientos con estos filtros.
                                                </td>
                                            </tr>
                                        ) : (
                                            filtered.map((m) => {
                                                const a = accById.get(m.account_id);
                                                const manual = ['otro_ingreso', 'otro_egreso', 'ajuste', 'transferencia_entrada', 'transferencia_salida'].includes(
                                                    m.movement_type
                                                );
                                                return (
                                                    <tr key={m.id} className="hover:bg-[#F9FBFA]">
                                                        <td className="whitespace-nowrap px-3 py-2 text-[#2E4040]">{formatDate(m.movement_date)}</td>
                                                        <td className="px-3 py-2">
                                                            <span className="inline-flex items-center gap-1.5">
                                                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: a?.color }} />
                                                                {a?.name}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="font-semibold text-[#2E4040]">{m.description}</div>
                                                            <div className="text-[10px] text-[#949E97]">
                                                                {MOVEMENT_LABELS[m.movement_type]}
                                                                {m.third_party ? ` · ${m.third_party}` : ''}
                                                                {m.reference ? ` · Ref. ${m.reference}` : ''}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                                            {m.direction === 'ingreso' ? formatCOP(Number(m.amount)) : ''}
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-semibold text-[#2E4040]">
                                                            {m.direction === 'egreso' ? formatCOP(Number(m.amount)) : ''}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <SupportButton movementId={m.id} path={m.support_path} onChanged={load} compact />
                                                        </td>
                                                        <td className="px-3 py-2 text-center">
                                                            {m.reconciled ? (
                                                                <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-600" aria-label="Conciliado" />
                                                            ) : (
                                                                <span className="text-[#C8CDC9]">—</span>
                                                            )}
                                                        </td>
                                                        <td className="px-1 py-2">
                                                            {manual && !m.reconciled && (
                                                                <button
                                                                    onClick={() => deleteMovement(m)}
                                                                    className="rounded p-1 text-red-500 hover:bg-red-50"
                                                                    title="Eliminar"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                    {filtered.length > 0 && (
                                        <tfoot className="border-t border-[#C8CDC9] bg-[#F8F9FA] font-bold text-[#2E4040]">
                                            <tr>
                                                <td colSpan={3} className="px-3 py-2 text-right">
                                                    Totales del periodo ({filtered.length})
                                                </td>
                                                <td className="px-3 py-2 text-right text-emerald-700">{formatCOP(sumIn)}</td>
                                                <td className="px-3 py-2 text-right">{formatCOP(sumOut)}</td>
                                                <td colSpan={3} className="px-3 py-2">
                                                    Neto {formatCOP(sumIn - sumOut)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                            <p className="text-[11px] text-[#949E97]">
                                Los movimientos de cobros, pagos y gastos se corrigen desde su módulo de origen. Los conciliados no se
                                pueden modificar.
                            </p>
                        </div>
                    )}

                    {/* ===================== CAJA MENOR ===================== */}
                    {tab === 'caja_menor' && (
                        <div className="space-y-4">
                            {!petty ? (
                                <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                                    No hay una caja menor activa. Créala con &quot;Nueva cuenta&quot;.
                                </div>
                            ) : (
                                <>
                                    {pettyAccounts.length > 1 && (
                                        <select
                                            value={petty.id}
                                            onChange={(e) => setPettyId(e.target.value)}
                                            className="rounded border border-[#C8CDC9] bg-white px-3 py-2 text-xs"
                                        >
                                            {pettyAccounts.map((a) => (
                                                <option key={a.id} value={a.id}>
                                                    {a.name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
                                        <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                                            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                                                <div>
                                                    <div className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">Disponible</div>
                                                    <div className="text-3xl font-bold text-[#2E4040]">{formatCOP(pettyBalance)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">Fondo fijo</div>
                                                    <div className="text-xl font-bold text-[#2E4040]">{pettyFund > 0 ? formatCOP(pettyFund) : 'Sin definir'}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">Por reembolsar</div>
                                                    <div className="text-xl font-bold text-[#2E4040]">{formatCOP(pettySpent)}</div>
                                                </div>
                                            </div>
                                            {pettyFund > 0 && (
                                                <div className="mt-4">
                                                    <div className="h-2 rounded-full bg-[#C8CDC9]/40">
                                                        <div
                                                            className="h-2 rounded-full bg-[#3F8346]"
                                                            style={{ width: `${Math.min(Math.max(pettyBalance / pettyFund, 0), 1) * 100}%` }}
                                                        />
                                                    </div>
                                                    <div className="mt-1 text-[11px] text-[#949E97]">
                                                        {Math.round(Math.max(pettyBalance / pettyFund, 0) * 100)}% del fondo disponible
                                                    </div>
                                                </div>
                                            )}
                                            {pettyFund === 0 && (
                                                <p className="mt-3 text-[11px] text-amber-700">
                                                    Define el monto del fondo fijo editando la cuenta para controlar los reembolsos.
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <button
                                                onClick={() => setPettyModal(petty)}
                                                className="flex items-center justify-center gap-2 rounded-lg bg-[#3F8346] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2d6332]"
                                            >
                                                <Plus className="h-4 w-4" /> Registrar gasto
                                            </button>
                                            <button
                                                onClick={() => setMovementModal({})}
                                                className="flex items-center justify-center gap-2 rounded-lg border border-[#C8CDC9] bg-white px-5 py-3 text-sm font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                            >
                                                <ArrowLeftRight className="h-4 w-4 text-[#3F8346]" /> Reembolsar fondo
                                            </button>
                                            <span className="max-w-[220px] text-[10px] text-[#949E97]">
                                                Reembolso = transferencia desde banco o caja general hacia la caja menor por{' '}
                                                {formatCOP(pettySpent)}.
                                            </span>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                                        <table className="w-full text-left text-xs">
                                            <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                                                <tr>
                                                    <th className="px-3 py-2.5">Fecha</th>
                                                    <th className="px-3 py-2.5">Concepto</th>
                                                    <th className="px-3 py-2.5 text-right">Entra</th>
                                                    <th className="px-3 py-2.5 text-right">Sale</th>
                                                    <th className="px-3 py-2.5">Soporte</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#C8CDC9]/40">
                                                {pettyMovements.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="px-3 py-10 text-center text-[#949E97]">
                                                            Sin movimientos de caja menor entre {formatDate(fFrom)} y {formatDate(fTo)}.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    pettyMovements.map((m) => (
                                                        <tr key={m.id}>
                                                            <td className="whitespace-nowrap px-3 py-2">{formatDate(m.movement_date)}</td>
                                                            <td className="px-3 py-2">
                                                                <div className="font-semibold text-[#2E4040]">{m.description}</div>
                                                                <div className="text-[10px] text-[#949E97]">
                                                                    {MOVEMENT_LABELS[m.movement_type]}
                                                                    {m.third_party ? ` · ${m.third_party}` : ''}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                                                                {m.direction === 'ingreso' ? formatCOP(Number(m.amount)) : ''}
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-semibold text-[#2E4040]">
                                                                {m.direction === 'egreso' ? formatCOP(Number(m.amount)) : ''}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <SupportButton movementId={m.id} path={m.support_path} onChanged={load} />
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="text-[11px] text-[#949E97]">
                                        Cada gasto de caja menor queda también en Gastos Fijos → mes, con su categoría, y entra al estado
                                        de resultados.
                                    </p>
                                </>
                            )}
                        </div>
                    )}

                    {tab === 'cierre' && <DailyClosingTab accounts={activeAccounts} closings={closings} onChanged={load} />}
                    {tab === 'conciliacion' && <ReconciliationTab accounts={activeAccounts.filter((a) => a.account_type === 'banco')} onChanged={load} />}
                </>
            )}

            {accountModal && <AccountModal account={accountModal.account} onClose={() => setAccountModal(null)} onSaved={load} />}
            {movementModal && (
                <MovementModal
                    accounts={activeAccounts}
                    defaultAccountId={movementModal.accountId}
                    onClose={() => setMovementModal(null)}
                    onSaved={load}
                />
            )}
            {pettyModal && (
                <PettyExpenseModal account={pettyModal} categories={categories} onClose={() => setPettyModal(null)} onSaved={load} />
            )}
        </div>
    );
}
