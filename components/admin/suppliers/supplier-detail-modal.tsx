'use client';

import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Edit2, FilePlus2, X } from 'lucide-react';
import type { PurchaseInvoice, Supplier } from '@/lib/types';
import {
    CATEGORY_LABELS,
    STATUS_CONFIG,
    addDaysISO,
    balanceOf,
    daysUntil,
    formatCOP,
    formatDate,
    formatNumber,
    isOpen,
    todayISO,
} from './utils';

type Props = {
    supplier: Supplier;
    invoices: PurchaseInvoice[]; // facturas de este proveedor
    onClose: () => void;
    onEdit: () => void;
    onNewInvoice: () => void;
    onOpenInvoice: (inv: PurchaseInvoice) => void;
};

export default function SupplierDetailModal({ supplier, invoices, onClose, onEdit, onNewInvoice, onOpenInvoice }: Props) {
    const valid = invoices.filter((i) => i.status !== 'anulada');
    const since12m = addDaysISO(todayISO(), -365);

    const stats = useMemo(() => {
        const purchased12m = valid.filter((i) => i.issue_date >= since12m).reduce((a, i) => a + Number(i.total), 0);
        const balance = valid.reduce((a, i) => a + balanceOf(i), 0);
        const overdue = valid.filter((i) => isOpen(i) && daysUntil(i.due_date) < 0);
        const last = [...valid].sort((a, b) => b.issue_date.localeCompare(a.issue_date))[0];
        return {
            purchased12m,
            balance,
            overdueCount: overdue.length,
            overdueAmount: overdue.reduce((a, i) => a + balanceOf(i), 0),
            lastPurchase: last?.issue_date,
        };
    }, [valid, since12m]);

    // Historial de precios por ítem (bobina/core/otro), del más reciente al más antiguo
    const priceHistory = useMemo(() => {
        const rows = valid.flatMap((inv) =>
            (inv.items || []).map((it) => ({
                key:
                    it.raw_material_id ||
                    it.core_material_id ||
                    it.inventory_item_id ||
                    it.core_id ||
                    'otro:' + it.description.toLowerCase(),
                description: it.description,
                unit: it.unit,
                unit_cost: Number(it.unit_cost),
                quantity: Number(it.quantity),
                date: inv.issue_date,
                invoice: inv.invoice_number,
            }))
        );
        const groups = new Map<string, typeof rows>();
        for (const r of rows) groups.set(r.key, [...(groups.get(r.key) || []), r]);
        return [...groups.values()].map((g) => {
            const sorted = g.sort((a, b) => b.date.localeCompare(a.date));
            const latest = sorted[0];
            const prev = sorted[1];
            const change = prev && prev.unit_cost > 0 ? ((latest.unit_cost - prev.unit_cost) / prev.unit_cost) * 100 : null;
            const totalQty = sorted.reduce((a, r) => a + r.quantity, 0);
            return { latest, prev, change, totalQty, count: sorted.length };
        });
    }, [valid]);

    const sortedInvoices = [...invoices].sort((a, b) => b.issue_date.localeCompare(a.issue_date));

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-lg font-bold text-[#2E4040]">{supplier.business_name}</h3>
                        <p className="text-xs text-[#949E97]">
                            {supplier.nit ? `NIT ${supplier.nit}${supplier.verification_digit != null ? '-' + supplier.verification_digit : ''} · ` : ''}
                            {CATEGORY_LABELS[supplier.category]} · Plazo{' '}
                            {supplier.payment_terms_days === 0 ? 'contado' : `${supplier.payment_terms_days} días`}
                            {!supplier.is_active && ' · INACTIVO'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onEdit}
                            className="flex items-center gap-1 rounded-md border border-[#C8CDC9] px-3 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                        >
                            <Edit2 className="h-3.5 w-3.5" /> Editar
                        </button>
                        <button
                            onClick={onNewInvoice}
                            className="flex items-center gap-1 rounded-md bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d6332]"
                        >
                            <FilePlus2 className="h-3.5 w-3.5" /> Factura
                        </button>
                        <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </div>

                <div className="space-y-6 px-6 py-5">
                    {/* KPIs */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Kpi label="Compras últimos 12 meses" value={formatCOP(stats.purchased12m)} />
                        <Kpi label="Saldo por pagar" value={formatCOP(stats.balance)} accent={stats.balance > 0 ? 'amber' : undefined} />
                        <Kpi
                            label="Vencido"
                            value={stats.overdueCount ? `${formatCOP(stats.overdueAmount)} (${stats.overdueCount})` : '—'}
                            accent={stats.overdueCount ? 'red' : undefined}
                        />
                        <Kpi label="Última compra" value={formatDate(stats.lastPurchase)} />
                    </div>

                    {/* Contacto y banco */}
                    <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                        <div className="rounded-lg border border-[#C8CDC9]/70 p-3">
                            <div className="mb-1 font-bold text-[#2E4040]">Contacto</div>
                            <div className="text-[#2E4040]">{supplier.contact_name || '—'}</div>
                            <div className="text-[#949E97]">
                                {[supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'Sin teléfono/email'}
                            </div>
                            <div className="text-[#949E97]">
                                {[supplier.address, supplier.city].filter(Boolean).join(', ')}
                            </div>
                        </div>
                        <div className="rounded-lg border border-[#C8CDC9]/70 p-3">
                            <div className="mb-1 font-bold text-[#2E4040]">Datos bancarios</div>
                            {supplier.bank_account_number ? (
                                <div className="text-[#2E4040]">
                                    {supplier.bank_name || 'Banco'} · {supplier.bank_account_type || 'cuenta'} N.º{' '}
                                    <span className="font-mono">{supplier.bank_account_number}</span>
                                </div>
                            ) : (
                                <div className="text-[#949E97]">No registrados</div>
                            )}
                            {supplier.notes && <div className="mt-1 text-[#949E97]">{supplier.notes}</div>}
                        </div>
                    </div>

                    {/* Historial de precios */}
                    <div>
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#2E4040]">Historial de precios</h4>
                        {priceHistory.length === 0 ? (
                            <p className="text-xs text-[#949E97]">Aún no hay compras registradas.</p>
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-[#C8CDC9]">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-[#F8F9FA] text-[#2E4040]">
                                        <tr>
                                            <th className="px-3 py-2 font-semibold">Ítem</th>
                                            <th className="px-3 py-2 text-right font-semibold">Último precio</th>
                                            <th className="px-3 py-2 text-right font-semibold">Anterior</th>
                                            <th className="px-3 py-2 text-right font-semibold">Variación</th>
                                            <th className="px-3 py-2 text-right font-semibold">Comprado total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#C8CDC9]/50">
                                        {priceHistory.map((h) => (
                                            <tr key={h.latest.description + h.latest.invoice}>
                                                <td className="px-3 py-2">
                                                    <div className="font-medium text-[#2E4040]">{h.latest.description}</div>
                                                    <div className="text-[10px] text-[#949E97]">
                                                        {formatDate(h.latest.date)} · Fact. {h.latest.invoice} · {h.count} compra(s)
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-right font-semibold">
                                                    {formatCOP(h.latest.unit_cost)}/{h.latest.unit}
                                                </td>
                                                <td className="px-3 py-2 text-right text-[#949E97]">
                                                    {h.prev ? `${formatCOP(h.prev.unit_cost)}` : '—'}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    {h.change === null ? (
                                                        <span className="text-[#949E97]">—</span>
                                                    ) : (
                                                        <span
                                                            className={`inline-flex items-center gap-0.5 font-semibold ${
                                                                h.change > 0 ? 'text-red-600' : h.change < 0 ? 'text-emerald-700' : 'text-[#949E97]'
                                                            }`}
                                                        >
                                                            {h.change > 0 ? (
                                                                <ArrowUpRight className="h-3 w-3" />
                                                            ) : h.change < 0 ? (
                                                                <ArrowDownRight className="h-3 w-3" />
                                                            ) : null}
                                                            {formatNumber(Math.abs(h.change), 1)}%
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    {formatNumber(h.totalQty)} {h.latest.unit}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Facturas */}
                    <div>
                        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#2E4040]">
                            Facturas ({invoices.length})
                        </h4>
                        {sortedInvoices.length === 0 ? (
                            <p className="text-xs text-[#949E97]">Sin facturas.</p>
                        ) : (
                            <div className="divide-y divide-[#C8CDC9]/50 rounded-lg border border-[#C8CDC9]">
                                {sortedInvoices.map((inv) => {
                                    const st = STATUS_CONFIG[inv.status];
                                    return (
                                        <button
                                            key={inv.id}
                                            onClick={() => onOpenInvoice(inv)}
                                            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#F9FBFA]"
                                        >
                                            <span>
                                                <span className="font-semibold text-[#2E4040]">{inv.invoice_number}</span>
                                                <span className="ml-2 text-[#949E97]">
                                                    {formatDate(inv.issue_date)} · vence {formatDate(inv.due_date)}
                                                </span>
                                            </span>
                                            <span className="flex items-center gap-2">
                                                <span className="font-semibold">{formatCOP(inv.total)}</span>
                                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}>
                                                    {st.label}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'amber' | 'red' }) {
    const color = accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-700' : 'text-[#2E4040]';
    return (
        <div className="rounded-lg border border-[#C8CDC9]/70 bg-white p-3">
            <div className="text-[10px] font-semibold text-[#949E97]">{label}</div>
            <div className={`mt-0.5 text-sm font-bold ${color}`}>{value}</div>
        </div>
    );
}
