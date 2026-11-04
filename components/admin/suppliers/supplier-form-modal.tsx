'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Supplier, SupplierCategory } from '@/lib/types';
import { CATEGORY_LABELS, INPUT, LABEL, computeNitDV, dbErrorMessage } from './utils';

type Props = {
    supplier: Supplier | null; // null = crear
    onClose: () => void;
    onSaved: () => void;
};

export default function SupplierFormModal({ supplier, onClose, onSaved }: Props) {
    const supabase = createClient();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        business_name: supplier?.business_name ?? '',
        nit: supplier?.nit ?? '',
        verification_digit: supplier?.verification_digit != null ? String(supplier.verification_digit) : '',
        category: (supplier?.category ?? 'materia_prima') as SupplierCategory,
        contact_name: supplier?.contact_name ?? '',
        phone: supplier?.phone ?? '',
        email: supplier?.email ?? '',
        address: supplier?.address ?? '',
        city: supplier?.city ?? 'Medellín',
        payment_terms_days: String(supplier?.payment_terms_days ?? 30),
        bank_name: supplier?.bank_name ?? '',
        bank_account_type: supplier?.bank_account_type ?? '',
        bank_account_number: supplier?.bank_account_number ?? '',
        is_active: supplier?.is_active ?? true,
        notes: supplier?.notes ?? '',
    });

    const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

    const suggestedDV = form.nit ? computeNitDV(form.nit) : null;
    const dvMismatch =
        suggestedDV !== null && form.verification_digit !== '' && Number(form.verification_digit) !== suggestedDV;

    const handleNitChange = (value: string) => {
        const clean = value.replace(/[^\d]/g, '');
        const dv = clean ? computeNitDV(clean) : null;
        setForm((f) => ({ ...f, nit: clean, verification_digit: dv !== null ? String(dv) : '' }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.business_name.trim()) {
            toast.error('La razón social es obligatoria');
            return;
        }
        const terms = Number(form.payment_terms_days);
        if (!Number.isFinite(terms) || terms < 0) {
            toast.error('El plazo de pago debe ser 0 o más días');
            return;
        }

        const payload = {
            business_name: form.business_name.trim(),
            nit: form.nit.trim() || null,
            verification_digit: form.verification_digit === '' ? null : Number(form.verification_digit),
            category: form.category,
            contact_name: form.contact_name.trim() || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            address: form.address.trim() || null,
            city: form.city.trim() || 'Medellín',
            payment_terms_days: Math.round(terms),
            bank_name: form.bank_name.trim() || null,
            bank_account_type: (form.bank_account_type || null) as Supplier['bank_account_type'],
            bank_account_number: form.bank_account_number.trim() || null,
            is_active: form.is_active,
            notes: form.notes.trim() || null,
        };

        try {
            setSaving(true);
            if (supplier) {
                const { data, error } = await supabase
                    .from('suppliers')
                    .update({ ...payload, updated_at: new Date().toISOString() })
                    .eq('id', supplier.id)
                    .select('id');
                if (error) throw error;
                if (!data?.length) throw new Error('No tienes permiso para editar proveedores (se requiere rol admin).');
                toast.success('Proveedor actualizado');
            } else {
                const { error } = await supabase.from('suppliers').insert(payload);
                if (error) throw error;
                toast.success('Proveedor registrado');
            }
            onSaved();
        } catch (err: any) {
            toast.error('No se pudo guardar el proveedor: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 flex items-center justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                        {supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
                    </h3>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
                    {/* Identificación */}
                    <section className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-[#2E4040]">Identificación</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                            <div className="sm:col-span-6">
                                <label className={LABEL}>Razón social *</label>
                                <input
                                    required
                                    value={form.business_name}
                                    onChange={(e) => set('business_name', e.target.value)}
                                    className={INPUT}
                                    placeholder="Ej: Plásticos del Valle S.A.S."
                                />
                            </div>
                            <div className="sm:col-span-4">
                                <label className={LABEL}>NIT (sin DV)</label>
                                <input
                                    inputMode="numeric"
                                    value={form.nit}
                                    onChange={(e) => handleNitChange(e.target.value)}
                                    className={INPUT}
                                    placeholder="900123456"
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={LABEL}>DV</label>
                                <input
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={form.verification_digit}
                                    onChange={(e) => set('verification_digit', e.target.value.replace(/\D/g, '').slice(0, 1))}
                                    className={`${INPUT} ${dvMismatch ? 'border-amber-500 bg-amber-50' : ''}`}
                                />
                            </div>
                        </div>
                        {dvMismatch && (
                            <p className="text-[11px] font-semibold text-amber-700">
                                El DV calculado para este NIT es {suggestedDV}. Verifica el RUT del proveedor.
                            </p>
                        )}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                                <label className={LABEL}>Categoría *</label>
                                <select
                                    value={form.category}
                                    onChange={(e) => set('category', e.target.value as SupplierCategory)}
                                    className={`${INPUT} bg-white`}
                                >
                                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={LABEL}>Plazo de pago (días) *</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    required
                                    value={form.payment_terms_days}
                                    onChange={(e) => set('payment_terms_days', e.target.value)}
                                    className={INPUT}
                                />
                                <p className="mt-0.5 text-[10px] text-[#949E97]">
                                    0 = contado. Se usa para calcular el vencimiento de cada factura.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Contacto */}
                    <section className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-[#2E4040]">Contacto</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                                <label className={LABEL}>Nombre de contacto</label>
                                <input value={form.contact_name} onChange={(e) => set('contact_name', e.target.value)} className={INPUT} />
                            </div>
                            <div>
                                <label className={LABEL}>Teléfono</label>
                                <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={INPUT} />
                            </div>
                            <div>
                                <label className={LABEL}>Email (facturación)</label>
                                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={INPUT} />
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div className="sm:col-span-2">
                                <label className={LABEL}>Dirección</label>
                                <input value={form.address} onChange={(e) => set('address', e.target.value)} className={INPUT} />
                            </div>
                            <div>
                                <label className={LABEL}>Ciudad</label>
                                <input value={form.city} onChange={(e) => set('city', e.target.value)} className={INPUT} />
                            </div>
                        </div>
                    </section>

                    {/* Bancario */}
                    <section className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-[#2E4040]">Datos bancarios (para pagos)</h4>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                                <label className={LABEL}>Banco</label>
                                <input
                                    value={form.bank_name}
                                    onChange={(e) => set('bank_name', e.target.value)}
                                    className={INPUT}
                                    placeholder="Bancolombia"
                                />
                            </div>
                            <div>
                                <label className={LABEL}>Tipo de cuenta</label>
                                <select
                                    value={form.bank_account_type}
                                    onChange={(e) => set('bank_account_type', e.target.value as typeof form.bank_account_type)}
                                    className={`${INPUT} bg-white`}
                                >
                                    <option value="">—</option>
                                    <option value="ahorros">Ahorros</option>
                                    <option value="corriente">Corriente</option>
                                </select>
                            </div>
                            <div>
                                <label className={LABEL}>Número de cuenta</label>
                                <input
                                    value={form.bank_account_number}
                                    onChange={(e) => set('bank_account_number', e.target.value)}
                                    className={INPUT}
                                />
                            </div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div>
                            <label className={LABEL}>Notas</label>
                            <textarea
                                rows={2}
                                value={form.notes}
                                onChange={(e) => set('notes', e.target.value)}
                                className={INPUT}
                                placeholder="Condiciones especiales, descuentos por pronto pago, horario de recepción..."
                            />
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-[#2E4040]">
                            <input
                                type="checkbox"
                                checked={form.is_active}
                                onChange={(e) => set('is_active', e.target.checked)}
                                className="accent-[#3F8346]"
                            />
                            Proveedor activo (aparece al registrar facturas)
                        </label>
                    </section>

                    <div className="flex justify-end gap-3 border-t border-[#C8CDC9] pt-4">
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
                            className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                        >
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {supplier ? 'Guardar cambios' : 'Registrar proveedor'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
