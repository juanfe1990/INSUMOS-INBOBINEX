'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Ban,
    CalendarDays,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Download,
    Loader2,
    Pencil,
    Plus,
    Power,
    Repeat,
    RotateCcw,
    Trash2,
    TrendingUp,
    Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { Expense, ExpenseCategory, RecurringExpense } from '@/lib/types';
import { daysUntil, dbErrorMessage, downloadCSV, formatCOP, formatDate, todayISO } from '@/components/admin/suppliers/utils';
import {
    FREQUENCY_SHORT,
    GROUP_LABELS,
    MONTH_NAMES,
    expenseCost,
    monthLabel,
    monthStart,
    monthlyCommitment,
    shiftMonth,
} from './utils';
import RecurringExpenseModal from './recurring-expense-modal';
import ExpenseModal from './expense-modal';

type View = 'month' | 'templates' | 'year';

export default function ExpensesPanel() {
    // Cliente estable: se usa en dependencias de useCallback/useEffect
    const [supabase] = useState(() => createClient());
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'admin';
    const [confirmDialog, confirm] = useConfirm();

    const [view, setView] = useState<View>('month');
    const [month, setMonth] = useState(monthStart(todayISO()));
    const [year, setYear] = useState(Number(todayISO().slice(0, 4)));
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [categories, setCategories] = useState<ExpenseCategory[]>([]);
    const [templates, setTemplates] = useState<RecurringExpense[]>([]);
    const [suppliers, setSuppliers] = useState<{ id: string; business_name: string }[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [yearExpenses, setYearExpenses] = useState<Expense[]>([]);
    const [monthSales, setMonthSales] = useState(0);

    const [templateModal, setTemplateModal] = useState<{ template: RecurringExpense | null; categoryId?: string } | null>(null);
    const [expenseModal, setExpenseModal] = useState<{ mode: 'pay' | 'edit' | 'create'; expense: Expense | null } | null>(null);

    const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

    // ---------- Carga ----------
    const fetchBase = useCallback(async () => {
        const [catRes, tplRes, supRes] = await Promise.all([
            supabase.from('expense_categories').select('*').order('display_order'),
            supabase.from('recurring_expenses').select('*').order('name'),
            supabase.from('suppliers').select('id, business_name').eq('is_active', true).order('business_name'),
        ]);
        if (catRes.error) throw catRes.error;
        setCategories((catRes.data || []) as ExpenseCategory[]);
        setTemplates((tplRes.data || []) as RecurringExpense[]);
        setSuppliers((supRes.data || []) as { id: string; business_name: string }[]);
    }, [supabase]);

    const fetchMonth = useCallback(
        async (m: string) => {
            // Genera (idempotente) los gastos fijos del mes antes de listarlos
            const gen = await supabase.rpc('generate_recurring_expenses', { p_month: m });
            if (gen.error) throw gen.error;
            const next = shiftMonth(m, 1);
            const [expRes, salesRes] = await Promise.all([
                supabase.from('expenses').select('*').eq('period_month', m).order('due_date'),
                supabase
                    .from('orders')
                    .select('subtotal')
                    .neq('status', 'cancelado')
                    .gte('created_at', m)
                    .lt('created_at', next),
            ]);
            if (expRes.error) throw expRes.error;
            setExpenses((expRes.data || []) as Expense[]);
            setMonthSales((salesRes.data || []).reduce((acc, o: any) => acc + Number(o.subtotal || 0), 0));
        },
        [supabase]
    );

    const fetchYear = useCallback(
        async (y: number) => {
            const { data, error } = await supabase
                .from('expenses')
                .select('*')
                .gte('period_month', `${y}-01-01`)
                .lte('period_month', `${y}-12-01`)
                .neq('status', 'anulado');
            if (error) throw error;
            setYearExpenses((data || []) as Expense[]);
        },
        [supabase]
    );

    const reload = useCallback(async () => {
        if (!isAdmin) return;
        try {
            setLoading(true);
            await fetchBase();
            if (view === 'year') await fetchYear(year);
            else await fetchMonth(month);
        } catch (err: any) {
            toast.error('Error cargando gastos: ' + dbErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [isAdmin, fetchBase, fetchMonth, fetchYear, view, month, year]);

    useEffect(() => {
        reload();
    }, [reload]);

    // ---------- Derivados del mes ----------
    const active = expenses.filter((e) => e.status !== 'anulado');
    const kpi = useMemo(() => {
        let total = 0;
        let paid = 0;
        let pending = 0;
        let overdue = 0;
        let overdueCount = 0;
        let principal = 0;
        for (const e of active) {
            const a = Number(e.amount);
            total += a;
            principal += Number(e.principal_amount || 0);
            if (e.status === 'pagado') paid += a;
            else {
                pending += a;
                if (daysUntil(e.due_date) < 0) {
                    overdue += a;
                    overdueCount += 1;
                }
            }
        }
        return { total, paid, pending, overdue, overdueCount, principal, cost: total - principal };
    }, [active]);

    const grouped = useMemo(() => {
        return categories
            .map((c) => {
                const items = expenses.filter((e) => e.category_id === c.id);
                const cost = items.filter((e) => e.status !== 'anulado').reduce((acc, e) => acc + expenseCost(e), 0);
                const total = items.filter((e) => e.status !== 'anulado').reduce((acc, e) => acc + Number(e.amount), 0);
                return { category: c, items, cost, total };
            })
            .filter((g) => g.items.length > 0);
    }, [categories, expenses]);

    const maxCost = Math.max(1, ...grouped.map((g) => g.cost));

    // ---------- Acciones sobre gastos ----------
    const updateExpense = async (e: Expense, patch: Partial<Expense>, okMsg: string) => {
        try {
            setBusyId(e.id);
            const { data, error } = await supabase
                .from('expenses')
                .update({ ...patch, updated_at: new Date().toISOString() })
                .eq('id', e.id)
                .select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Sin permiso para modificar el gasto');
            toast.success(okMsg);
            await fetchMonth(month);
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        } finally {
            setBusyId(null);
        }
    };

    const undoPayment = async (e: Expense) => {
        const ok = await confirm({
            title: '¿Deshacer el pago?',
            description: `"${e.description}" volverá a quedar pendiente.`,
            confirmLabel: 'Deshacer pago',
        });
        if (ok)
            updateExpense(
                e,
                { status: 'pendiente', paid_date: null, payment_method: null, reference: null },
                'Pago deshecho'
            );
    };

    const annul = async (e: Expense) => {
        const ok = await confirm({
            title: e.status === 'anulado' ? '¿Reactivar este gasto?' : '¿Anular este gasto del mes?',
            description:
                e.status === 'anulado'
                    ? 'Volverá a contar como pendiente.'
                    : 'No se contará en el mes (ej: no hubo cobro este periodo). El gasto fijo sigue activo para los demás meses.',
            confirmLabel: e.status === 'anulado' ? 'Reactivar' : 'Anular',
        });
        if (ok)
            updateExpense(
                e,
                e.status === 'anulado' ? { status: 'pendiente' } : { status: 'anulado', paid_date: null },
                e.status === 'anulado' ? 'Gasto reactivado' : 'Gasto anulado para este mes'
            );
    };

    const remove = async (e: Expense) => {
        const ok = await confirm({
            title: '¿Eliminar este gasto?',
            description: `"${e.description}" por ${formatCOP(Number(e.amount))} se borrará definitivamente.`,
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        try {
            setBusyId(e.id);
            const { data, error } = await supabase.from('expenses').delete().eq('id', e.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Sin permiso para eliminar');
            toast.success('Gasto eliminado');
            await fetchMonth(month);
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        } finally {
            setBusyId(null);
        }
    };

    // ---------- Acciones sobre plantillas ----------
    const toggleTemplate = async (t: RecurringExpense) => {
        try {
            setBusyId(t.id);
            const { error } = await supabase
                .from('recurring_expenses')
                .update({ is_active: !t.is_active, updated_at: new Date().toISOString() })
                .eq('id', t.id);
            if (error) throw error;
            toast.success(t.is_active ? 'Gasto fijo desactivado: no se generará en meses nuevos' : 'Gasto fijo activado');
            await fetchBase();
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        } finally {
            setBusyId(null);
        }
    };

    const deleteTemplate = async (t: RecurringExpense) => {
        const ok = await confirm({
            title: `¿Eliminar el gasto fijo "${t.name}"?`,
            description:
                'Dejará de generarse. Los gastos ya registrados (pagados o pendientes) se conservan como históricos. Si solo quieres pausarlo, desactívalo.',
            confirmLabel: 'Eliminar gasto fijo',
        });
        if (!ok) return;
        try {
            setBusyId(t.id);
            const { data, error } = await supabase.from('recurring_expenses').delete().eq('id', t.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Sin permiso para eliminar');
            toast.success('Gasto fijo eliminado');
            await fetchBase();
        } catch (err: any) {
            toast.error(dbErrorMessage(err));
        } finally {
            setBusyId(null);
        }
    };

    const templatesByCat = useMemo(
        () =>
            categories
                .map((c) => ({ category: c, items: templates.filter((t) => t.category_id === c.id) }))
                .filter((g) => g.items.length > 0),
        [categories, templates]
    );
    const monthlyFixed = templates.filter((t) => t.is_active).reduce((acc, t) => acc + monthlyCommitment(t), 0);

    // ---------- Resumen anual ----------
    const yearMatrix = useMemo(() => {
        const rows = categories.map((c) => {
            const months = Array.from({ length: 12 }, (_, i) =>
                yearExpenses
                    .filter((e) => e.category_id === c.id && Number(e.period_month.slice(5, 7)) === i + 1)
                    .reduce((acc, e) => acc + expenseCost(e), 0)
            );
            return { category: c, months, total: months.reduce((a, b) => a + b, 0) };
        });
        const principal = Array.from({ length: 12 }, (_, i) =>
            yearExpenses
                .filter((e) => Number(e.period_month.slice(5, 7)) === i + 1)
                .reduce((acc, e) => acc + Number(e.principal_amount || 0), 0)
        );
        const totals = Array.from({ length: 12 }, (_, i) => rows.reduce((acc, r) => acc + r.months[i], 0));
        return { rows: rows.filter((r) => r.total > 0), principal, totals };
    }, [categories, yearExpenses]);

    const exportYear = () => {
        downloadCSV(
            `gastos-${year}.csv`,
            ['Categoría', 'Cuenta PUC', ...MONTH_NAMES, 'Total'],
            [
                ...yearMatrix.rows.map((r) => [
                    r.category.name,
                    r.category.puc_code || '',
                    ...r.months.map((v) => Math.round(v)),
                    Math.round(r.total),
                ]),
                ['TOTAL GASTOS', '', ...yearMatrix.totals.map((v) => Math.round(v)), Math.round(yearMatrix.totals.reduce((a, b) => a + b, 0))],
                ['Abono a capital (no es gasto)', '2105', ...yearMatrix.principal.map((v) => Math.round(v)), Math.round(yearMatrix.principal.reduce((a, b) => a + b, 0))],
            ]
        );
    };

    const exportMonth = () => {
        downloadCSV(
            `gastos-${month.slice(0, 7)}.csv`,
            ['Vence', 'Categoría', 'Cuenta PUC', 'Descripción', 'Beneficiario', 'Valor', 'Abono capital', 'Gasto', 'Estado', 'Fecha pago', 'Medio', 'Referencia'],
            expenses.map((e) => {
                const c = catById.get(e.category_id);
                return [
                    e.due_date,
                    c?.name || '',
                    c?.puc_code || '',
                    e.description,
                    e.payee_name || '',
                    Math.round(Number(e.amount)),
                    Math.round(Number(e.principal_amount || 0)),
                    Math.round(expenseCost(e)),
                    e.status,
                    e.paid_date || '',
                    e.payment_method || '',
                    e.reference || '',
                ];
            })
        );
    };

    if (!isAdmin) {
        return (
            <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                El módulo de gastos solo está disponible para administradores.
            </div>
        );
    }

    const tabCls = (v: View) =>
        `flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
            view === v ? 'bg-[#2E4040] text-white shadow-sm' : 'border border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
        }`;

    return (
        <div className="space-y-6">
            {confirmDialog}

            {/* Encabezado */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Gastos Fijos y Operativos</h2>
                    <p className="text-sm text-[#949E97]">
                        Configura cada gasto fijo una vez; cada mes aparece solo y únicamente confirmas el valor y lo pagas.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setExpenseModal({ mode: 'create', expense: null })}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <Plus className="h-4 w-4" /> Gasto ocasional
                    </button>
                    <button
                        onClick={() => setTemplateModal({ template: null })}
                        className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332]"
                    >
                        <Repeat className="h-4 w-4" /> Nuevo gasto fijo
                    </button>
                </div>
            </div>

            {/* Pestañas */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[#C8CDC9]/80 pb-2">
                <button onClick={() => setView('month')} className={tabCls('month')}>
                    <CalendarDays className="h-3.5 w-3.5 text-[#3F8346]" /> Gastos del mes
                </button>
                <button onClick={() => setView('templates')} className={tabCls('templates')}>
                    <Repeat className="h-3.5 w-3.5 text-[#3F8346]" /> Gastos fijos ({templates.filter((t) => t.is_active).length})
                </button>
                <button onClick={() => setView('year')} className={tabCls('year')}>
                    <TrendingUp className="h-3.5 w-3.5 text-[#3F8346]" /> Resumen anual
                </button>
            </div>

            {/* ===================== MES ===================== */}
            {view === 'month' && (
                <div className="space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setMonth((m) => shiftMonth(m, -1))}
                                className="rounded-md border border-[#C8CDC9] bg-white p-1.5 hover:bg-[#C8CDC9]/20"
                                aria-label="Mes anterior"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="min-w-[160px] text-center text-lg font-bold text-[#2E4040]">{monthLabel(month)}</span>
                            <button
                                onClick={() => setMonth((m) => shiftMonth(m, 1))}
                                className="rounded-md border border-[#C8CDC9] bg-white p-1.5 hover:bg-[#C8CDC9]/20"
                                aria-label="Mes siguiente"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                            {month !== monthStart(todayISO()) && (
                                <button
                                    onClick={() => setMonth(monthStart(todayISO()))}
                                    className="ml-1 text-xs font-semibold text-[#3F8346] hover:underline"
                                >
                                    Ir al mes actual
                                </button>
                            )}
                        </div>
                        <button
                            onClick={exportMonth}
                            disabled={expenses.length === 0}
                            className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-50"
                        >
                            <Download className="h-3.5 w-3.5 text-[#3F8346]" /> Exportar mes
                        </button>
                    </div>

                    {/* KPIs */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Kpi
                            label="Gastos del mes"
                            value={formatCOP(kpi.cost)}
                            sub={kpi.principal > 0 ? `+ ${formatCOP(kpi.principal)} abono a capital (no es gasto)` : `${active.length} pagos programados`}
                            icon={Wallet}
                            cls="bg-[#3F8346]/10 text-[#3F8346]"
                        />
                        <Kpi label="Pagado" value={formatCOP(kpi.paid)} sub={`${active.filter((e) => e.status === 'pagado').length} de ${active.length} pagos`} icon={CheckCircle2} cls="bg-emerald-50 text-emerald-600" />
                        <Kpi
                            label="Por pagar"
                            value={formatCOP(kpi.pending)}
                            sub={kpi.overdueCount > 0 ? `${kpi.overdueCount} vencido(s): ${formatCOP(kpi.overdue)}` : 'Nada vencido'}
                            icon={AlertTriangle}
                            cls={kpi.overdueCount > 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}
                        />
                        <Kpi
                            label="Ventas del mes (sin IVA)"
                            value={formatCOP(monthSales)}
                            sub={monthSales > 0 ? `Los gastos equivalen al ${((kpi.cost / monthSales) * 100).toFixed(0)}% de las ventas` : 'Sin ventas registradas'}
                            icon={TrendingUp}
                            cls="bg-blue-50 text-blue-600"
                        />
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : expenses.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                            <Repeat className="mx-auto h-10 w-10 text-[#949E97]" />
                            <h3 className="mt-3 font-semibold text-[#2E4040]">No hay gastos en {monthLabel(month)}</h3>
                            <p className="mx-auto mt-1 max-w-md text-xs text-[#949E97]">
                                Empieza creando tus gastos fijos (nómina, arriendo, servicios, créditos, ICA...). A partir de ahí
                                aparecerán solos en cada mes.
                            </p>
                            <button
                                onClick={() => setTemplateModal({ template: null })}
                                className="mt-4 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332]"
                            >
                                Crear el primer gasto fijo
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_300px]">
                            {/* Lista por categoría */}
                            <div className="space-y-4">
                                {grouped.map(({ category: c, items, total }) => (
                                    <div key={c.id} className="overflow-hidden rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                                        <div className="flex items-center justify-between border-b border-[#C8CDC9]/60 bg-[#F8F9FA] px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                                                <span className="text-sm font-bold text-[#2E4040]">{c.name}</span>
                                                {c.puc_code && <span className="text-[10px] text-[#949E97]">PUC {c.puc_code}</span>}
                                            </div>
                                            <span className="text-sm font-bold text-[#2E4040]">{formatCOP(total)}</span>
                                        </div>
                                        <ul className="divide-y divide-[#C8CDC9]/40">
                                            {items.map((e) => {
                                                const tpl = templates.find((t) => t.id === e.recurring_id);
                                                const d = daysUntil(e.due_date);
                                                const pending = e.status === 'pendiente';
                                                const annulled = e.status === 'anulado';
                                                return (
                                                    <li
                                                        key={e.id}
                                                        className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs ${annulled ? 'opacity-50' : ''}`}
                                                    >
                                                        <div className="min-w-[200px] flex-1">
                                                            <div className={`font-semibold text-[#2E4040] ${annulled ? 'line-through' : ''}`}>
                                                                {e.description}
                                                                {e.installment_number && tpl?.installments_total && (
                                                                    <span className="ml-1.5 font-normal text-[#949E97]">
                                                                        cuota {e.installment_number}/{tpl.installments_total}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[#949E97]">
                                                                {e.payee_name && <span>{e.payee_name}</span>}
                                                                {e.recurring_id ? (
                                                                    <span className="rounded bg-[#C8CDC9]/40 px-1">fijo</span>
                                                                ) : (
                                                                    <span className="rounded bg-blue-50 px-1 text-blue-700">ocasional</span>
                                                                )}
                                                                {tpl?.is_variable && pending && (
                                                                    <span className="rounded bg-amber-50 px-1 text-amber-700">valor estimado</span>
                                                                )}
                                                                {Number(e.principal_amount) > 0 && (
                                                                    <span>capital {formatCOP(Number(e.principal_amount))} · interés {formatCOP(expenseCost(e))}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="w-28">
                                                            <div className="text-[#2E4040]">{formatDate(e.due_date)}</div>
                                                            {pending && (
                                                                <div
                                                                    className={`text-[10px] font-semibold ${
                                                                        d < 0 ? 'text-red-600' : d <= 3 ? 'text-amber-700' : 'text-[#949E97]'
                                                                    }`}
                                                                >
                                                                    {d < 0 ? `Vencido hace ${-d} d` : d === 0 ? 'Vence hoy' : `En ${d} d`}
                                                                </div>
                                                            )}
                                                            {e.status === 'pagado' && (
                                                                <div className="text-[10px] font-semibold text-emerald-700">
                                                                    Pagado {formatDate(e.paid_date)}
                                                                </div>
                                                            )}
                                                            {annulled && <div className="text-[10px] text-[#949E97]">Anulado</div>}
                                                        </div>
                                                        <div className="w-28 text-right text-sm font-bold text-[#2E4040]">
                                                            {formatCOP(Number(e.amount))}
                                                        </div>
                                                        <div className="flex w-[190px] items-center justify-end gap-1">
                                                            {busyId === e.id ? (
                                                                <Loader2 className="h-4 w-4 animate-spin text-[#3F8346]" />
                                                            ) : (
                                                                <>
                                                                    {pending && (
                                                                        <button
                                                                            onClick={() => setExpenseModal({ mode: 'pay', expense: e })}
                                                                            className="rounded bg-[#3F8346] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#2d6332]"
                                                                        >
                                                                            Pagar
                                                                        </button>
                                                                    )}
                                                                    {e.status === 'pagado' && (
                                                                        <button
                                                                            onClick={() => undoPayment(e)}
                                                                            className="flex items-center gap-1 rounded border border-[#C8CDC9] px-2 py-1 text-[11px] text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                                                            title={`${e.reference ? 'Ref. ' + e.reference + ' · ' : ''}Deshacer pago`}
                                                                        >
                                                                            <RotateCcw className="h-3 w-3" /> Deshacer
                                                                        </button>
                                                                    )}
                                                                    {pending && (
                                                                        <button
                                                                            onClick={() => setExpenseModal({ mode: 'edit', expense: e })}
                                                                            className="rounded p-1 text-gray-500 hover:bg-gray-100"
                                                                            title="Editar valor o fecha"
                                                                        >
                                                                            <Pencil className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    )}
                                                                    {e.status !== 'pagado' && e.recurring_id && (
                                                                        <button
                                                                            onClick={() => annul(e)}
                                                                            className="rounded p-1 text-gray-500 hover:bg-gray-100"
                                                                            title={annulled ? 'Reactivar' : 'Anular este mes'}
                                                                        >
                                                                            <Ban className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    )}
                                                                    {!e.recurring_id && (
                                                                        <button
                                                                            onClick={() => remove(e)}
                                                                            className="rounded p-1 text-red-500 hover:bg-red-50"
                                                                            title="Eliminar"
                                                                        >
                                                                            <Trash2 className="h-3.5 w-3.5" />
                                                                        </button>
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                ))}
                            </div>

                            {/* Distribución */}
                            <div className="h-fit space-y-3 rounded-xl border border-[#C8CDC9]/60 bg-white p-4 shadow-sm">
                                <h3 className="text-sm font-bold text-[#2E4040]">Distribución del gasto</h3>
                                {grouped
                                    .slice()
                                    .sort((a, b) => b.cost - a.cost)
                                    .map(({ category: c, cost }) => (
                                        <div key={c.id} className="text-xs">
                                            <div className="mb-0.5 flex justify-between">
                                                <span className="text-[#2E4040]">{c.name}</span>
                                                <span className="font-semibold text-[#2E4040]">
                                                    {formatCOP(cost)}
                                                    <span className="ml-1 font-normal text-[#949E97]">
                                                        {kpi.cost > 0 ? `${((cost / kpi.cost) * 100).toFixed(0)}%` : ''}
                                                    </span>
                                                </span>
                                            </div>
                                            <div className="h-2 rounded-full bg-[#C8CDC9]/40">
                                                <div className="h-2 rounded-full" style={{ width: `${(cost / maxCost) * 100}%`, backgroundColor: c.color }} />
                                            </div>
                                        </div>
                                    ))}
                                <div className="space-y-0.5 border-t border-[#C8CDC9] pt-2 text-[11px] text-[#949E97]">
                                    {(['operacional', 'financiero', 'no_operacional'] as const).map((g) => {
                                        const v = grouped
                                            .filter((x) => x.category.expense_group === g)
                                            .reduce((acc, x) => acc + x.cost, 0);
                                        return v > 0 ? (
                                            <div key={g} className="flex justify-between">
                                                <span>{GROUP_LABELS[g]}</span>
                                                <span className="font-semibold text-[#2E4040]">{formatCOP(v)}</span>
                                            </div>
                                        ) : null;
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ===================== PLANTILLAS ===================== */}
            {view === 'templates' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#C8CDC9]/60 bg-white px-5 py-4 shadow-sm">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">Compromiso fijo mensual estimado</div>
                            <div className="text-2xl font-bold text-[#2E4040]">{formatCOP(monthlyFixed)}</div>
                            <div className="text-[11px] text-[#949E97]">
                                Suma de los gastos fijos activos llevados a valor mensual (ej: un bimestral cuenta la mitad).
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {categories
                                .filter((c) => c.is_active && !templates.some((t) => t.category_id === c.id))
                                .map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => setTemplateModal({ template: null, categoryId: c.id })}
                                        className="flex items-center gap-1 rounded-full border border-dashed border-[#949E97] px-2.5 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                    >
                                        <Plus className="h-3 w-3" /> {c.name}
                                    </button>
                                ))}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : templatesByCat.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                            Aún no hay gastos fijos. Usa los botones de arriba para crear el primero de cada categoría.
                        </div>
                    ) : (
                        templatesByCat.map(({ category: c, items }) => (
                            <div key={c.id} className="overflow-hidden rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                                <div className="flex items-center justify-between border-b border-[#C8CDC9]/60 bg-[#F8F9FA] px-4 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />
                                        <span className="text-sm font-bold text-[#2E4040]">{c.name}</span>
                                        <span className="text-[10px] text-[#949E97]">
                                            {GROUP_LABELS[c.expense_group]}
                                            {c.puc_code ? ` · PUC ${c.puc_code}` : ''}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setTemplateModal({ template: null, categoryId: c.id })}
                                        className="flex items-center gap-1 text-[11px] font-semibold text-[#3F8346] hover:underline"
                                    >
                                        <Plus className="h-3 w-3" /> Agregar
                                    </button>
                                </div>
                                <table className="w-full text-left text-xs">
                                    <tbody className="divide-y divide-[#C8CDC9]/40">
                                        {items.map((t) => (
                                            <tr key={t.id} className={t.is_active ? '' : 'opacity-50'}>
                                                <td className="px-4 py-2.5">
                                                    <div className="font-semibold text-[#2E4040]">{t.name}</div>
                                                    <div className="text-[10px] text-[#949E97]">
                                                        {t.payee_name || suppliers.find((s) => s.id === t.supplier_id)?.business_name || 'Sin beneficiario'}
                                                        {t.notes ? ` · ${t.notes}` : ''}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="font-bold text-[#2E4040]">{formatCOP(Number(t.amount))}</div>
                                                    {t.is_variable && <div className="text-[10px] text-amber-700">valor variable (estimado)</div>}
                                                    {Number(t.principal_amount) > 0 && (
                                                        <div className="text-[10px] text-[#949E97]">capital {formatCOP(Number(t.principal_amount))}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5 text-[#2E4040]">
                                                    {FREQUENCY_SHORT[t.frequency]}
                                                    <div className="text-[10px] text-[#949E97]">
                                                        {t.frequency === 'quincenal' ? 'días 15 y último' : `día ${t.due_day}`}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-[#949E97]">
                                                    desde {monthLabel(t.start_date)}
                                                    {t.end_date && <div>hasta {monthLabel(t.end_date)}</div>}
                                                    {t.installments_total && <div>{t.installments_total} cuotas</div>}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center justify-end gap-1">
                                                        {busyId === t.id ? (
                                                            <Loader2 className="h-4 w-4 animate-spin text-[#3F8346]" />
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => setTemplateModal({ template: t })}
                                                                    className="rounded p-1 text-gray-500 hover:bg-gray-100"
                                                                    title="Editar"
                                                                >
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => toggleTemplate(t)}
                                                                    className={`rounded p-1 hover:bg-gray-100 ${t.is_active ? 'text-emerald-600' : 'text-gray-400'}`}
                                                                    title={t.is_active ? 'Desactivar (pausar)' : 'Activar'}
                                                                >
                                                                    <Power className="h-3.5 w-3.5" />
                                                                </button>
                                                                <button
                                                                    onClick={() => deleteTemplate(t)}
                                                                    className="rounded p-1 text-red-500 hover:bg-red-50"
                                                                    title="Eliminar"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* ===================== AÑO ===================== */}
            {view === 'year' && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setYear((y) => y - 1)}
                                className="rounded-md border border-[#C8CDC9] bg-white p-1.5 hover:bg-[#C8CDC9]/20"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <span className="min-w-[80px] text-center text-lg font-bold text-[#2E4040]">{year}</span>
                            <button
                                onClick={() => setYear((y) => y + 1)}
                                className="rounded-md border border-[#C8CDC9] bg-white p-1.5 hover:bg-[#C8CDC9]/20"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                        <button
                            onClick={exportYear}
                            disabled={yearMatrix.rows.length === 0}
                            className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-50"
                        >
                            <Download className="h-3.5 w-3.5 text-[#3F8346]" /> Exportar año
                        </button>
                    </div>
                    <p className="text-[11px] text-[#949E97]">
                        Gasto causado por mes (pagado + pendiente, sin anulados). En créditos solo cuentan los intereses; el
                        abono a capital se muestra aparte. Solo incluye los meses ya abiertos en &quot;Gastos del mes&quot;.
                    </p>
                    {loading ? (
                        <div className="flex justify-center py-16">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : yearMatrix.rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                            Sin gastos registrados en {year}.
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                            <table className="w-full text-right text-[11px]">
                                <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                                    <tr>
                                        <th className="sticky left-0 bg-[#F8F9FA] px-3 py-2.5 text-left">Categoría</th>
                                        {MONTH_NAMES.map((m) => (
                                            <th key={m} className="px-2 py-2.5">
                                                {m.slice(0, 3)}
                                            </th>
                                        ))}
                                        <th className="px-3 py-2.5">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/40">
                                    {yearMatrix.rows.map((r) => (
                                        <tr key={r.category.id}>
                                            <td className="sticky left-0 bg-white px-3 py-2 text-left font-semibold text-[#2E4040]">
                                                <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.category.color }} />
                                                {r.category.name}
                                            </td>
                                            {r.months.map((v, i) => (
                                                <td key={i} className="px-2 py-2 text-[#2E4040]">
                                                    {v > 0 ? Math.round(v / 1000).toLocaleString('es-CO') + 'k' : '—'}
                                                </td>
                                            ))}
                                            <td className="px-3 py-2 font-bold text-[#2E4040]">{formatCOP(r.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="border-t-2 border-[#2E4040]">
                                    <tr className="font-bold text-[#2E4040]">
                                        <td className="sticky left-0 bg-white px-3 py-2 text-left">Total gastos</td>
                                        {yearMatrix.totals.map((v, i) => (
                                            <td key={i} className="px-2 py-2">
                                                {v > 0 ? Math.round(v / 1000).toLocaleString('es-CO') + 'k' : '—'}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2">{formatCOP(yearMatrix.totals.reduce((a, b) => a + b, 0))}</td>
                                    </tr>
                                    {yearMatrix.principal.some((v) => v > 0) && (
                                        <tr className="text-[#949E97]">
                                            <td className="sticky left-0 bg-white px-3 py-2 text-left">Abono a capital (no es gasto)</td>
                                            {yearMatrix.principal.map((v, i) => (
                                                <td key={i} className="px-2 py-2">
                                                    {v > 0 ? Math.round(v / 1000).toLocaleString('es-CO') + 'k' : '—'}
                                                </td>
                                            ))}
                                            <td className="px-3 py-2">{formatCOP(yearMatrix.principal.reduce((a, b) => a + b, 0))}</td>
                                        </tr>
                                    )}
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {templateModal && (
                <RecurringExpenseModal
                    template={templateModal.template}
                    defaultCategoryId={templateModal.categoryId}
                    categories={categories}
                    suppliers={suppliers}
                    onClose={() => setTemplateModal(null)}
                    onSaved={reload}
                />
            )}
            {expenseModal && (
                <ExpenseModal
                    mode={expenseModal.mode}
                    expense={expenseModal.expense}
                    categories={categories}
                    defaultDate={month === monthStart(todayISO()) ? todayISO() : month}
                    onClose={() => setExpenseModal(null)}
                    onSaved={reload}
                />
            )}
        </div>
    );
}

function Kpi({
    label,
    value,
    sub,
    icon: Icon,
    cls,
}: {
    label: string;
    value: string;
    sub: string;
    icon: React.ComponentType<{ className?: string }>;
    cls: string;
}) {
    return (
        <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">{label}</span>
                <div className={`rounded-lg p-2 ${cls}`}>
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <div className="mt-3 text-2xl font-bold text-[#2E4040]">{value}</div>
            <div className="mt-1 text-xs text-[#949E97]">{sub}</div>
        </div>
    );
}
