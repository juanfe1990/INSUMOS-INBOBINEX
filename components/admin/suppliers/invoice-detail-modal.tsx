'use client';

import { useState } from 'react';
import { Ban, Loader2, Trash2, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import AccountSelect, { suggestAccount } from '@/components/admin/treasury/account-select';
import type { TreasuryAccount } from '@/lib/types';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { PaymentMethod, PurchaseInvoice } from '@/lib/types';
import {
    INPUT,
    ITEM_TYPE_LABELS,
    LABEL,
    METHOD_LABELS,
    STATUS_CONFIG,
    balanceOf,
    daysUntil,
    dbErrorMessage,
    formatCOP,
    formatDate,
    formatNumber,
    isOpen,
    todayISO,
} from './utils';

type Props = {
    invoice: PurchaseInvoice;
    onClose: () => void;
    onChanged: () => void;
};

export default function InvoiceDetailModal({ invoice, onClose, onChanged }: Props) {
    const supabase = createClient();
    const [confirmDialog, confirm] = useConfirm();
    const balance = balanceOf(invoice);
    const open = isOpen(invoice);
    const due = daysUntil(invoice.due_date);

    const [amount, setAmount] = useState(String(Math.round(balance)));
    const [payDate, setPayDate] = useState(todayISO());
    const [method, setMethod] = useState<PaymentMethod>('transferencia');
    const [reference, setReference] = useState('');
    const [accountId, setAccountId] = useState('');
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
    const [savingPay, setSavingPay] = useState(false);

    const [showAnnul, setShowAnnul] = useState(false);
    const [annulReason, setAnnulReason] = useState('');
    const [annulling, setAnnulling] = useState(false);

    const payments = [...(invoice.payments || [])].sort((a, b) => a.payment_date.localeCompare(b.payment_date));
    const items = invoice.items || [];
    const status = STATUS_CONFIG[invoice.status];

    const handlePay = async (e: React.FormEvent) => {
        e.preventDefault();
        const value = Number(amount);
        if (!(value > 0)) return toast.error('El valor del pago debe ser mayor a 0');
        if (value > balance + 0.5) return toast.error(`El pago supera el saldo pendiente (${formatCOP(balance)})`);
        try {
            setSavingPay(true);
            const { error } = await supabase.from('supplier_payments').insert({
                invoice_id: invoice.id,
                amount: Math.min(value, balance),
                payment_date: payDate,
                method,
                reference: reference.trim() || null,
                account_id: accountId || null,
            });
            if (error) throw error;
            toast.success(
                value >= balance ? `Factura ${invoice.invoice_number} pagada en su totalidad` : `Abono de ${formatCOP(value)} registrado`
            );
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo registrar el pago: ' + dbErrorMessage(err));
        } finally {
            setSavingPay(false);
        }
    };

    const handleDeletePayment = async (paymentId: string, value: number) => {
        const ok = await confirm({
            title: `¿Eliminar el pago de ${formatCOP(value)}?`,
            description: 'El saldo y el estado de la factura se recalculan automáticamente.',
            confirmLabel: 'Eliminar pago',
        });
        if (!ok) return;
        const { data, error } = await supabase.from('supplier_payments').delete().eq('id', paymentId).select('id');
        if (error || !data?.length) {
            toast.error('No se pudo eliminar el pago: ' + (error ? dbErrorMessage(error) : 'sin permiso'));
            return;
        }
        toast.success('Pago eliminado');
        onChanged();
    };

    const handleAnnul = async () => {
        if (!annulReason.trim()) return toast.error('Indica el motivo de la anulación');
        const ok = await confirm({
            title: `¿Anular la factura ${invoice.invoice_number}?`,
            description:
                'Se restará del inventario lo que esta factura ingresó y quedará registrado en el Kardex como "Anulación compra". El costo promedio por kg no se recalcula hacia atrás.',
            confirmLabel: 'Anular factura',
        });
        if (!ok) return;
        try {
            setAnnulling(true);
            const { error } = await supabase.rpc('annul_purchase_invoice', {
                p_invoice_id: invoice.id,
                p_reason: annulReason.trim(),
            });
            if (error) throw error;
            toast.success(`Factura ${invoice.invoice_number} anulada y stock revertido`);
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo anular: ' + dbErrorMessage(err));
        } finally {
            setAnnulling(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            {confirmDialog}
            <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                Factura {invoice.invoice_number}
                            </h3>
                            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${status.cls}`}>
                                {status.label}
                            </span>
                        </div>
                        <p className="text-xs text-[#949E97]">
                            {invoice.supplier?.business_name}
                            {invoice.supplier?.nit ? ` · NIT ${invoice.supplier.nit}` : ''}
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
                            ['Emisión', formatDate(invoice.issue_date)],
                            [
                                'Vencimiento',
                                formatDate(invoice.due_date) +
                                    (open ? (due < 0 ? ` (vencida ${-due} d)` : due === 0 ? ' (hoy)' : ` (en ${due} d)`) : ''),
                            ],
                            ['Total', formatCOP(invoice.total)],
                            ['Saldo', formatCOP(balance)],
                        ].map(([k, v]) => (
                            <div key={k} className="rounded-lg border border-[#C8CDC9]/70 bg-white p-2.5">
                                <div className="text-[10px] font-semibold text-[#949E97]">{k}</div>
                                <div
                                    className={`text-sm font-bold ${
                                        k === 'Vencimiento' && open && due < 0 ? 'text-red-600' : 'text-[#2E4040]'
                                    }`}
                                >
                                    {v}
                                </div>
                            </div>
                        ))}
                    </div>
                    {invoice.cufe && (
                        <p className="break-all font-mono text-[10px] text-[#949E97]">CUFE: {invoice.cufe}</p>
                    )}
                    {invoice.status === 'anulada' && invoice.annulled_reason && (
                        <p className="rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700">
                            <b>Motivo de anulación:</b> {invoice.annulled_reason}
                        </p>
                    )}

                    {/* Items */}
                    <div className="overflow-hidden rounded-lg border border-[#C8CDC9]">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[#F8F9FA] text-[#2E4040]">
                                <tr>
                                    <th className="px-3 py-2 font-semibold">Ítem</th>
                                    <th className="px-3 py-2 font-semibold">Tipo</th>
                                    <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                                    <th className="px-3 py-2 text-right font-semibold">Costo unit.</th>
                                    <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#C8CDC9]/50">
                                {items.map((it) => (
                                    <tr key={it.id}>
                                        <td className="px-3 py-2 font-medium text-[#2E4040]">{it.description}</td>
                                        <td className="px-3 py-2 text-[#949E97]">{ITEM_TYPE_LABELS[it.item_type]}</td>
                                        <td className="px-3 py-2 text-right">
                                            {formatNumber(it.quantity)} {it.unit}
                                        </td>
                                        <td className="px-3 py-2 text-right">{formatCOP(it.unit_cost)}</td>
                                        <td className="px-3 py-2 text-right font-semibold">{formatCOP(it.subtotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-[#F8F9FA] text-[#2E4040]">
                                <tr>
                                    <td colSpan={4} className="px-3 py-1.5 text-right text-[#949E97]">Subtotal</td>
                                    <td className="px-3 py-1.5 text-right font-semibold">{formatCOP(invoice.subtotal)}</td>
                                </tr>
                                <tr>
                                    <td colSpan={4} className="px-3 py-1.5 text-right text-[#949E97]">IVA</td>
                                    <td className="px-3 py-1.5 text-right">{formatCOP(invoice.tax_amount)}</td>
                                </tr>
                                {Number(invoice.withholding_amount) > 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-1.5 text-right text-[#949E97]">Retención</td>
                                        <td className="px-3 py-1.5 text-right">−{formatCOP(invoice.withholding_amount)}</td>
                                    </tr>
                                )}
                                <tr className="border-t border-[#C8CDC9]">
                                    <td colSpan={4} className="px-3 py-2 text-right font-bold">Total</td>
                                    <td className="px-3 py-2 text-right font-bold text-[#3F8346]">{formatCOP(invoice.total)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* Pagos */}
                    <div>
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#2E4040]">Pagos y abonos</h4>
                        {payments.length === 0 ? (
                            <p className="text-xs text-[#949E97]">Sin pagos registrados.</p>
                        ) : (
                            <div className="divide-y divide-[#C8CDC9]/50 rounded-lg border border-[#C8CDC9]">
                                {payments.map((p) => (
                                    <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs">
                                        <div>
                                            <span className="font-semibold text-[#2E4040]">{formatCOP(p.amount)}</span>
                                            <span className="ml-2 text-[#949E97]">
                                                {formatDate(p.payment_date)} · {METHOD_LABELS[p.method]}
                                                {p.reference ? ` · Ref. ${p.reference}` : ''}
                                            </span>
                                        </div>
                                        {invoice.status !== 'anulada' && (
                                            <button
                                                onClick={() => handleDeletePayment(p.id, p.amount)}
                                                className="rounded p-1 text-red-500 hover:bg-red-50"
                                                title="Eliminar pago"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {open && balance > 0 && (
                            <form
                                onSubmit={handlePay}
                                className="mt-3 grid grid-cols-12 items-end gap-2 rounded-lg border border-[#3F8346]/30 bg-[#3F8346]/5 p-3"
                            >
                                <div className="col-span-6 sm:col-span-3">
                                    <label className={LABEL}>Valor ($)</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max={Math.ceil(balance)}
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className={INPUT}
                                    />
                                </div>
                                <div className="col-span-6 sm:col-span-3">
                                    <label className={LABEL}>Fecha</label>
                                    <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={INPUT} />
                                </div>
                                <div className="col-span-6 sm:col-span-2">
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
                                <div className="col-span-6 sm:col-span-2">
                                    <label className={LABEL}>Referencia</label>
                                    <input
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        className={INPUT}
                                        placeholder="Comprobante"
                                    />
                                </div>
                                <div className="col-span-12 sm:col-span-2">
                                    <button
                                        type="submit"
                                        disabled={savingPay}
                                        className="flex w-full items-center justify-center gap-1.5 rounded bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                                    >
                                        {savingPay ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                                        Pagar
                                    </button>
                                </div>
                                <div className="col-span-12">
                                    <label className={LABEL}>Sale de (caja / banco)</label>
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
                                {invoice.supplier?.bank_account_number && (
                                    <p className="col-span-12 text-[10px] text-[#949E97]">
                                        Cuenta del proveedor: {invoice.supplier.bank_name || 'Banco'}{' '}
                                        {invoice.supplier.bank_account_type || ''} N.º {invoice.supplier.bank_account_number}
                                    </p>
                                )}
                            </form>
                        )}
                    </div>

                    {/* Anular */}
                    {invoice.status !== 'anulada' && (
                        <div className="border-t border-[#C8CDC9] pt-4">
                            {!showAnnul ? (
                                <button
                                    onClick={() => setShowAnnul(true)}
                                    disabled={Number(invoice.paid_amount) > 0}
                                    className="flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
                                    title={Number(invoice.paid_amount) > 0 ? 'Elimina los pagos antes de anular' : ''}
                                >
                                    <Ban className="h-3.5 w-3.5" />
                                    Anular factura
                                    {Number(invoice.paid_amount) > 0 && ' (tiene pagos registrados)'}
                                </button>
                            ) : (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                                    <div className="flex-1">
                                        <label className={LABEL}>Motivo de la anulación *</label>
                                        <input
                                            autoFocus
                                            value={annulReason}
                                            onChange={(e) => setAnnulReason(e.target.value)}
                                            className={INPUT}
                                            placeholder="Ej: Registrada por error / Nota crédito del proveedor"
                                        />
                                    </div>
                                    <button
                                        onClick={() => setShowAnnul(false)}
                                        className="rounded-md border border-[#C8CDC9] px-3 py-1.5 text-xs font-semibold text-[#2E4040]"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleAnnul}
                                        disabled={annulling}
                                        className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                    >
                                        {annulling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                        Anular y revertir stock
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
