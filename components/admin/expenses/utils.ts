import type { Expense, ExpenseFrequency, ExpenseGroup, RecurringExpense } from '@/lib/types';

export const FREQUENCY_LABELS: Record<ExpenseFrequency, string> = {
    quincenal: 'Quincenal (15 y fin de mes)',
    mensual: 'Mensual',
    bimestral: 'Bimestral',
    trimestral: 'Trimestral',
    semestral: 'Semestral',
    anual: 'Anual',
    unico: 'Una sola vez',
};

export const FREQUENCY_SHORT: Record<ExpenseFrequency, string> = {
    quincenal: 'Quincenal',
    mensual: 'Mensual',
    bimestral: 'Bimestral',
    trimestral: 'Trimestral',
    semestral: 'Semestral',
    anual: 'Anual',
    unico: 'Único',
};

/** Ocurrencias por mes, para estimar el compromiso mensual de una plantilla */
export const MONTHLY_FACTOR: Record<ExpenseFrequency, number> = {
    quincenal: 2,
    mensual: 1,
    bimestral: 1 / 2,
    trimestral: 1 / 3,
    semestral: 1 / 6,
    anual: 1 / 12,
    unico: 0,
};

export const GROUP_LABELS: Record<ExpenseGroup, string> = {
    operacional: 'Operacional',
    no_operacional: 'No operacional',
    financiero: 'Financiero',
};

export const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** 'YYYY-MM-01' del mes que contiene la fecha ISO */
export const monthStart = (iso: string) => iso.slice(0, 7) + '-01';

export function shiftMonth(monthISO: string, delta: number): string {
    const [y, m] = monthISO.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function monthLabel(monthISO: string): string {
    const [y, m] = monthISO.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Parte del pago que es gasto (en créditos el abono a capital no es gasto) */
export const expenseCost = (e: Pick<Expense, 'amount' | 'principal_amount'>) =>
    Math.max(Number(e.amount) - Number(e.principal_amount || 0), 0);

export const monthlyCommitment = (t: Pick<RecurringExpense, 'amount' | 'frequency'>) =>
    Number(t.amount) * MONTHLY_FACTOR[t.frequency];
