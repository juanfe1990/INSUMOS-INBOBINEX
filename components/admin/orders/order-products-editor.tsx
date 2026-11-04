'use client';

import { AlertCircle, CheckCircle2, PackagePlus, Trash2 } from 'lucide-react';
import type {
    CoreMaterial,
    CoreSpecification,
    InventoryCategory,
    InventoryItem,
    OrderProductKind,
    RawMaterial,
} from '@/lib/types';

export type ProductLine = {
    key: number;
    kind: OrderProductKind;
    ref_id: string;
    quantity: string;
    unit_price: string;
};

export type InventoryCatalog = {
    items: InventoryItem[];
    categories: InventoryCategory[];
    rawMaterials: RawMaterial[];
    cores: CoreSpecification[];
    coreMaterials: CoreMaterial[];
};

type Source = { name: string; unit: string; stock: number; defaultPrice: number | null; integer: boolean };

export const KIND_LABELS: Record<OrderProductKind, string> = {
    insumo: 'Insumo (cintas, cartón...)',
    bobina: 'Bobina madre (kg)',
    core: 'Cores armados (und)',
    material_core: 'Material de cores (kg)',
};

const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fmtCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');
const INPUT =
    'w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';

export function getSource(catalog: InventoryCatalog, kind: OrderProductKind, id: string): Source | null {
    if (!id) return null;
    if (kind === 'insumo') {
        const i = catalog.items.find((x) => x.id === id);
        return i
            ? {
                  name: i.name,
                  unit: i.unit,
                  stock: Number(i.current_stock),
                  defaultPrice: i.sale_price == null ? null : Number(i.sale_price),
                  integer: false,
              }
            : null;
    }
    if (kind === 'bobina') {
        const r = catalog.rawMaterials.find((x) => x.id === id);
        return r ? { name: r.name, unit: 'kg', stock: Number(r.current_stock_kg), defaultPrice: null, integer: false } : null;
    }
    if (kind === 'core') {
        const c = catalog.cores.find((x) => x.id === id);
        return c ? { name: c.name, unit: 'und', stock: Number(c.current_stock_units), defaultPrice: null, integer: true } : null;
    }
    const m = catalog.coreMaterials.find((x) => x.id === id);
    return m ? { name: m.name, unit: 'kg', stock: Number(m.current_stock_kg), defaultPrice: null, integer: false } : null;
}

export type LineCheck = { error: string | null; available: number; required: number; subtotal: number };

/**
 * Valida cada línea contra el stock, sumando todas las líneas de la misma referencia
 * y lo que ya consume el stretch del pedido (`reserved`, clave `${kind}:${id}`).
 */
export function analyzeLines(
    lines: ProductLine[],
    catalog: InventoryCatalog,
    reserved: Record<string, number>
): { checks: Record<number, LineCheck>; total: number; firstError: string | null } {
    const totals: Record<string, number> = {};
    for (const l of lines) {
        const k = `${l.kind}:${l.ref_id}`;
        totals[k] = (totals[k] || 0) + (Number(l.quantity) || 0);
    }
    const checks: Record<number, LineCheck> = {};
    let total = 0;
    let firstError: string | null = null;
    for (const l of lines) {
        const src = getSource(catalog, l.kind, l.ref_id);
        const qty = Number(l.quantity) || 0;
        const subtotal = qty * (Number(l.unit_price) || 0);
        total += subtotal;
        const k = `${l.kind}:${l.ref_id}`;
        const required = (totals[k] || 0) + (reserved[k] || 0);
        let error: string | null = null;
        if (!src) error = 'Selecciona el producto';
        else if (!(qty > 0)) error = 'Cantidad mayor a 0';
        else if (src.integer && !Number.isInteger(qty)) error = 'Debe ser una cantidad entera';
        else if (required > src.stock) error = `Stock insuficiente: hay ${fmt(src.stock)} ${src.unit}`;
        else if (l.unit_price === '' || Number(l.unit_price) < 0) error = 'Indica el precio';
        checks[l.key] = { error, available: src?.stock ?? 0, required, subtotal };
        if (error && !firstError) firstError = `${src?.name || 'Producto'}: ${error}`;
    }
    return { checks, total, firstError };
}

let lineSeq = 1;
export function newProductLine(catalog: InventoryCatalog, kind: OrderProductKind = 'insumo'): ProductLine {
    const first =
        kind === 'insumo'
            ? catalog.items.find((i) => i.is_active && Number(i.current_stock) > 0)?.id
            : kind === 'bobina'
              ? catalog.rawMaterials.find((r) => Number(r.current_stock_kg) > 0)?.id
              : kind === 'core'
                ? catalog.cores.find((c) => Number(c.current_stock_units) > 0)?.id
                : catalog.coreMaterials.find((m) => Number(m.current_stock_kg) > 0)?.id;
    const src = first ? getSource(catalog, kind, first) : null;
    return {
        key: lineSeq++,
        kind,
        ref_id: first || '',
        quantity: '',
        unit_price: src?.defaultPrice != null ? String(src.defaultPrice) : '',
    };
}

type Props = {
    lines: ProductLine[];
    onChange: (lines: ProductLine[]) => void;
    catalog: InventoryCatalog;
    checks: Record<number, LineCheck>;
    total: number;
};

export default function OrderProductsEditor({ lines, onChange, catalog, checks, total }: Props) {
    const update = (key: number, patch: Partial<ProductLine>) =>
        onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

    const changeKind = (key: number, kind: OrderProductKind) =>
        onChange(lines.map((l) => (l.key === key ? { ...newProductLine(catalog, kind), key } : l)));

    const changeRef = (l: ProductLine, id: string) => {
        const src = getSource(catalog, l.kind, id);
        update(l.key, {
            ref_id: id,
            unit_price: src?.defaultPrice != null ? String(src.defaultPrice) : l.unit_price,
        });
    };

    const activeItems = catalog.items.filter((i) => i.is_active);
    const uncategorized = activeItems.filter((i) => !i.category_id);

    const renderOptions = (l: ProductLine) => {
        const opt = (id: string, label: string, stock: number, unit: string) => (
            <option key={id} value={id} disabled={stock <= 0 && id !== l.ref_id}>
                {label} — {fmt(stock)} {unit}
                {stock <= 0 ? ' (agotado)' : ''}
            </option>
        );
        if (l.kind === 'insumo') {
            return (
                <>
                    {catalog.categories.map((c) => {
                        const its = activeItems.filter((i) => i.category_id === c.id);
                        if (its.length === 0) return null;
                        return (
                            <optgroup key={c.id} label={c.name}>
                                {its.map((i) => opt(i.id, i.name, Number(i.current_stock), i.unit))}
                            </optgroup>
                        );
                    })}
                    {uncategorized.length > 0 && (
                        <optgroup label="Sin categoría">
                            {uncategorized.map((i) => opt(i.id, i.name, Number(i.current_stock), i.unit))}
                        </optgroup>
                    )}
                </>
            );
        }
        if (l.kind === 'bobina')
            return catalog.rawMaterials.map((r) =>
                opt(r.id, `${r.name} · ${Number(r.width_cm)} cm · ${Number(r.caliber_microns)} µ`, Number(r.current_stock_kg), 'kg')
            );
        if (l.kind === 'core')
            return catalog.cores.map((c) => opt(c.id, `${c.name} (${Number(c.length_cm)} cm)`, Number(c.current_stock_units), 'und'));
        return catalog.coreMaterials.map((m) => opt(m.id, m.name, Number(m.current_stock_kg), 'kg'));
    };

    return (
        <div className="space-y-3 rounded-lg border border-[#C8CDC9] bg-slate-50/50 p-3.5">
            <div className="flex items-center justify-between border-b border-[#C8CDC9]/60 pb-2">
                <div>
                    <label className="text-xs font-bold text-[#2E4040]">Productos de inventario (salen de bodega)</label>
                    <p className="text-[11px] text-[#949E97]">
                        Cintas, cartón, bobina madre, cores o material de cores. Se descuentan al quedar listo para despacho.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => onChange([...lines, newProductLine(catalog)])}
                    className="flex items-center gap-1 whitespace-nowrap rounded border border-[#3F8346] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#3F8346] hover:bg-[#3F8346]/10"
                >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Agregar producto
                </button>
            </div>

            {lines.length === 0 ? (
                <p className="py-1 text-center text-[11px] text-[#949E97]">Sin productos adicionales.</p>
            ) : (
                <div className="space-y-2">
                    {lines.map((l) => {
                        const src = getSource(catalog, l.kind, l.ref_id);
                        const check = checks[l.key];
                        return (
                            <div
                                key={l.key}
                                className={`rounded-lg border bg-white p-2.5 shadow-sm ${
                                    check?.error ? 'border-red-300' : 'border-[#C8CDC9]'
                                }`}
                            >
                                <div className="grid grid-cols-12 items-end gap-2">
                                    <div className="col-span-12 sm:col-span-3">
                                        <label className={LABEL}>Tipo</label>
                                        <select
                                            value={l.kind}
                                            onChange={(e) => changeKind(l.key, e.target.value as OrderProductKind)}
                                            className={`${INPUT} bg-white`}
                                        >
                                            {(Object.keys(KIND_LABELS) as OrderProductKind[]).map((k) => (
                                                <option key={k} value={k}>
                                                    {KIND_LABELS[k]}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="col-span-12 sm:col-span-4">
                                        <label className={LABEL}>Producto *</label>
                                        <select
                                            value={l.ref_id}
                                            onChange={(e) => changeRef(l, e.target.value)}
                                            className={`${INPUT} bg-white font-semibold`}
                                        >
                                            <option value="" disabled>
                                                Seleccionar...
                                            </option>
                                            {renderOptions(l)}
                                        </select>
                                    </div>
                                    <div className="col-span-4 sm:col-span-2">
                                        <label className={LABEL}>Cantidad ({src?.unit || 'und'}) *</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step={src?.integer ? '1' : 'any'}
                                            value={l.quantity}
                                            onChange={(e) => update(l.key, { quantity: e.target.value })}
                                            className={INPUT}
                                        />
                                    </div>
                                    <div className="col-span-5 sm:col-span-2">
                                        <label className={LABEL}>Precio / {src?.unit || 'und'} ($) *</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={l.unit_price}
                                            onChange={(e) => update(l.key, { unit_price: e.target.value })}
                                            className={INPUT}
                                        />
                                    </div>
                                    <div className="col-span-3 flex justify-end pb-1 sm:col-span-1">
                                        <button
                                            type="button"
                                            onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                                            className="rounded p-1 text-red-500 hover:bg-red-50"
                                            title="Quitar producto"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                                {src && (
                                    <div
                                        className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${
                                            check?.error ? 'font-semibold text-red-700' : 'text-[#3F8346]'
                                        }`}
                                    >
                                        {check?.error ? (
                                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                        ) : (
                                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                        )}
                                        <span>
                                            {check?.error ||
                                                `Disponible ${fmt(src.stock)} ${src.unit}${
                                                    check && check.required > (Number(l.quantity) || 0)
                                                        ? ` · el pedido usa ${fmt(check.required)} en total`
                                                        : ''
                                                }`}
                                        </span>
                                        <span className="ml-auto font-semibold text-[#2E4040]">
                                            {fmtCOP(check?.subtotal || 0)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <div className="text-right text-xs text-[#2E4040]">
                        Subtotal productos: <b>{fmtCOP(total)}</b>
                    </div>
                </div>
            )}
        </div>
    );
}
