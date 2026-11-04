'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, X, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { CoreMaterial, InventoryItem, PurchaseItemType, RawMaterial, Supplier } from '@/lib/types';
import {
    DEFAULT_VAT_RATE,
    INPUT,
    ITEM_TYPE_LABELS,
    LABEL,
    addDaysISO,
    dbErrorMessage,
    formatCOP,
    formatNumber,
    todayISO,
} from './utils';

type Line = {
    key: number;
    item_type: PurchaseItemType;
    raw_material_id: string;
    core_material_id: string;
    inventory_item_id: string;
    description: string;
    unit: string;
    quantity: string;
    unit_cost: string;
};

type Props = {
    suppliers: Supplier[];
    rawMaterials: RawMaterial[];
    coreMaterials: CoreMaterial[];
    /** Productos del inventario general (cintas, cartón...) */
    inventoryItems: InventoryItem[];
    defaultSupplierId?: string;
    onClose: () => void;
    onSaved: () => void;
};

let lineSeq = 1;

export default function InvoiceFormModal({
    suppliers,
    rawMaterials,
    coreMaterials,
    inventoryItems,
    defaultSupplierId,
    onClose,
    onSaved,
}: Props) {
    const activeItems = inventoryItems.filter((i) => i.is_active);
    const supabase = createClient();
    const activeSuppliers = suppliers.filter((s) => s.is_active || s.id === defaultSupplierId);

    const [saving, setSaving] = useState(false);
    const [supplierId, setSupplierId] = useState(defaultSupplierId || activeSuppliers[0]?.id || '');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [cufe, setCufe] = useState('');
    const [issueDate, setIssueDate] = useState(todayISO());
    const [dueDate, setDueDate] = useState('');
    const [dueTouched, setDueTouched] = useState(false);
    const [applyVat, setApplyVat] = useState(true);
    const [taxAmount, setTaxAmount] = useState('');
    const [taxTouched, setTaxTouched] = useState(false);
    const [withholding, setWithholding] = useState('0');
    const [notes, setNotes] = useState('');

    const newLine = (type: PurchaseItemType = 'bobina'): Line => ({
        key: lineSeq++,
        item_type: type,
        raw_material_id: type === 'bobina' ? rawMaterials[0]?.id || '' : '',
        core_material_id: type === 'core' ? coreMaterials[0]?.id || '' : '',
        inventory_item_id: type === 'insumo' ? activeItems[0]?.id || '' : '',
        description: '',
        // Bobinas y material de cores se compran por kg; los insumos en su propia unidad
        unit: type === 'otro' ? 'und' : type === 'insumo' ? activeItems[0]?.unit || 'und' : 'kg',
        quantity: '',
        unit_cost:
            type === 'bobina' && rawMaterials[0]
                ? String(Number(rawMaterials[0].cost_per_kg) || '')
                : type === 'core' && coreMaterials[0]
                  ? String(Number(coreMaterials[0].cost_per_kg) || '')
                  : type === 'insumo' && activeItems[0]
                    ? String(Number(activeItems[0].avg_cost) || '')
                    : '',
    });
    const [lines, setLines] = useState<Line[]>(() => [newLine()]);

    const supplier = suppliers.find((s) => s.id === supplierId);

    // Vencimiento automático = emisión + plazo del proveedor
    useEffect(() => {
        if (!dueTouched && issueDate) {
            setDueDate(addDaysISO(issueDate, supplier?.payment_terms_days ?? 0));
        }
    }, [issueDate, supplier?.payment_terms_days, dueTouched]);

    const subtotal = useMemo(
        () => lines.reduce((acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0),
        [lines]
    );

    // IVA sugerido 19% mientras el usuario no lo edite
    useEffect(() => {
        if (!taxTouched) setTaxAmount(applyVat ? String(Math.round(subtotal * DEFAULT_VAT_RATE)) : '0');
    }, [subtotal, applyVat, taxTouched]);

    const total = subtotal + (Number(taxAmount) || 0) - (Number(withholding) || 0);

    const updateLine = (key: number, patch: Partial<Line>) =>
        setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

    const changeLineType = (key: number, type: PurchaseItemType) =>
        setLines((ls) => ls.map((l) => (l.key === key ? { ...newLine(type), key } : l)));

    const handleRefChange = (line: Line, id: string) => {
        if (line.item_type === 'bobina') {
            const raw = rawMaterials.find((m) => m.id === id);
            updateLine(line.key, {
                raw_material_id: id,
                unit_cost: line.unit_cost || (raw ? String(Number(raw.cost_per_kg) || '') : ''),
            });
        } else if (line.item_type === 'insumo') {
            const it = activeItems.find((m) => m.id === id);
            updateLine(line.key, {
                inventory_item_id: id,
                unit: it?.unit || 'und',
                unit_cost: it ? String(Number(it.avg_cost) || '') : '',
            });
        } else {
            const mat = coreMaterials.find((m) => m.id === id);
            updateLine(line.key, {
                core_material_id: id,
                unit_cost: line.unit_cost || (mat ? String(Number(mat.cost_per_kg) || '') : ''),
            });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supplierId) return toast.error('Selecciona el proveedor');
        if (!invoiceNumber.trim()) return toast.error('Ingresa el número de factura');
        if (dueDate && dueDate < issueDate) return toast.error('El vencimiento no puede ser anterior a la emisión');

        for (const [i, l] of lines.entries()) {
            const n = i + 1;
            if (!(Number(l.quantity) > 0)) return toast.error(`Línea ${n}: la cantidad debe ser mayor a 0`);
            if (!(Number(l.unit_cost) >= 0) || l.unit_cost === '') return toast.error(`Línea ${n}: ingresa el costo unitario`);
            if (l.item_type === 'bobina' && !l.raw_material_id) return toast.error(`Línea ${n}: selecciona la bobina madre`);
            if (l.item_type === 'core' && !l.core_material_id)
                return toast.error(`Línea ${n}: selecciona el material de cores`);
            if (l.item_type === 'insumo' && !l.inventory_item_id)
                return toast.error(`Línea ${n}: selecciona el producto de inventario`);
            if (l.item_type === 'otro' && !l.description.trim()) return toast.error(`Línea ${n}: describe el gasto`);
        }
        if (total < 0) return toast.error('La retención no puede superar el subtotal + IVA');

        try {
            setSaving(true);
            const { error } = await supabase.rpc('register_purchase_invoice', {
                p_invoice: {
                    supplier_id: supplierId,
                    invoice_number: invoiceNumber.trim(),
                    cufe: cufe.trim(),
                    issue_date: issueDate,
                    due_date: dueDate,
                    tax_amount: Number(taxAmount) || 0,
                    withholding_amount: Number(withholding) || 0,
                    notes: notes.trim(),
                },
                p_items: lines.map((l) => ({
                    item_type: l.item_type,
                    raw_material_id: l.item_type === 'bobina' ? l.raw_material_id : null,
                    core_material_id: l.item_type === 'core' ? l.core_material_id : null,
                    inventory_item_id: l.item_type === 'insumo' ? l.inventory_item_id : null,
                    description: l.description.trim(),
                    unit: l.unit,
                    quantity: Number(l.quantity),
                    unit_cost: Number(l.unit_cost),
                })),
            });
            if (error) throw error;

            const stockLines = lines.filter((l) => l.item_type !== 'otro').length;
            toast.success(
                `Factura ${invoiceNumber.trim()} registrada` +
                    (stockLines ? ` · ${stockLines} línea(s) ingresadas al inventario y Kardex` : '')
            );
            onSaved();
        } catch (err: any) {
            toast.error('No se pudo registrar la factura: ' + dbErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-lg font-bold text-[#2E4040]">Registrar factura de compra</h3>
                        <p className="text-[11px] text-[#949E97]">
                            Las líneas de bobinas, material de cores (kg) e insumos (cintas, cartón...) suman stock, actualizan el costo promedio y quedan en el Kardex.
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {activeSuppliers.length === 0 ? (
                    <div className="p-8 text-center text-sm text-[#949E97]">
                        Primero registra un proveedor activo en la pestaña &quot;Proveedores&quot;.
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
                        {/* Cabecera */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                            <div className="sm:col-span-5">
                                <label className={LABEL}>Proveedor *</label>
                                <select
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                    className={`${INPUT} bg-white font-semibold`}
                                >
                                    {activeSuppliers.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.business_name}
                                            {s.nit ? ` — NIT ${s.nit}${s.verification_digit != null ? '-' + s.verification_digit : ''}` : ''}
                                        </option>
                                    ))}
                                </select>
                                {supplier && (
                                    <p className="mt-0.5 text-[10px] text-[#949E97]">
                                        Plazo: {supplier.payment_terms_days === 0 ? 'contado' : `${supplier.payment_terms_days} días`}
                                    </p>
                                )}
                            </div>
                            <div className="sm:col-span-3">
                                <label className={LABEL}>N.º factura *</label>
                                <input
                                    required
                                    value={invoiceNumber}
                                    onChange={(e) => setInvoiceNumber(e.target.value)}
                                    className={INPUT}
                                    placeholder="FE-1234"
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={LABEL}>Emisión *</label>
                                <input
                                    type="date"
                                    required
                                    value={issueDate}
                                    onChange={(e) => setIssueDate(e.target.value)}
                                    className={INPUT}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={LABEL}>Vencimiento *</label>
                                <input
                                    type="date"
                                    required
                                    min={issueDate}
                                    value={dueDate}
                                    onChange={(e) => {
                                        setDueTouched(true);
                                        setDueDate(e.target.value);
                                    }}
                                    className={INPUT}
                                />
                            </div>
                        </div>
                        <div>
                            <label className={LABEL}>CUFE (factura electrónica DIAN, opcional)</label>
                            <input
                                value={cufe}
                                onChange={(e) => setCufe(e.target.value)}
                                className={`${INPUT} font-mono`}
                                placeholder="Código único de factura electrónica"
                            />
                        </div>

                        {/* Líneas */}
                        <div className="rounded-lg border border-[#C8CDC9]">
                            <div className="flex items-center justify-between border-b border-[#C8CDC9] bg-[#F8F9FA] px-3 py-2">
                                <span className="text-xs font-bold text-[#2E4040]">Detalle de la factura</span>
                                <div className="flex gap-1.5">
                                    {(['bobina', 'core', 'insumo', 'otro'] as PurchaseItemType[]).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setLines((ls) => [...ls, newLine(t)])}
                                            className="flex items-center gap-1 rounded border border-[#C8CDC9] bg-white px-2 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                        >
                                            <Plus className="h-3 w-3" />
                                            {t === 'bobina' ? 'Bobina' : t === 'core' ? 'Core' : t === 'insumo' ? 'Insumo' : 'Otro'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="divide-y divide-[#C8CDC9]/60">
                                {lines.map((l, idx) => {
                                    const lineTotal = (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0);
                                    const raw = rawMaterials.find((m) => m.id === l.raw_material_id);
                                    const mat = coreMaterials.find((m) => m.id === l.core_material_id);
                                    const inv = activeItems.find((m) => m.id === l.inventory_item_id);
                                    return (
                                        <div key={l.key} className="grid grid-cols-12 items-end gap-2 p-3">
                                            <div className="col-span-12 sm:col-span-2">
                                                <label className={LABEL}>Tipo</label>
                                                <select
                                                    value={l.item_type}
                                                    onChange={(e) => changeLineType(l.key, e.target.value as PurchaseItemType)}
                                                    className={`${INPUT} bg-white`}
                                                >
                                                    {Object.entries(ITEM_TYPE_LABELS).map(([k, v]) => (
                                                        <option key={k} value={k}>
                                                            {v}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="col-span-12 sm:col-span-4">
                                                <label className={LABEL}>
                                                    {l.item_type === 'otro' ? 'Descripción *' : 'Ítem de inventario *'}
                                                </label>
                                                {l.item_type === 'bobina' ? (
                                                    rawMaterials.length === 0 ? (
                                                        <p className="text-[11px] font-semibold text-amber-700">
                                                            Crea primero la bobina en Inventarios.
                                                        </p>
                                                    ) : (
                                                        <select
                                                            value={l.raw_material_id}
                                                            onChange={(e) => handleRefChange(l, e.target.value)}
                                                            className={`${INPUT} bg-white`}
                                                        >
                                                            {rawMaterials.map((m) => (
                                                                <option key={m.id} value={m.id}>
                                                                    {m.name} · {Number(m.width_cm)} cm · {Number(m.caliber_microns)} µ
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )
                                                ) : l.item_type === 'core' ? (
                                                    coreMaterials.length === 0 ? (
                                                        <p className="text-[11px] font-semibold text-amber-700">
                                                            Crea primero el material de cores en Inventarios.
                                                        </p>
                                                    ) : (
                                                        <select
                                                            value={l.core_material_id}
                                                            onChange={(e) => handleRefChange(l, e.target.value)}
                                                            className={`${INPUT} bg-white`}
                                                        >
                                                            {coreMaterials.map((m) => (
                                                                <option key={m.id} value={m.id}>
                                                                    {m.name} (kg)
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )
                                                ) : l.item_type === 'insumo' ? (
                                                    activeItems.length === 0 ? (
                                                        <p className="text-[11px] font-semibold text-amber-700">
                                                            Crea primero el producto en Inventarios → Otros Inventarios.
                                                        </p>
                                                    ) : (
                                                        <select
                                                            value={l.inventory_item_id}
                                                            onChange={(e) => handleRefChange(l, e.target.value)}
                                                            className={`${INPUT} bg-white`}
                                                        >
                                                            {activeItems.map((m) => (
                                                                <option key={m.id} value={m.id}>
                                                                    {m.name} ({m.unit})
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )
                                                ) : (
                                                    <input
                                                        value={l.description}
                                                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                                                        className={INPUT}
                                                        placeholder="Ej: Flete, servicio, mantenimiento..."
                                                    />
                                                )}
                                                {l.item_type === 'insumo' && inv && (
                                                    <p className="mt-0.5 text-[10px] text-[#949E97]">
                                                        Costo promedio actual: {formatCOP(Number(inv.avg_cost))}/{inv.unit} · stock{' '}
                                                        {formatNumber(Number(inv.current_stock))} {inv.unit}
                                                    </p>
                                                )}
                                                {l.item_type === 'core' && mat && (
                                                    <p className="mt-0.5 text-[10px] text-[#949E97]">
                                                        Costo promedio actual: {formatCOP(Number(mat.cost_per_kg))}/kg · stock{' '}
                                                        {formatNumber(Number(mat.current_stock_kg))} kg
                                                    </p>
                                                )}
                                                {l.item_type === 'bobina' && raw && (
                                                    <p className="mt-0.5 text-[10px] text-[#949E97]">
                                                        Costo promedio actual: {formatCOP(Number(raw.cost_per_kg))}/kg · stock{' '}
                                                        {formatNumber(Number(raw.current_stock_kg))} kg
                                                    </p>
                                                )}
                                            </div>
                                            <div className="col-span-4 sm:col-span-2">
                                                <label className={LABEL}>
                                                    Cantidad ({l.item_type === 'otro' || l.item_type === 'insumo' ? l.unit : 'kg'})
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="any"
                                                    value={l.quantity}
                                                    onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                                                    className={INPUT}
                                                />
                                            </div>
                                            <div className="col-span-4 sm:col-span-2">
                                                <label className={LABEL}>
                                                    {l.item_type === 'otro'
                                                        ? 'Costo unit. ($)'
                                                        : `Costo / ${l.item_type === 'insumo' ? l.unit : 'kg'} ($)`}
                                                </label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="any"
                                                    value={l.unit_cost}
                                                    onChange={(e) => updateLine(l.key, { unit_cost: e.target.value })}
                                                    className={INPUT}
                                                />
                                            </div>
                                            <div className="col-span-3 sm:col-span-1 pb-1.5 text-right text-xs font-bold text-[#2E4040]">
                                                {formatCOP(lineTotal)}
                                            </div>
                                            <div className="col-span-1 pb-1 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                                                    disabled={lines.length === 1}
                                                    className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-30"
                                                    aria-label={`Quitar línea ${idx + 1}`}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Totales */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className={LABEL}>Notas</label>
                                <textarea
                                    rows={4}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    className={INPUT}
                                    placeholder="Orden de compra, remisión, observaciones de recepción..."
                                />
                            </div>
                            <div className="space-y-2 rounded-lg border border-[#C8CDC9] bg-[#F8F9FA] p-3 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-[#949E97]">Subtotal</span>
                                    <span className="font-semibold text-[#2E4040]">{formatCOP(subtotal)}</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <label className="flex items-center gap-1.5 text-[#949E97]">
                                        <input
                                            type="checkbox"
                                            checked={applyVat}
                                            onChange={(e) => {
                                                setApplyVat(e.target.checked);
                                                setTaxTouched(false);
                                            }}
                                            className="accent-[#3F8346]"
                                        />
                                        IVA 19%
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={taxAmount}
                                        onChange={(e) => {
                                            setTaxTouched(true);
                                            setTaxAmount(e.target.value);
                                        }}
                                        className={`${INPUT} w-32 text-right`}
                                    />
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[#949E97]">
                                        Retención (−)
                                        <button
                                            type="button"
                                            onClick={() => setWithholding(String(Math.round(subtotal * 0.025)))}
                                            className="ml-1.5 rounded border border-[#C8CDC9] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                            title="Retención en la fuente por compras (2,5%)"
                                        >
                                            ReteFuente 2,5%
                                        </button>
                                    </span>
                                    <input
                                        type="number"
                                        min="0"
                                        value={withholding}
                                        onChange={(e) => setWithholding(e.target.value)}
                                        className={`${INPUT} w-32 text-right`}
                                    />
                                </div>
                                <div className="flex justify-between border-t border-[#C8CDC9] pt-2 text-sm">
                                    <span className="font-bold text-[#2E4040]">Total a pagar</span>
                                    <span className={`font-bold ${total < 0 ? 'text-red-600' : 'text-[#3F8346]'}`}>
                                        {formatCOP(total)}
                                    </span>
                                </div>
                            </div>
                        </div>

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
                                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />}
                                Registrar factura
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
