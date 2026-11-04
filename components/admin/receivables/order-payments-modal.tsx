'use client';

import { useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { Order, PaymentMethod, TreasuryAccount } from '@/lib/types';
import AccountSelect, { suggestAccount } from '@/components/admin/treasury/account-select';
import {
    INPUT,
    LABEL,
    METHOD_LABELS,
    daysUntil,
    dbErrorMessage,
    formatCOP,
    formatDate,
    todayISO,
} from '@/components/admin/suppliers/utils';

/** ReteFuente por compras (bienes) más común */
const RETEFUENTE_RATE = 0.025;

type Props = {
    order: Order;
    isAdmin: boolean;
    onClose: () => void;
    onChanged: () => void;
};

export default function OrderPaymentsModal({ order, isAdmin, onClose, onChanged }: Props) {
    const supabase = createClient();
    const [confirmDialog, confirm] = useConfirm();
    const [saving, setSaving] = useState(false);

    const payments = [...(order.payments || [])].sort((a, b) => b.payment_date.localeCompare(a.payment_date));
    const total = Number(order.total_amount);
    const paid = Number(order.paid_amount || 0);
    const balance = Math.max(total - paid, 0);

    const [amount, setAmount] = useState(String(balance));
    const [withholding, setWithholding] = useState('0');
    const [paymentDate, setPaymentDate] = useState(todayISO());
    const [method, setMethod] = useState<PaymentMethod>('transferencia');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [accountId, setAccountId] = useState('');
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);

    const applied = (Number(amount) || 0) + (Number(withholding) || 0);
    const after = balance - applied;
    const days = order.due_date ? daysUntil(order.due_date) : null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!(applied > 0)) return toast.error('Ingresa el valor recibido');
        if (Number(amount) < 0 || Number(withholding) < 0) return toast.error('Los valores no pueden ser negativos');
        if (applied > balance + 0.5) return toast.error(`El pago supera el saldo (${formatCOP(balance)})`);
        try {
            setSaving(true);
            const { error } = await supabase.from('customer_payments').insert({
                order_id: order.id,
                payment_date: paymentDate,
                amount: Number(amount) || 0,
                withholding_amount: Number(withholding) || 0,
                method,
                reference: reference.trim() || null,
                notes: notes.trim() || null,
                account_id: accountId || null,
            });
            if (error) throw error;
            toast.success(
                after <= 0.5
                    ? `Pedido #${order.order_number} pagado por completo`
                    : `Abono registrado · saldo ${formatCOP(after)}`
            );
            onChanged();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo registrar el pago: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, value: number) => {
        const ok = await confirm({
            title: '¿Eliminar este pago?',
            description: `Se quitará ${formatCOP(value)} de lo abonado y el saldo del pedido volverá a aumentar.`,
            confirmLabel: 'Eliminar pago',
        });
        if (!ok) return;
        try {
            setSaving(true);
            const { data, error } = await supabase.from('customer_payments').delete().eq('id', id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Solo un administrador puede eliminar pagos');
            toast.success('Pago eliminado');
            onChanged();
            onClose();
        } catch (err: any) {
            toast.error('No se pudo eliminar: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            {confirmDialog}
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                            Pedido #{order.order_number} · {order.client?.business_name || 'Cliente'}
                        </h3>
                        <p className="text-[11px] text-[#949E97]">
                            {order.payment_terms_days > 0 ? `Crédito ${order.payment_terms_days} días` : 'Contado'} · vence{' '}
                            {formatDate(order.due_date)}
                            {days !== null && balance > 0 && (
                                <span className={days < 0 ? 'ml-1 font-semibold text-red-600' : 'ml-1'}>
                                    ({days < 0 ? `vencido hace ${-days} días` : days === 0 ? 'vence hoy' : `en ${days} días`})
                                </span>
                            )}
                            {order.status !== 'enviado' && order.status !== 'entregado' && (
                                <span className="ml-1">· aún sin despachar (vencimiento estimado)</span>
                            )}
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-5 px-6 py-5">
                    {/* Resumen */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                            ['Subtotal', formatCOP(Number(order.subtotal || 0))],
                            [order.apply_vat ? 'IVA 19%' : 'IVA (no aplica)', formatCOP(Number(order.tax_amount || 0))],
                            ['Abonado', formatCOP(paid)],
                            ['Saldo', formatCOP(balance)],
                        ].map(([k, v], i) => (
                            <div
                                key={k}
                                className={`rounded-lg border p-2.5 ${
                                    i === 3 ? 'border-[#2E4040] bg-[#2E4040] text-white' : 'border-[#C8CDC9] bg-white'
                                }`}
                            >
                                <div className={`text-[10px] ${i === 3 ? 'text-white/70' : 'text-[#949E97]'}`}>{k}</div>
                                <div className="text-sm font-bold">{v}</div>
                            </div>
                        ))}
                    </div>

                    {/* Historial */}
                    <div>
                        <div className="mb-1.5 text-xs font-bold text-[#2E4040]">Pagos registrados ({payments.length})</div>
                        {payments.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-[#C8CDC9] p-3 text-center text-[11px] text-[#949E97]">
                                Aún no hay pagos para este pedido.
                            </p>
                        ) : (
                            <table className="w-full overflow-hidden rounded-lg border border-[#C8CDC9] text-left text-xs">
                                <thead className="bg-[#F8F9FA] text-[#2E4040]">
                                    <tr>
                                        <th className="px-3 py-2">Fecha</th>
                                        <th className="px-3 py-2">Medio</th>
                                        <th className="px-3 py-2">Referencia</th>
                                        <th className="px-3 py-2 text-right">Recibido</th>
                                        <th className="px-3 py-2 text-right">Retención</th>
                                        {isAdmin && <th className="w-8" />}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/50">
                                    {payments.map((p) => (
                                        <tr key={p.id}>
                                            <td className="px-3 py-2">{formatDate(p.payment_date)}</td>
                                            <td className="px-3 py-2">{METHOD_LABELS[p.method]}</td>
                                            <td className="px-3 py-2 text-[#949E97]">{p.reference || p.notes || '—'}</td>
                                            <td className="px-3 py-2 text-right font-semibold">{formatCOP(Number(p.amount))}</td>
                                            <td className="px-3 py-2 text-right text-[#949E97]">
                                                {Number(p.withholding_amount) > 0 ? formatCOP(Number(p.withholding_amount)) : '—'}
                                            </td>
                                            {isAdmin && (
                                                <td className="px-1 text-right">
                                                    <button
                                                        onClick={() =>
                                                            handleDelete(p.id, Number(p.amount) + Number(p.withholding_amount))
                                                        }
                                                        disabled={saving}
                                                        className="rounded p-1 text-red-500 hover:bg-red-50"
                                                        title="Eliminar pago"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Nuevo pago */}
                    {balance > 0 && order.status !== 'cancelado' ? (
                        <form onSubmit={handleSave} className="space-y-3 rounded-lg border border-[#C8CDC9] bg-slate-50/60 p-3.5">
                            <div className="text-xs font-bold text-[#2E4040]">Registrar pago / abono</div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div>
                                    <label className={LABEL}>Fecha *</label>
                                    <input
                                        type="date"
                                        required
                                        value={paymentDate}
                                        onChange={(e) => setPaymentDate(e.target.value)}
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>Valor recibido ($) *</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className={`${INPUT} font-bold`}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>Retención ($)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={withholding}
                                        onChange={(e) => setWithholding(e.target.value)}
                                        className={INPUT}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const ret = Math.round(Number(order.subtotal || 0) * RETEFUENTE_RATE);
                                            setWithholding(String(ret));
                                            setAmount(String(Math.max(balance - ret, 0)));
                                        }}
                                        className="mt-0.5 text-[10px] font-semibold text-[#3F8346] hover:underline"
                                    >
                                        ReteFuente 2,5%
                                    </button>
                                </div>
                                <div>
                                    <label className={LABEL}>Medio de pago</label>
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
                            </div>
                            <div>
                                <label className={LABEL}>Entra a (caja / banco)</label>
                                <AccountSelect
                                    value={accountId}
                                    onChange={setAccountId}
                                    className={`${INPUT} bg-white`}
                                    excludeTypes={['caja_menor']}
                                    onLoaded={(list) => {
                                        setAccounts(list);
                                        setAccountId((cur) => cur || suggestAccount(list, method));
                                    }}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={LABEL}>Referencia / comprobante</label>
                                    <input
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder="Ej: Transferencia 0045, recibo 120"
                                        className={INPUT}
                                    />
                                </div>
                                <div>
                                    <label className={LABEL}>Notas</label>
                                    <input value={notes} onChange={(e) => setNotes(e.target.value)} className={INPUT} />
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className={`text-[11px] ${after < -0.5 ? 'font-semibold text-red-600' : 'text-[#949E97]'}`}>
                                    {after < -0.5
                                        ? `Supera el saldo en ${formatCOP(-after)}`
                                        : after <= 0.5
                                          ? 'Con este pago el pedido queda saldado'
                                          : `Saldo después del pago: ${formatCOP(after)}`}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAmount(String(balance));
                                            setWithholding('0');
                                        }}
                                        className="rounded border border-[#C8CDC9] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                    >
                                        Pagar saldo total
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving || after < -0.5}
                                        className="flex items-center gap-1.5 rounded bg-[#3F8346] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                                    >
                                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                        Registrar pago
                                    </button>
                                </div>
                            </div>
                        </form>
                    ) : (
                        <p className="rounded-lg bg-emerald-50 p-3 text-center text-xs font-semibold text-emerald-800">
                            {order.status === 'cancelado' ? 'Pedido cancelado: no admite pagos.' : 'Pedido pagado por completo.'}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
