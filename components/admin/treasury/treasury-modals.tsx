'use client';

import { useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { ExpenseCategory, TreasuryAccount, TreasuryAccountType } from '@/lib/types';
import { INPUT, LABEL, dbErrorMessage, formatCOP, todayISO } from '@/components/admin/suppliers/utils';
import { ACCOUNT_TYPE_LABELS, DEFAULT_PUC, uploadSupport } from './utils';

function Shell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="flex items-start justify-between border-b border-[#C8CDC9] px-6 py-4">
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

function Actions({ saving, onCancel, label }: { saving: boolean; onCancel: () => void; label: string }) {
    return (
        <div className="flex justify-end gap-2 border-t border-[#C8CDC9] pt-3">
            <button
                type="button"
                onClick={onCancel}
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
                {label}
            </button>
        </div>
    );
}

// ======================= Cuenta =======================
export function AccountModal({ account, onClose, onSaved }: { account: TreasuryAccount | null; onClose: () => void; onSaved: () => void }) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const [f, setF] = useState({
        name: account?.name || '',
        account_type: (account?.account_type || 'banco') as TreasuryAccountType,
        puc_code: account?.puc_code || DEFAULT_PUC.banco,
        bank_name: account?.bank_name || '',
        account_number: account?.account_number || '',
        bank_account_type: account?.bank_account_type || 'ahorros',
        opening_balance: account ? String(Number(account.opening_balance)) : '0',
        opening_date: account?.opening_date || todayISO(),
        petty_cash_fund: account?.petty_cash_fund != null ? String(Number(account.petty_cash_fund)) : '',
        color: account?.color || '#2563EB',
        notes: account?.notes || '',
        is_active: account?.is_active ?? true,
    });
    const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!f.name.trim()) return toast.error('Ponle un nombre a la cuenta');
        const payload = {
            name: f.name.trim(),
            account_type: f.account_type,
            puc_code: f.puc_code.trim() || null,
            bank_name: f.account_type === 'banco' ? f.bank_name.trim() || null : null,
            account_number: f.account_type === 'banco' ? f.account_number.trim() || null : null,
            bank_account_type: f.account_type === 'banco' ? f.bank_account_type : null,
            opening_balance: Number(f.opening_balance) || 0,
            opening_date: f.opening_date,
            petty_cash_fund: f.account_type === 'caja_menor' ? Number(f.petty_cash_fund) || 0 : null,
            color: f.color,
            notes: f.notes.trim() || null,
            is_active: f.is_active,
            updated_at: new Date().toISOString(),
        };
        try {
            setSaving(true);
            const { data, error } = account
                ? await supabase.from('treasury_accounts').update(payload).eq('id', account.id).select('id')
                : await supabase.from('treasury_accounts').insert(payload).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Solo un administrador puede gestionar cuentas');
            toast.success(account ? 'Cuenta actualizada' : 'Cuenta creada');
            onSaved();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo guardar: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Shell title={account ? 'Editar cuenta' : 'Nueva cuenta de tesorería'} onClose={onClose}>
            <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Tipo *</label>
                        <select
                            value={f.account_type}
                            disabled={!!account}
                            onChange={(e) => {
                                const t = e.target.value as TreasuryAccountType;
                                set({ account_type: t, puc_code: DEFAULT_PUC[t] });
                            }}
                            className={`${INPUT} bg-white`}
                        >
                            {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Nombre *</label>
                        <input
                            value={f.name}
                            onChange={(e) => set({ name: e.target.value })}
                            placeholder={f.account_type === 'banco' ? 'Ej: Bancolombia ahorros' : 'Ej: Caja oficina'}
                            className={INPUT}
                        />
                    </div>
                </div>
                {f.account_type === 'banco' && (
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className={LABEL}>Banco</label>
                            <input value={f.bank_name} onChange={(e) => set({ bank_name: e.target.value })} className={INPUT} />
                        </div>
                        <div>
                            <label className={LABEL}>N.º de cuenta</label>
                            <input value={f.account_number} onChange={(e) => set({ account_number: e.target.value })} className={INPUT} />
                        </div>
                        <div>
                            <label className={LABEL}>Tipo</label>
                            <select
                                value={f.bank_account_type}
                                onChange={(e) => set({ bank_account_type: e.target.value as 'ahorros' | 'corriente' })}
                                className={`${INPUT} bg-white`}
                            >
                                <option value="ahorros">Ahorros</option>
                                <option value="corriente">Corriente</option>
                            </select>
                        </div>
                    </div>
                )}
                {f.account_type === 'caja_menor' && (
                    <div>
                        <label className={LABEL}>Monto del fondo fijo ($)</label>
                        <input
                            type="number"
                            min="0"
                            value={f.petty_cash_fund}
                            onChange={(e) => set({ petty_cash_fund: e.target.value })}
                            placeholder="Ej: 500000"
                            className={INPUT}
                        />
                        <p className="mt-1 text-[10px] text-[#949E97]">
                            Con los gastos el saldo baja; el reembolso (transferencia desde banco o caja) lo devuelve al fondo.
                        </p>
                    </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className={LABEL}>Saldo inicial ($)</label>
                        <input
                            type="number"
                            value={f.opening_balance}
                            onChange={(e) => set({ opening_balance: e.target.value })}
                            className={INPUT}
                        />
                    </div>
                    <div>
                        <label className={LABEL}>Fecha saldo inicial</label>
                        <input type="date" value={f.opening_date} onChange={(e) => set({ opening_date: e.target.value })} className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>Cuenta PUC</label>
                        <input value={f.puc_code} onChange={(e) => set({ puc_code: e.target.value })} className={INPUT} />
                    </div>
                </div>
                <p className="text-[10px] text-[#949E97]">
                    El saldo inicial es el dinero que había al empezar a usar el sistema; desde ahí el saldo se calcula solo con
                    cada cobro, pago, gasto y transferencia.
                </p>
                <div className="grid grid-cols-[auto_1fr] items-end gap-3">
                    <div>
                        <label className={LABEL}>Color</label>
                        <input type="color" value={f.color} onChange={(e) => set({ color: e.target.value })} className="h-8 w-12 rounded border border-[#C8CDC9]" />
                    </div>
                    <div>
                        <label className={LABEL}>Notas</label>
                        <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} className={INPUT} />
                    </div>
                </div>
                {account && (
                    <label className="flex items-center gap-2 text-xs text-[#2E4040]">
                        <input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} className="accent-[#3F8346]" />
                        Cuenta activa
                    </label>
                )}
                <Actions saving={saving} onCancel={onClose} label={account ? 'Guardar' : 'Crear cuenta'} />
            </form>
        </Shell>
    );
}

// ======================= Movimiento manual =======================
export function MovementModal({
    accounts,
    defaultAccountId,
    onClose,
    onSaved,
}: {
    accounts: TreasuryAccount[];
    defaultAccountId?: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const [kind, setKind] = useState<'otro_ingreso' | 'otro_egreso' | 'transferencia'>('otro_ingreso');
    const [accountId, setAccountId] = useState(defaultAccountId || accounts[0]?.id || '');
    const [toAccountId, setToAccountId] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(todayISO());
    const [description, setDescription] = useState('');
    const [thirdParty, setThirdParty] = useState('');
    const [reference, setReference] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!accountId) return toast.error('Elige la cuenta');
        if (!(Number(amount) > 0)) return toast.error('Ingresa el valor');
        try {
            setSaving(true);
            if (kind === 'transferencia') {
                if (!toAccountId) throw new Error('Elige la cuenta destino');
                const { error } = await supabase.rpc('transfer_between_accounts', {
                    p_from: accountId,
                    p_to: toAccountId,
                    p_amount: Number(amount),
                    p_date: date,
                    ...(description.trim() ? { p_description: description.trim() } : {}),
                    ...(reference.trim() ? { p_reference: reference.trim() } : {}),
                });
                if (error) throw error;
                toast.success('Transferencia registrada');
            } else {
                if (!description.trim()) throw new Error('Describe el movimiento');
                const { data: id, error } = await supabase.rpc('register_treasury_movement', {
                    p_account_id: accountId,
                    p_direction: kind === 'otro_ingreso' ? 'ingreso' : 'egreso',
                    p_type: kind,
                    p_amount: Number(amount),
                    p_date: date,
                    p_description: description.trim(),
                    ...(thirdParty.trim() ? { p_third_party: thirdParty.trim() } : {}),
                    ...(reference.trim() ? { p_reference: reference.trim() } : {}),
                });
                if (error) throw error;
                if (file && id) {
                    const path = await uploadSupport(supabase, file, 'movimientos');
                    await supabase.from('treasury_movements').update({ support_path: path }).eq('id', id as string);
                }
                toast.success('Movimiento registrado');
            }
            onSaved();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo registrar: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const kinds = [
        { v: 'otro_ingreso', l: 'Otro ingreso' },
        { v: 'otro_egreso', l: 'Otro egreso' },
        { v: 'transferencia', l: 'Transferencia entre cuentas' },
    ] as const;

    return (
        <Shell
            title="Nuevo movimiento"
            subtitle="Cobros, pagos a proveedores y gastos se registran en su módulo y llegan aquí solos."
            onClose={onClose}
        >
            <form onSubmit={submit} className="space-y-3">
                <div className="flex flex-wrap gap-2">
                    {kinds.map((k) => (
                        <button
                            key={k.v}
                            type="button"
                            onClick={() => setKind(k.v)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                                kind === k.v ? 'bg-[#2E4040] text-white' : 'border border-[#C8CDC9] bg-white text-[#2E4040]'
                            }`}
                        >
                            {k.l}
                        </button>
                    ))}
                </div>
                <div className={`grid gap-3 ${kind === 'transferencia' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <div>
                        <label className={LABEL}>{kind === 'transferencia' ? 'Sale de *' : 'Cuenta *'}</label>
                        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={`${INPUT} bg-white`}>
                            {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name} · {formatCOP(Number(a.current_balance))}
                                </option>
                            ))}
                        </select>
                    </div>
                    {kind === 'transferencia' && (
                        <div>
                            <label className={LABEL}>Entra a *</label>
                            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={`${INPUT} bg-white`}>
                                <option value="">Elegir...</option>
                                {accounts
                                    .filter((a) => a.id !== accountId)
                                    .map((a) => (
                                        <option key={a.id} value={a.id}>
                                            {a.name}
                                        </option>
                                    ))}
                            </select>
                        </div>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Valor ($) *</label>
                        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${INPUT} font-bold`} />
                    </div>
                    <div>
                        <label className={LABEL}>Fecha *</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                    </div>
                </div>
                <div>
                    <label className={LABEL}>Descripción {kind !== 'transferencia' && '*'}</label>
                    <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={
                            kind === 'transferencia'
                                ? 'Ej: Consignación del efectivo del día / Reembolso caja menor'
                                : kind === 'otro_ingreso'
                                  ? 'Ej: Rendimientos financieros, venta de chatarra'
                                  : 'Ej: Retiro para gastos de viaje'
                        }
                        className={INPUT}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    {kind !== 'transferencia' && (
                        <div>
                            <label className={LABEL}>Tercero</label>
                            <input value={thirdParty} onChange={(e) => setThirdParty(e.target.value)} className={INPUT} />
                        </div>
                    )}
                    <div>
                        <label className={LABEL}>Referencia</label>
                        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N.º transacción" className={INPUT} />
                    </div>
                </div>
                {kind !== 'transferencia' && (
                    <div>
                        <label className={LABEL}>Soporte (foto o PDF)</label>
                        <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-[#949E97] px-3 py-2 text-xs text-[#2E4040] hover:bg-[#C8CDC9]/20">
                            <Paperclip className="h-4 w-4 text-[#3F8346]" />
                            {file ? file.name : 'Elegir archivo...'}
                            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        </label>
                    </div>
                )}
                <Actions saving={saving} onCancel={onClose} label="Registrar" />
            </form>
        </Shell>
    );
}

// ======================= Gasto de caja menor =======================
export function PettyExpenseModal({
    account,
    categories,
    onClose,
    onSaved,
}: {
    account: TreasuryAccount;
    categories: ExpenseCategory[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [saving, setSaving] = useState(false);
    const [categoryId, setCategoryId] = useState(categories.find((c) => c.name.startsWith('Insumos'))?.id || categories[0]?.id || '');
    const [description, setDescription] = useState('');
    const [payee, setPayee] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(todayISO());
    const [reference, setReference] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const balance = Number(account.current_balance);
    const value = Number(amount) || 0;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!description.trim()) return toast.error('Describe el gasto');
        if (!(value > 0)) return toast.error('Ingresa el valor');
        if (value > balance) return toast.error(`La caja menor solo tiene ${formatCOP(balance)}. Registra un reembolso primero.`);
        try {
            setSaving(true);
            const { data, error } = await supabase
                .from('expenses')
                .insert({
                    category_id: categoryId,
                    description: description.trim(),
                    payee_name: payee.trim() || null,
                    period_month: date.slice(0, 7) + '-01',
                    due_date: date,
                    amount: value,
                    status: 'pagado',
                    paid_date: date,
                    payment_method: 'efectivo',
                    reference: reference.trim() || null,
                    account_id: account.id,
                    notes: 'Gasto de caja menor',
                })
                .select('id')
                .single();
            if (error) throw error;
            if (file) {
                const path = await uploadSupport(supabase, file, 'caja-menor');
                await supabase.from('treasury_movements').update({ support_path: path }).eq('expense_id', data.id);
            }
            toast.success(`Gasto de caja menor registrado: ${formatCOP(value)}`);
            onSaved();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo registrar: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Shell
            title="Gasto de caja menor"
            subtitle={`${account.name} · disponible ${formatCOP(balance)}. Queda como gasto pagado en su categoría.`}
            onClose={onClose}
        >
            <form onSubmit={submit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Categoría *</label>
                        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${INPUT} bg-white`}>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>Fecha *</label>
                        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
                    </div>
                </div>
                <div>
                    <label className={LABEL}>Descripción *</label>
                    <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ej: Domicilio, cinta de enmascarar, almuerzo de turno"
                        className={INPUT}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>Valor ($) *</label>
                        <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${INPUT} font-bold`} />
                        {value > balance && <p className="mt-0.5 text-[10px] font-semibold text-red-600">Supera el saldo de la caja</p>}
                    </div>
                    <div>
                        <label className={LABEL}>Pagado a</label>
                        <input value={payee} onChange={(e) => setPayee(e.target.value)} className={INPUT} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={LABEL}>N.º recibo / factura</label>
                        <input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} />
                    </div>
                    <div>
                        <label className={LABEL}>Soporte (foto del recibo)</label>
                        <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-[#949E97] px-3 py-1.5 text-xs text-[#2E4040] hover:bg-[#C8CDC9]/20">
                            <Paperclip className="h-4 w-4 text-[#3F8346]" />
                            <span className="truncate">{file ? file.name : 'Elegir...'}</span>
                            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                        </label>
                    </div>
                </div>
                <Actions saving={saving} onCancel={onClose} label="Registrar gasto" />
            </form>
        </Shell>
    );
}
