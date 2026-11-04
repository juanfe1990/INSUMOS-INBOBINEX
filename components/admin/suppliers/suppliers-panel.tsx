'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Building,
    CalendarClock,
    Download,
    Eye,
    FilePlus2,
    FileText,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    TrendingUp,
    Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { CoreMaterial, InventoryItem, PurchaseInvoice, RawMaterial, Supplier, SupplierCategory } from '@/lib/types';
import SupplierFormModal from './supplier-form-modal';
import InvoiceFormModal from './invoice-form-modal';
import InvoiceDetailModal from './invoice-detail-modal';
import SupplierDetailModal from './supplier-detail-modal';
import {
    AGING_LABELS,
    type AgingBucket,
    CATEGORY_LABELS,
    INPUT,
    STATUS_CONFIG,
    agingBucket,
    balanceOf,
    daysUntil,
    dbErrorMessage,
    downloadCSV,
    formatCOP,
    formatDate,
    isOpen,
    todayISO,
} from './utils';

type Tab = 'resumen' | 'proveedores' | 'facturas';
type InvoiceFilter = 'abiertas' | 'vencidas' | 'pagadas' | 'anuladas' | 'todas';

export default function SuppliersPanel() {
    const supabase = createClient();
    const [confirmDialog, confirm] = useConfirm();

    const [tab, setTab] = useState<Tab>('resumen');
    const [loading, setLoading] = useState(true);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
    const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
    const [coreMaterials, setCoreMaterials] = useState<CoreMaterial[]>([]);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);

    // Modales
    const [supplierForm, setSupplierForm] = useState<{ open: boolean; supplier: Supplier | null }>({ open: false, supplier: null });
    const [invoiceForm, setInvoiceForm] = useState<{ open: boolean; supplierId?: string }>({ open: false });
    const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
    const [detailSupplierId, setDetailSupplierId] = useState<string | null>(null);

    // Filtros
    const [supplierSearch, setSupplierSearch] = useState('');
    const [supplierCategory, setSupplierCategory] = useState<'all' | SupplierCategory>('all');
    const [showInactive, setShowInactive] = useState(false);
    const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('abiertas');
    const [invoiceSupplier, setInvoiceSupplier] = useState('all');
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const fetchAll = async () => {
        try {
            const [supRes, invRes, rawRes, coreRes, itemsRes] = await Promise.all([
                supabase.from('suppliers').select('*').order('business_name'),
                supabase
                    .from('purchase_invoices')
                    .select('*, supplier:suppliers(*), items:purchase_invoice_items(*), payments:supplier_payments(*)')
                    .order('issue_date', { ascending: false }),
                supabase.from('raw_materials').select('*').order('width_cm'),
                supabase.from('core_materials').select('*').order('created_at'),
                supabase.from('inventory_items').select('*').order('name'),
            ]);
            if (supRes.error) throw supRes.error;
            if (invRes.error) throw invRes.error;
            setSuppliers((supRes.data || []) as Supplier[]);
            setInvoices((invRes.data || []) as unknown as PurchaseInvoice[]);
            setRawMaterials((rawRes.data || []) as RawMaterial[]);
            setCoreMaterials((coreRes.data || []) as CoreMaterial[]);
            setInventoryItems((itemsRes.data || []) as InventoryItem[]);
        } catch (err: any) {
            toast.error('Error cargando proveedores: ' + dbErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
        const channel = supabase
            .channel('realtime-suppliers')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, fetchAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_invoices' }, fetchAll)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'supplier_payments' }, fetchAll)
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------- Derivados ----------
    const openInvoices = useMemo(() => invoices.filter(isOpen), [invoices]);

    const kpis = useMemo(() => {
        const monthStart = todayISO().slice(0, 8) + '01';
        const payable = openInvoices.reduce((a, i) => a + balanceOf(i), 0);
        const overdue = openInvoices.filter((i) => daysUntil(i.due_date) < 0);
        const dueSoon = openInvoices.filter((i) => {
            const d = daysUntil(i.due_date);
            return d >= 0 && d <= 7;
        });
        const monthPurchases = invoices
            .filter((i) => i.status !== 'anulada' && i.issue_date >= monthStart)
            .reduce((a, i) => a + Number(i.total), 0);
        return {
            payable,
            overdueAmount: overdue.reduce((a, i) => a + balanceOf(i), 0),
            overdueCount: overdue.length,
            dueSoonAmount: dueSoon.reduce((a, i) => a + balanceOf(i), 0),
            dueSoonCount: dueSoon.length,
            monthPurchases,
        };
    }, [invoices, openInvoices]);

    const aging = useMemo(() => {
        const buckets: Record<AgingBucket, number> = { por_vencer: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 };
        for (const i of openInvoices) buckets[agingBucket(i.due_date)] += balanceOf(i);
        return buckets;
    }, [openInvoices]);

    const supplierStats = useMemo(() => {
        const map = new Map<string, { balance: number; overdue: number; last?: string; count: number }>();
        for (const inv of invoices) {
            if (inv.status === 'anulada') continue;
            const s = map.get(inv.supplier_id) || { balance: 0, overdue: 0, count: 0 };
            s.balance += balanceOf(inv);
            if (isOpen(inv) && daysUntil(inv.due_date) < 0) s.overdue += balanceOf(inv);
            if (!s.last || inv.issue_date > s.last) s.last = inv.issue_date;
            s.count += 1;
            map.set(inv.supplier_id, s);
        }
        return map;
    }, [invoices]);

    const filteredSuppliers = suppliers.filter((s) => {
        if (!showInactive && !s.is_active) return false;
        if (supplierCategory !== 'all' && s.category !== supplierCategory) return false;
        const q = supplierSearch.trim().toLowerCase();
        if (!q) return true;
        return [s.business_name, s.nit, s.contact_name, s.email].some((v) => v?.toLowerCase().includes(q));
    });

    const filteredInvoices = invoices.filter((i) => {
        if (invoiceFilter === 'abiertas' && !isOpen(i)) return false;
        if (invoiceFilter === 'vencidas' && !(isOpen(i) && daysUntil(i.due_date) < 0)) return false;
        if (invoiceFilter === 'pagadas' && i.status !== 'pagada') return false;
        if (invoiceFilter === 'anuladas' && i.status !== 'anulada') return false;
        if (invoiceSupplier !== 'all' && i.supplier_id !== invoiceSupplier) return false;
        if (dateFrom && i.issue_date < dateFrom) return false;
        if (dateTo && i.issue_date > dateTo) return false;
        const q = invoiceSearch.trim().toLowerCase();
        if (q && !i.invoice_number.toLowerCase().includes(q) && !i.supplier?.business_name.toLowerCase().includes(q))
            return false;
        return true;
    });

    const upcoming = [...openInvoices].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8);

    const detailInvoice = invoices.find((i) => i.id === detailInvoiceId) || null;
    const detailSupplier = suppliers.find((s) => s.id === detailSupplierId) || null;

    // ---------- Acciones ----------
    const handleDeleteSupplier = async (s: Supplier) => {
        const count = supplierStats.get(s.id)?.count || invoices.filter((i) => i.supplier_id === s.id).length;
        if (count > 0) {
            toast.error(
                `"${s.business_name}" tiene ${count} factura(s) registradas. Para conservar el historial, desactívalo en lugar de eliminarlo.`
            );
            return;
        }
        const ok = await confirm({
            title: `¿Eliminar el proveedor "${s.business_name}"?`,
            description: 'No tiene facturas registradas. Esta acción no se puede deshacer.',
            confirmLabel: 'Eliminar',
        });
        if (!ok) return;
        const { data, error } = await supabase.from('suppliers').delete().eq('id', s.id).select('id');
        if (error || !data?.length) {
            toast.error('No se pudo eliminar: ' + (error ? dbErrorMessage(error) : 'sin permiso (se requiere admin)'));
            return;
        }
        toast.success('Proveedor eliminado');
        fetchAll();
    };

    const exportInvoicesCSV = () => {
        if (filteredInvoices.length === 0) return toast.info('No hay facturas para exportar con los filtros actuales');
        downloadCSV(
            `facturas-compra-${todayISO()}.csv`,
            ['Proveedor', 'NIT', 'Factura', 'CUFE', 'Emisión', 'Vencimiento', 'Subtotal', 'IVA', 'Retención', 'Total', 'Pagado', 'Saldo', 'Estado'],
            filteredInvoices.map((i) => [
                i.supplier?.business_name || '',
                i.supplier?.nit ? `${i.supplier.nit}${i.supplier.verification_digit != null ? '-' + i.supplier.verification_digit : ''}` : '',
                i.invoice_number,
                i.cufe || '',
                i.issue_date,
                i.due_date,
                Math.round(Number(i.subtotal)),
                Math.round(Number(i.tax_amount)),
                Math.round(Number(i.withholding_amount)),
                Math.round(Number(i.total)),
                Math.round(Number(i.paid_amount)),
                Math.round(balanceOf(i)),
                STATUS_CONFIG[i.status].label,
            ])
        );
    };

    const tabBtn = (key: Tab, label: string, icon: React.ReactNode) => (
        <button
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                tab === key ? 'bg-[#2E4040] text-white' : 'border border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
            }`}
        >
            {icon}
            {label}
        </button>
    );

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {confirmDialog}

            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Proveedores & Cuentas por Pagar</h2>
                    <p className="text-sm text-[#949E97]">
                        Facturas de compra conectadas al inventario, control de pagos y vencimientos
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={fetchAll}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <RefreshCw className="h-3.5 w-3.5 text-[#3F8346]" /> Refrescar
                    </button>
                    <button
                        onClick={() => setSupplierForm({ open: true, supplier: null })}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <Plus className="h-3.5 w-3.5" /> Proveedor
                    </button>
                    <button
                        onClick={() => setInvoiceForm({ open: true })}
                        className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332]"
                    >
                        <FilePlus2 className="h-3.5 w-3.5" /> Registrar factura
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                {tabBtn('resumen', 'Resumen CxP', <Wallet className="h-3.5 w-3.5" />)}
                {tabBtn('proveedores', `Proveedores (${suppliers.length})`, <Building className="h-3.5 w-3.5" />)}
                {tabBtn('facturas', `Facturas (${invoices.length})`, <FileText className="h-3.5 w-3.5" />)}
            </div>

            {/* ===================== RESUMEN ===================== */}
            {tab === 'resumen' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <KpiCard
                            icon={<Wallet className="h-5 w-5" />}
                            label="Total por pagar"
                            value={formatCOP(kpis.payable)}
                            sub={`${openInvoices.length} factura(s) abiertas`}
                        />
                        <KpiCard
                            icon={<AlertTriangle className="h-5 w-5" />}
                            label="Vencido"
                            value={formatCOP(kpis.overdueAmount)}
                            sub={`${kpis.overdueCount} factura(s)`}
                            tone={kpis.overdueCount ? 'red' : undefined}
                            onClick={() => {
                                setInvoiceFilter('vencidas');
                                setTab('facturas');
                            }}
                        />
                        <KpiCard
                            icon={<CalendarClock className="h-5 w-5" />}
                            label="Vence en 7 días"
                            value={formatCOP(kpis.dueSoonAmount)}
                            sub={`${kpis.dueSoonCount} factura(s)`}
                            tone={kpis.dueSoonCount ? 'amber' : undefined}
                        />
                        <KpiCard
                            icon={<TrendingUp className="h-5 w-5" />}
                            label="Compras del mes"
                            value={formatCOP(kpis.monthPurchases)}
                            sub="Facturas no anuladas"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
                        {/* Antigüedad de cartera */}
                        <div className="rounded-xl border border-[#C8CDC9] bg-white p-5 shadow-sm lg:col-span-2">
                            <h3 className="mb-4 text-sm font-bold text-[#2E4040]">Antigüedad de saldos</h3>
                            {kpis.payable === 0 ? (
                                <p className="text-xs text-[#949E97]">No hay saldos pendientes.</p>
                            ) : (
                                <div className="space-y-3">
                                    {(Object.keys(aging) as AgingBucket[]).map((b) => {
                                        const pct = kpis.payable ? (aging[b] / kpis.payable) * 100 : 0;
                                        const color =
                                            b === 'por_vencer'
                                                ? 'bg-[#3F8346]'
                                                : b === 'd1_30'
                                                  ? 'bg-amber-400'
                                                  : b === 'd31_60'
                                                    ? 'bg-orange-500'
                                                    : 'bg-red-600';
                                        return (
                                            <div key={b}>
                                                <div className="mb-1 flex justify-between text-[11px]">
                                                    <span className="font-semibold text-[#2E4040]">{AGING_LABELS[b]}</span>
                                                    <span className="text-[#949E97]">{formatCOP(aging[b])}</span>
                                                </div>
                                                <div className="h-2 overflow-hidden rounded-full bg-[#C8CDC9]/30">
                                                    <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Próximos vencimientos */}
                        <div className="rounded-xl border border-[#C8CDC9] bg-white p-5 shadow-sm lg:col-span-3">
                            <h3 className="mb-4 text-sm font-bold text-[#2E4040]">Próximos pagos</h3>
                            {upcoming.length === 0 ? (
                                <p className="text-xs text-[#949E97]">No hay facturas pendientes de pago. 🎉</p>
                            ) : (
                                <div className="divide-y divide-[#C8CDC9]/50">
                                    {upcoming.map((inv) => {
                                        const d = daysUntil(inv.due_date);
                                        return (
                                            <button
                                                key={inv.id}
                                                onClick={() => setDetailInvoiceId(inv.id)}
                                                className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-xs hover:bg-[#F9FBFA]"
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate font-semibold text-[#2E4040]">
                                                        {inv.supplier?.business_name}
                                                    </div>
                                                    <div className="text-[#949E97]">
                                                        Fact. {inv.invoice_number} · vence {formatDate(inv.due_date)}
                                                    </div>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <div className="font-bold text-[#2E4040]">{formatCOP(balanceOf(inv))}</div>
                                                    <DueBadge days={d} />
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ===================== PROVEEDORES ===================== */}
            {tab === 'proveedores' && (
                <div className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#949E97]" />
                            <input
                                value={supplierSearch}
                                onChange={(e) => setSupplierSearch(e.target.value)}
                                placeholder="Buscar por razón social, NIT, contacto o email..."
                                className={`${INPUT} pl-8`}
                            />
                        </div>
                        <select
                            value={supplierCategory}
                            onChange={(e) => setSupplierCategory(e.target.value as typeof supplierCategory)}
                            className={`${INPUT} bg-white sm:w-56`}
                        >
                            <option value="all">Todas las categorías</option>
                            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-[#2E4040]">
                            <input
                                type="checkbox"
                                checked={showInactive}
                                onChange={(e) => setShowInactive(e.target.checked)}
                                className="accent-[#3F8346]"
                            />
                            Ver inactivos
                        </label>
                    </div>

                    {filteredSuppliers.length === 0 ? (
                        <EmptyState
                            text={suppliers.length === 0 ? 'Aún no hay proveedores registrados' : 'Ningún proveedor coincide con los filtros'}
                            action={
                                suppliers.length === 0 ? (
                                    <button
                                        onClick={() => setSupplierForm({ open: true, supplier: null })}
                                        className="mt-3 rounded-md bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d6332]"
                                    >
                                        Registrar primer proveedor
                                    </button>
                                ) : null
                            }
                        />
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-[#C8CDC9] bg-white shadow-sm">
                            <table className="w-full text-left text-xs">
                                <thead className="border-b border-[#C8CDC9] bg-[#C8CDC9]/20 font-semibold text-[#2E4040]">
                                    <tr>
                                        <th className="px-4 py-3">Proveedor</th>
                                        <th className="px-4 py-3">Categoría</th>
                                        <th className="px-4 py-3">Plazo</th>
                                        <th className="px-4 py-3 text-right">Saldo</th>
                                        <th className="px-4 py-3 text-right">Vencido</th>
                                        <th className="px-4 py-3">Última compra</th>
                                        <th className="px-4 py-3 text-right">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/50">
                                    {filteredSuppliers.map((s) => {
                                        const st = supplierStats.get(s.id);
                                        return (
                                            <tr key={s.id} className={`hover:bg-slate-50/80 ${s.is_active ? '' : 'opacity-60'}`}>
                                                <td className="px-4 py-3">
                                                    <button
                                                        onClick={() => setDetailSupplierId(s.id)}
                                                        className="text-left font-semibold text-[#2E4040] hover:text-[#3F8346] hover:underline"
                                                    >
                                                        {s.business_name}
                                                    </button>
                                                    <div className="text-[11px] text-[#949E97]">
                                                        {s.nit ? `NIT ${s.nit}${s.verification_digit != null ? '-' + s.verification_digit : ''}` : 'Sin NIT'}
                                                        {s.contact_name ? ` · ${s.contact_name}` : ''}
                                                        {!s.is_active && ' · Inactivo'}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-[#2E4040]">{CATEGORY_LABELS[s.category]}</td>
                                                <td className="px-4 py-3">
                                                    {s.payment_terms_days === 0 ? 'Contado' : `${s.payment_terms_days} días`}
                                                </td>
                                                <td className="px-4 py-3 text-right font-semibold">
                                                    {st?.balance ? formatCOP(st.balance) : '—'}
                                                </td>
                                                <td className={`px-4 py-3 text-right font-semibold ${st?.overdue ? 'text-red-600' : ''}`}>
                                                    {st?.overdue ? formatCOP(st.overdue) : '—'}
                                                </td>
                                                <td className="px-4 py-3 text-[#949E97]">{formatDate(st?.last)}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex justify-end gap-1">
                                                        <IconBtn title="Ver ficha" onClick={() => setDetailSupplierId(s.id)}>
                                                            <Eye className="h-4 w-4" />
                                                        </IconBtn>
                                                        <IconBtn title="Editar" onClick={() => setSupplierForm({ open: true, supplier: s })}>
                                                            <Pencil className="h-4 w-4" />
                                                        </IconBtn>
                                                        <IconBtn
                                                            title="Registrar factura"
                                                            onClick={() => setInvoiceForm({ open: true, supplierId: s.id })}
                                                        >
                                                            <FilePlus2 className="h-4 w-4" />
                                                        </IconBtn>
                                                        <IconBtn title="Eliminar" danger onClick={() => handleDeleteSupplier(s)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </IconBtn>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ===================== FACTURAS ===================== */}
            {tab === 'facturas' && (
                <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {(
                            [
                                ['abiertas', `Por pagar (${openInvoices.length})`],
                                ['vencidas', `Vencidas (${kpis.overdueCount})`],
                                ['pagadas', 'Pagadas'],
                                ['anuladas', 'Anuladas'],
                                ['todas', 'Todas'],
                            ] as [InvoiceFilter, string][]
                        ).map(([k, label]) => (
                            <button
                                key={k}
                                onClick={() => setInvoiceFilter(k)}
                                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                                    invoiceFilter === k
                                        ? k === 'vencidas'
                                            ? 'bg-red-600 text-white'
                                            : 'bg-[#3F8346] text-white'
                                        : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                        <div className="relative sm:col-span-4">
                            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#949E97]" />
                            <input
                                value={invoiceSearch}
                                onChange={(e) => setInvoiceSearch(e.target.value)}
                                placeholder="N.º factura o proveedor..."
                                className={`${INPUT} pl-8`}
                            />
                        </div>
                        <select
                            value={invoiceSupplier}
                            onChange={(e) => setInvoiceSupplier(e.target.value)}
                            className={`${INPUT} bg-white sm:col-span-3`}
                        >
                            <option value="all">Todos los proveedores</option>
                            {suppliers.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.business_name}
                                </option>
                            ))}
                        </select>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className={`${INPUT} sm:col-span-2`}
                            title="Emitidas desde"
                        />
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className={`${INPUT} sm:col-span-2`}
                            title="Emitidas hasta"
                        />
                        <button
                            onClick={exportInvoicesCSV}
                            className="flex items-center justify-center gap-1.5 rounded border border-[#C8CDC9] bg-white px-2 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 sm:col-span-1"
                            title="Exportar a CSV (Excel) con los filtros actuales"
                        >
                            <Download className="h-3.5 w-3.5" /> CSV
                        </button>
                    </div>

                    {filteredInvoices.length === 0 ? (
                        <EmptyState text="No hay facturas con estos filtros" />
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-[#C8CDC9] bg-white shadow-sm">
                            <table className="w-full text-left text-xs">
                                <thead className="border-b border-[#C8CDC9] bg-[#C8CDC9]/20 font-semibold text-[#2E4040]">
                                    <tr>
                                        <th className="px-4 py-3">Factura</th>
                                        <th className="px-4 py-3">Proveedor</th>
                                        <th className="px-4 py-3">Emisión</th>
                                        <th className="px-4 py-3">Vencimiento</th>
                                        <th className="px-4 py-3 text-right">Total</th>
                                        <th className="px-4 py-3 text-right">Saldo</th>
                                        <th className="px-4 py-3">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/50">
                                    {filteredInvoices.map((inv) => {
                                        const st = STATUS_CONFIG[inv.status];
                                        return (
                                            <tr
                                                key={inv.id}
                                                onClick={() => setDetailInvoiceId(inv.id)}
                                                className="cursor-pointer hover:bg-slate-50/80"
                                            >
                                                <td className="px-4 py-3 font-mono font-bold text-[#2E4040]">{inv.invoice_number}</td>
                                                <td className="px-4 py-3 text-[#2E4040]">{inv.supplier?.business_name}</td>
                                                <td className="px-4 py-3 text-[#949E97]">{formatDate(inv.issue_date)}</td>
                                                <td className="px-4 py-3">
                                                    <div>{formatDate(inv.due_date)}</div>
                                                    {isOpen(inv) && <DueBadge days={daysUntil(inv.due_date)} />}
                                                </td>
                                                <td className="px-4 py-3 text-right font-semibold">{formatCOP(inv.total)}</td>
                                                <td className="px-4 py-3 text-right font-semibold">
                                                    {balanceOf(inv) ? formatCOP(balanceOf(inv)) : '—'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                                                        {st.label}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="border-t border-[#C8CDC9] bg-[#F8F9FA] font-semibold text-[#2E4040]">
                                    <tr>
                                        <td colSpan={4} className="px-4 py-2.5 text-right">
                                            Totales ({filteredInvoices.length})
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            {formatCOP(
                                                filteredInvoices
                                                    .filter((i) => i.status !== 'anulada')
                                                    .reduce((a, i) => a + Number(i.total), 0)
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            {formatCOP(filteredInvoices.reduce((a, i) => a + balanceOf(i), 0))}
                                        </td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ===================== MODALES ===================== */}
            {supplierForm.open && (
                <SupplierFormModal
                    supplier={supplierForm.supplier}
                    onClose={() => setSupplierForm({ open: false, supplier: null })}
                    onSaved={() => {
                        setSupplierForm({ open: false, supplier: null });
                        fetchAll();
                    }}
                />
            )}
            {invoiceForm.open && (
                <InvoiceFormModal
                    suppliers={suppliers}
                    rawMaterials={rawMaterials}
                    coreMaterials={coreMaterials}
                    inventoryItems={inventoryItems}
                    defaultSupplierId={invoiceForm.supplierId}
                    onClose={() => setInvoiceForm({ open: false })}
                    onSaved={() => {
                        setInvoiceForm({ open: false });
                        fetchAll();
                    }}
                />
            )}
            {detailSupplier && !supplierForm.open && !invoiceForm.open && !detailInvoice && (
                <SupplierDetailModal
                    supplier={detailSupplier}
                    invoices={invoices.filter((i) => i.supplier_id === detailSupplier.id)}
                    onClose={() => setDetailSupplierId(null)}
                    onEdit={() => setSupplierForm({ open: true, supplier: detailSupplier })}
                    onNewInvoice={() => setInvoiceForm({ open: true, supplierId: detailSupplier.id })}
                    onOpenInvoice={(inv) => setDetailInvoiceId(inv.id)}
                />
            )}
            {detailInvoice && (
                <InvoiceDetailModal
                    key={detailInvoice.id + detailInvoice.updated_at}
                    invoice={detailInvoice}
                    onClose={() => setDetailInvoiceId(null)}
                    onChanged={fetchAll}
                />
            )}
        </div>
    );
}

function KpiCard({
    icon,
    label,
    value,
    sub,
    tone,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub: string;
    tone?: 'red' | 'amber';
    onClick?: () => void;
}) {
    const toneCls =
        tone === 'red' ? 'text-red-600 bg-red-50' : tone === 'amber' ? 'text-amber-700 bg-amber-50' : 'text-[#3F8346] bg-[#3F8346]/10';
    const Comp = onClick ? 'button' : 'div';
    return (
        <Comp
            onClick={onClick}
            className={`flex items-center gap-3 rounded-xl border border-[#C8CDC9] bg-white p-4 text-left shadow-sm ${
                onClick ? 'transition hover:shadow-md' : ''
            }`}
        >
            <div className={`rounded-lg p-2.5 ${toneCls}`}>{icon}</div>
            <div>
                <div className="text-[11px] font-semibold text-[#949E97]">{label}</div>
                <div className={`text-lg font-bold ${tone === 'red' ? 'text-red-600' : 'text-[#2E4040]'}`}>{value}</div>
                <div className="text-[10px] text-[#949E97]">{sub}</div>
            </div>
        </Comp>
    );
}

function DueBadge({ days }: { days: number }) {
    if (days < 0)
        return <span className="text-[10px] font-semibold text-red-600">Vencida hace {-days} d</span>;
    if (days === 0) return <span className="text-[10px] font-semibold text-amber-700">Vence hoy</span>;
    if (days <= 7) return <span className="text-[10px] font-semibold text-amber-700">En {days} d</span>;
    return <span className="text-[10px] text-[#949E97]">En {days} d</span>;
}

function IconBtn({
    children,
    title,
    onClick,
    danger,
}: {
    children: React.ReactNode;
    title: string;
    onClick: () => void;
    danger?: boolean;
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            aria-label={title}
            className={`rounded-md p-1.5 transition ${
                danger ? 'text-red-500 hover:bg-red-50 hover:text-red-700' : 'text-[#949E97] hover:bg-[#3F8346]/10 hover:text-[#3F8346]'
            }`}
        >
            {children}
        </button>
    );
}

function EmptyState({ text, action }: { text: string; action?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#C8CDC9] bg-white/50 py-16 text-center">
            <Building className="h-10 w-10 text-[#C8CDC9]" />
            <p className="mt-3 text-sm font-semibold text-[#2E4040]">{text}</p>
            {action}
        </div>
    );
}
