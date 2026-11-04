'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Expense, ExpenseCategory, PaymentMethod, TreasuryAccount } from '@/lib/types';
import AccountSelect, { suggestAccount } from '@/components/admin/treasury/account-select';
import { INPUT, LABEL, METHOD_LABELS, dbErrorMessage, formatCOP, todayISO } from '@/components/admin/suppliers/utils';
import { monthStart } from './utils';

/**
 * mode:
 *  - 'pay'    → confirmar valor real y registrar el pago de un gasto pendiente
 *  - 'edit'   → corregir un gasto pendiente (valor, vencimiento, descripción)
 *  - 'create' → gasto ocasional (no recurrente), opcionalmente ya pagado
 */
type Props = {
    mode: 'pay' | 'edit' | 'create';
    expense: Expense | null;
    categories: ExpenseCategory[];
    defaultDate: string;
    onClose: () => void;
    onSaved: () => void;
};

export default function ExpenseModal({ mode, expense, categories, defaultDate, onClose, onSaved }: Props) {
    const supabase = createClient();
    const [saving, setSaving] = useState(false);
    const [f, setF] = useState({
        category_id: expense?.category_id || categories.find((c) => c.is_active)?.id || '',
        description: expense?.description || '',
        payee_name: expense?.payee_name || '',
        due_date: expense?.due_date || defaultDate,
        amount: expense ? String(Number(expense.amount)) : '',
        principal_amount: expense ? String(Number(expense.principal_amount || 0)) : '0',
        paid: mode === 'pay',
        paid_date: expense?.paid_date || todayISO(),
        payment_method: (expense?.payment_method || 'transferencia') as PaymentMethod,
        reference: expense?.reference || '',
        notes: expense?.notes || '',
        account_id: expense?.account_id || '',
    });
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
    const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));

    const category = categories.find((c) => c.id === f.category_id);
    const isCredit = category?.expense_group === 'financiero';
    const amount = Number(f.amount) || 0;
    const principal = isCredit ? Number(f.principal_amount) || 0 : 0;
    const estimated = expense ? Number(expense.amount) : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (f.amount === '' || amount < 0) return toast.error('Ingresa el valor');
        if (principal > amount) return toast.error('El abono a capital no puede superar el valor pagado');
        if (mode === 'create' && !f.description.trim()) return toast.error('Describe el gasto');
        if (f.paid && !f.paid_date) return toast.error('Indica la fecha de pago');

        const paidFields = f.paid
            ? {
                  status: 'pagado' as const,
                  paid_date: f.paid_date,
                  payment_method: f.payment_method,
                  reference: f.reference.trim() || null,
                  account_id: f.account_id || null,
              }
            : {};
        try {
            setSaving(true);
            if (mode === 'create') {
                const { error } = await supabase.from('expenses').insert({
                    category_id: f.category_id,
                    description: f.description.trim(),
                    payee_name: f.payee_name.trim() || null,
                    period_month: monthStart(f.due_date),
                    due_date: f.due_date,
                    amount,
                    principal_amount: principal,
                    notes: f.notes.trim() || null,
                    ...paidFields,
                });
                if (error) throw error;
                toast.success(f.paid ? 'Gasto registrado como pagado' : 'Gasto registrado como pendiente');
            } else if (expense) {
                const { data, error } = await supabase
                    .from('expenses')
                    .update({
                        category_id: f.category_id,
                        description: f.description.trim() || expense.description,
                        payee_name: f.payee_name.trim() || null,
                        due_date: f.due_date,
                        period_month: monthStart(f.due_date),
                        amount,
                        principal_amount: principal,
                        notes: f.notes.trim() || null,
                        updated_at: new Date().toISOString(),
                        ...paidFields,
                    })
                    .eq('id', expense.id)
                    .select('id');
                if (error) throw error;
                if (!data?.length) throw new Error('Solo un administrador puede modificar gastos');
                toast.success(mode === 'pay' ? `Pago registrado: ${formatCOP(amount)}` : 'Gasto actualizado');
            }
            onSaved();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo guardar: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const title =
        mode === 'pay' ? `Pagar: ${expense?.description}` : mode === 'edit' ? 'Editar gasto' : 'Nuevo gasto ocasional';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-base font-bold text-[#2E4040]">{title}</h3>
                        {expense?.installment_number && (
                            <p className="text-[11px] text-[#949E97]">Cuota #{expense.installment_number}</p>
                        )}
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3 px-6 py-5">
                    {mode !== 'pay' && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>Categoría *</label>
                                    <select
                                        value={f.category_id}
                                        onChange={(e) => set({ category_id: e.target.value })}
                                        className={`${INPUT} bg-white`}
                                    >
                                        {categories
                                            .filter((c) => c.is_active || c.id === f.category_id)
                                            .map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                                <div>
                                    <label className={LABEL}>Vence / fecha *</label>
                                    <input
                                        type="date"
                                        required
                                        value={f.due_date}
                                        onChange={(e) => set({ due_date: e.target.value })}
                                        className={INPUT}
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>Descripción *</label>
                                    <input
                                        value={f.description}
                                        onChange={(e) => set({ description: e.target.value })}
                                        placeholder="Ej: Reparación montacargas"
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>Beneficiario</label>
                                    <input
                                        value={f.payee_name}
                                        onChange={(e) => set({ payee_name: e.target.value })}
                                        className={INPUT}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    <div className={`grid gap-3 ${isCredit ? 'grid-cols-3' : 'grid-cols-1'}`}>
                        <div>
                            <label className={LABEL}>
                                {mode === 'pay' ? 'Valor real pagado ($) *' : isCredit ? 'Valor cuota ($) *' : 'Valor ($) *'}
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={f.amount}
                                onChange={(e) => set({ amount: e.target.value })}
                                className={`${INPUT} text-sm font-bold`}
                            />
                            {mode === 'pay' && estimated !== null && amount !== estimated && (
                                <p className="mt-0.5 text-[10px] text-amber-700">
                                    Estimado: {formatCOP(estimated)} ({amount > estimated ? '+' : ''}
                                    {formatCOP(amount - estimated)})
                                </p>
                            )}
                        </div>
                        {isCredit && (
                            <>
                                <div>
                                    <label className={LABEL}>Abono a capital ($)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={f.principal_amount}
                                        onChange={(e) => set({ principal_amount: e.target.value })}
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <span className={LABEL}>Intereses (gasto)</span>
                                    <div className="rounded border border-dashed border-[#C8CDC9] px-2.5 py-1.5 text-xs font-semibold text-[#2E4040]">
                                        {formatCOP(Math.max(amount - principal, 0))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {mode === 'create' && (
                        <label className="flex items-center gap-2 text-xs font-semibold text-[#2E4040]">
                            <input
                                type="checkbox"
                                checked={f.paid}
                                onChange={(e) => set({ paid: e.target.checked })}
                                className="accent-[#3F8346]"
                            />
                            Ya está pagado
                        </label>
                    )}

                    {f.paid && (
                        <div className="grid grid-cols-3 gap-3 rounded-lg border border-[#C8CDC9] bg-slate-50/60 p-3">
                            <div>
                                <label className={LABEL}>Fecha de pago *</label>
                                <input
                                    type="date"
                                    value={f.paid_date}
                                    onChange={(e) => set({ paid_date: e.target.value })}
                                    className={INPUT}
                                />
                            </div>
                            <div>
                                <label className={LABEL}>Medio</label>
                                <select
                                    value={f.payment_method}
                                    onChange={(e) =>
                                        set({
                                            payment_method: e.target.value as PaymentMethod,
                                            account_id: suggestAccount(accounts, e.target.value),
                                        })
                                    }
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
                                <label className={LABEL}>Referencia / soporte</label>
                                <input
                                    value={f.reference}
                                    onChange={(e) => set({ reference: e.target.value })}
                                    placeholder="N.º factura o transf."
                                    className={INPUT}
                                />
                            </div>
                            <div className="col-span-3">
                                <label className={LABEL}>Sale de (caja / banco / caja menor)</label>
                                <AccountSelect
                                    value={f.account_id}
                                    onChange={(id) => set({ account_id: id })}
                                    className={`${INPUT} bg-white`}
                                    onLoaded={(list) => {
                                        setAccounts(list);
                                        if (!f.account_id) set({ account_id: suggestAccount(list, f.payment_method) });
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <div>
                        <label className={LABEL}>Notas</label>
                        <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} className={INPUT} />
                    </div>

                    <div className="flex justify-end gap-2 border-t border-[#C8CDC9] pt-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                        >
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {mode === 'pay' ? 'Registrar pago' : mode === 'edit' ? 'Guardar' : 'Registrar gasto'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
