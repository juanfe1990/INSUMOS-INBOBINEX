'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { ExpenseCategory, ExpenseFrequency, RecurringExpense } from '@/lib/types';
import { INPUT, LABEL, dbErrorMessage, formatCOP, todayISO } from '@/components/admin/suppliers/utils';
import { FREQUENCY_LABELS, MONTHLY_FACTOR, monthStart } from './utils';

type Props = {
    template: RecurringExpense | null;
    categories: ExpenseCategory[];
    suppliers: { id: string; business_name: string }[];
    defaultCategoryId?: string;
    onClose: () => void;
    onSaved: () => void;
};

export default function RecurringExpenseModal({ template, categories, suppliers, defaultCategoryId, onClose, onSaved }: Props) {
    const supabase = createClient();
    const [saving, setSaving] = useState(false);
    const [f, setF] = useState({
        category_id: template?.category_id || defaultCategoryId || categories[0]?.id || '',
        name: template?.name || '',
        payee_name: template?.payee_name || '',
        supplier_id: template?.supplier_id || '',
        amount: template ? String(Number(template.amount)) : '',
        is_variable: template?.is_variable ?? false,
        frequency: (template?.frequency || 'mensual') as ExpenseFrequency,
        due_day: String(template?.due_day ?? 5),
        start_month: (template?.start_date || monthStart(todayISO())).slice(0, 7),
        end_month: template?.end_date ? template.end_date.slice(0, 7) : '',
        installments_total: template?.installments_total ? String(template.installments_total) : '',
        principal_amount: template ? String(Number(template.principal_amount || 0)) : '0',
        notes: template?.notes || '',
        apply_to_pending: true,
    });

    const category = categories.find((c) => c.id === f.category_id);
    const isCredit = category?.expense_group === 'financiero';
    const amount = Number(f.amount) || 0;
    const principal = isCredit ? Number(f.principal_amount) || 0 : 0;
    const monthly = amount * MONTHLY_FACTOR[f.frequency];

    const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!f.category_id) return toast.error('Selecciona la categoría');
        if (!f.name.trim()) return toast.error('Ponle un nombre al gasto (ej: Arriendo bodega)');
        if (!(amount >= 0) || f.amount === '') return toast.error('Ingresa el valor');
        const day = Number(f.due_day);
        if (f.frequency !== 'quincenal' && !(Number.isInteger(day) && day >= 1 && day <= 31))
            return toast.error('El día de pago debe estar entre 1 y 31');
        if (principal > amount) return toast.error('El abono a capital no puede superar la cuota');
        if (f.end_month && f.end_month < f.start_month) return toast.error('El mes final no puede ser anterior al inicial');

        const lastDay = (ym: string) => {
            const [y, m] = ym.split('-').map(Number);
            return new Date(y, m, 0).getDate();
        };
        const payload = {
            category_id: f.category_id,
            name: f.name.trim(),
            payee_name: f.payee_name.trim() || null,
            supplier_id: f.supplier_id || null,
            amount,
            is_variable: f.is_variable,
            frequency: f.frequency,
            due_day: f.frequency === 'quincenal' ? 15 : day,
            start_date: `${f.start_month}-01`,
            end_date: f.end_month ? `${f.end_month}-${String(lastDay(f.end_month)).padStart(2, '0')}` : null,
            installments_total: isCredit && f.installments_total ? Number(f.installments_total) : null,
            principal_amount: principal,
            notes: f.notes.trim() || null,
            updated_at: new Date().toISOString(),
        };

        try {
            setSaving(true);
            if (template) {
                const { data, error } = await supabase
                    .from('recurring_expenses')
                    .update(payload)
                    .eq('id', template.id)
                    .select('id');
                if (error) throw error;
                if (!data?.length) throw new Error('Solo un administrador puede editar gastos fijos');
                if (f.apply_to_pending) {
                    // Actualiza los gastos ya generados que siguen pendientes (de hoy en adelante)
                    const { error: upErr } = await supabase
                        .from('expenses')
                        .update({
                            category_id: payload.category_id,
                            description: payload.name,
                            payee_name: payload.payee_name,
                            supplier_id: payload.supplier_id,
                            amount: payload.amount,
                            principal_amount: payload.principal_amount,
                            updated_at: payload.updated_at,
                        })
                        .eq('recurring_id', template.id)
                        .eq('status', 'pendiente')
                        .gte('due_date', todayISO());
                    if (upErr) throw upErr;
                }
                toast.success('Gasto fijo actualizado');
            } else {
                const { error } = await supabase.from('recurring_expenses').insert(payload);
                if (error) throw error;
                toast.success('Gasto fijo creado: aparecerá automáticamente en cada mes que corresponda');
            }
            onSaved();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo guardar: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                            {template ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
                        </h3>
                        <p className="text-[11px] text-[#949E97]">
                            Se configura una vez y se genera solo en cada periodo; cada mes solo confirmas y pagas.
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
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
                                            {c.puc_code ? ` (PUC ${c.puc_code})` : ''}
                                        </option>
                                    ))}
                            </select>
                            {category?.description && <p className="mt-0.5 text-[10px] text-[#949E97]">{category.description}</p>}
                        </div>
                        <div>
                            <label className={LABEL}>Nombre del gasto *</label>
                            <input
                                value={f.name}
                                onChange={(e) => set({ name: e.target.value })}
                                placeholder={isCredit ? 'Ej: Crédito Bancolombia maquinaria' : 'Ej: Arriendo bodega principal'}
                                className={INPUT}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={LABEL}>Beneficiario (a quién se le paga)</label>
                            <input
                                value={f.payee_name}
                                onChange={(e) => set({ payee_name: e.target.value })}
                                placeholder="Ej: EPM, Inmobiliaria XYZ, Bancolombia"
                                className={INPUT}
                            />
                        </div>
                        <div>
                            <label className={LABEL}>o proveedor registrado</label>
                            <select
                                value={f.supplier_id}
                                onChange={(e) => set({ supplier_id: e.target.value })}
                                className={`${INPUT} bg-white`}
                            >
                                <option value="">— Ninguno —</option>
                                {suppliers.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.business_name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className={LABEL}>{isCredit ? 'Valor de la cuota ($) *' : 'Valor ($) *'}</label>
                            <input
                                type="number"
                                min="0"
                                step="any"
                                value={f.amount}
                                onChange={(e) => set({ amount: e.target.value })}
                                className={`${INPUT} font-bold`}
                            />
                        </div>
                        <div>
                            <label className={LABEL}>Frecuencia *</label>
                            <select
                                value={f.frequency}
                                onChange={(e) => set({ frequency: e.target.value as ExpenseFrequency })}
                                className={`${INPUT} bg-white`}
                            >
                                {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                                    <option key={k} value={k}>
                                        {v}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={LABEL}>Día de pago</label>
                            {f.frequency === 'quincenal' ? (
                                <div className="rounded border border-dashed border-[#C8CDC9] px-2.5 py-1.5 text-xs text-[#949E97]">
                                    15 y último día
                                </div>
                            ) : (
                                <input
                                    type="number"
                                    min="1"
                                    max="31"
                                    value={f.due_day}
                                    onChange={(e) => set({ due_day: e.target.value })}
                                    className={INPUT}
                                />
                            )}
                        </div>
                    </div>

                    <label className="flex items-start gap-2 text-xs text-[#2E4040]">
                        <input
                            type="checkbox"
                            checked={f.is_variable}
                            onChange={(e) => set({ is_variable: e.target.checked })}
                            className="mt-0.5 accent-[#3F8346]"
                        />
                        <span>
                            <b>El valor cambia cada periodo</b> (ej: servicios públicos). Se usa este valor como estimado y
                            al pagar confirmas el valor real de la factura.
                        </span>
                    </label>

                    {isCredit && (
                        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
                            <div className="mb-2 text-xs font-bold text-violet-900">Datos del crédito</div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>Número de cuotas</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={f.installments_total}
                                        onChange={(e) => set({ installments_total: e.target.value })}
                                        placeholder="Ej: 36"
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>Abono a capital por cuota ($)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={f.principal_amount}
                                        onChange={(e) => set({ principal_amount: e.target.value })}
                                        className={INPUT}
                                    />
                                </div>
                            </div>
                            <p className="mt-1.5 text-[11px] text-violet-900">
                                Intereses por cuota (gasto financiero): <b>{formatCOP(Math.max(amount - principal, 0))}</b>. El
                                abono a capital no es gasto: reduce la deuda. Al pagar cada cuota puedes ajustar la división
                                según el extracto del banco.
                            </p>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={LABEL}>Desde (mes) *</label>
                            <input
                                type="month"
                                required
                                value={f.start_month}
                                onChange={(e) => set({ start_month: e.target.value })}
                                className={INPUT}
                            />
                        </div>
                        <div>
                            <label className={LABEL}>Hasta (mes, opcional)</label>
                            <input
                                type="month"
                                value={f.end_month}
                                onChange={(e) => set({ end_month: e.target.value })}
                                className={INPUT}
                            />
                        </div>
                    </div>

                    <div>
                        <label className={LABEL}>Notas</label>
                        <input
                            value={f.notes}
                            onChange={(e) => set({ notes: e.target.value })}
                            placeholder="Ej: contrato hasta dic 2027, incremento IPC en enero"
                            className={INPUT}
                        />
                    </div>

                    {template && (
                        <label className="flex items-center gap-2 text-xs text-[#2E4040]">
                            <input
                                type="checkbox"
                                checked={f.apply_to_pending}
                                onChange={(e) => set({ apply_to_pending: e.target.checked })}
                                className="accent-[#3F8346]"
                            />
                            Aplicar los cambios a los gastos ya generados que siguen pendientes (de hoy en adelante)
                        </label>
                    )}

                    <div className="flex items-center justify-between border-t border-[#C8CDC9] pt-3">
                        <span className="text-[11px] text-[#949E97]">
                            {f.frequency === 'unico' ? 'Pago único' : `Equivale a ~${formatCOP(monthly)} al mes`}
                        </span>
                        <div className="flex gap-2">
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
                                {template ? 'Guardar cambios' : 'Crear gasto fijo'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
