'use client';

import { useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowDownRight,
    CheckCircle2,
    Loader2,
    Package,
    Pencil,
    Plus,
    Search,
    SlidersHorizontal,
    Tags,
    Trash2,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/admin/confirm-dialog';
import type { InventoryCategory, InventoryItem } from '@/lib/types';

const INPUT =
    'w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';

/** Unidades sugeridas (el campo acepta cualquier otra) */
const UNIT_SUGGESTIONS = ['und', 'rollo', 'caja', 'paquete', 'lámina', 'pliego', 'kg', 'metro', 'resma', 'bulto'];

const EXIT_TYPES = [
    { value: 'salida_venta', label: 'Venta / despacho a cliente' },
    { value: 'consumo_interno', label: 'Consumo interno (planta / embalaje)' },
    { value: 'merma_desperdicio', label: 'Merma / daño' },
] as const;

type ExitType = (typeof EXIT_TYPES)[number]['value'];

const fmtQty = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fmtCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

const ALL = '__all__';
const NONE = '__none__';

type ProductForm = {
    id: string | null;
    name: string;
    category_id: string;
    sku: string;
    unit: string;
    min_stock_alert: string;
    sale_price: string;
    notes: string;
    is_active: boolean;
    /** Solo al crear: inventario inicial */
    initial_stock: string;
    initial_cost: string;
};

const emptyForm = (categoryId: string): ProductForm => ({
    id: null,
    name: '',
    category_id: categoryId,
    sku: '',
    unit: 'und',
    min_stock_alert: '0',
    sale_price: '',
    notes: '',
    is_active: true,
    initial_stock: '',
    initial_cost: '',
});

type Props = {
    categories: InventoryCategory[];
    items: InventoryItem[];
    loading: boolean;
    isAdmin: boolean;
    onChanged: () => void;
};

export default function GeneralInventory({ categories, items, loading, isAdmin, onChanged }: Props) {
    const supabase = createClient();
    const [confirmDialog, confirm] = useConfirm();

    const [selectedCat, setSelectedCat] = useState<string>(ALL);
    const [search, setSearch] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState<ProductForm | null>(null);
    const [exitItem, setExitItem] = useState<InventoryItem | null>(null);
    const [exitType, setExitType] = useState<ExitType>('salida_venta');
    const [exitQty, setExitQty] = useState('');
    const [exitNotes, setExitNotes] = useState('');
    const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
    const [adjustQty, setAdjustQty] = useState('');
    const [adjustCost, setAdjustCost] = useState('');
    const [adjustNotes, setAdjustNotes] = useState('');
    const [showCategories, setShowCategories] = useState(false);
    const [newCatName, setNewCatName] = useState('');
    const [editingCat, setEditingCat] = useState<{ id: string; name: string } | null>(null);

    const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
    const isLow = (i: InventoryItem) => Number(i.current_stock) <= Number(i.min_stock_alert || 0);

    const visibleItems = useMemo(() => items.filter((i) => showInactive || i.is_active), [items, showInactive]);

    const countsByCat = useMemo(() => {
        const m = new Map<string, { count: number; low: number }>();
        for (const i of visibleItems) {
            const key = i.category_id || NONE;
            const cur = m.get(key) || { count: 0, low: 0 };
            cur.count += 1;
            if (i.is_active && isLow(i)) cur.low += 1;
            m.set(key, cur);
        }
        return m;
    }, [visibleItems]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return visibleItems
            .filter((i) =>
                selectedCat === ALL ? true : selectedCat === NONE ? !i.category_id : i.category_id === selectedCat
            )
            .filter(
                (i) =>
                    !q ||
                    i.name.toLowerCase().includes(q) ||
                    (i.sku || '').toLowerCase().includes(q) ||
                    (catName.get(i.category_id || '') || '').toLowerCase().includes(q)
            )
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    }, [visibleItems, selectedCat, search, catName]);

    const summary = useMemo(
        () => ({
            value: filtered.reduce((acc, i) => acc + Number(i.current_stock) * Number(i.avg_cost), 0),
            low: filtered.filter((i) => i.is_active && isLow(i)).length,
        }),
        [filtered]
    );

    // ---------------- Productos ----------------
    const openCreate = () =>
        setForm(emptyForm(selectedCat !== ALL && selectedCat !== NONE ? selectedCat : categories[0]?.id || ''));

    const openEdit = (i: InventoryItem) =>
        setForm({
            id: i.id,
            name: i.name,
            category_id: i.category_id || '',
            sku: i.sku || '',
            unit: i.unit,
            min_stock_alert: String(Number(i.min_stock_alert || 0)),
            sale_price: i.sale_price == null ? '' : String(Number(i.sale_price)),
            notes: i.notes || '',
            is_active: i.is_active,
            initial_stock: '',
            initial_cost: '',
        });

    const handleSaveProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form) return;
        if (!form.name.trim()) return toast.error('Ingresa el nombre del producto');
        if (!form.unit.trim()) return toast.error('Indica la unidad de medida');
        const initialStock = Number(form.initial_stock || 0);
        const initialCost = Number(form.initial_cost || 0);
        if (initialStock < 0 || initialCost < 0) return toast.error('El inventario inicial no puede ser negativo');

        const payload = {
            name: form.name.trim(),
            category_id: form.category_id || null,
            sku: form.sku.trim() || null,
            unit: form.unit.trim(),
            min_stock_alert: Number(form.min_stock_alert || 0),
            sale_price: form.sale_price === '' ? null : Number(form.sale_price),
            notes: form.notes.trim() || null,
            is_active: form.is_active,
            updated_at: new Date().toISOString(),
        };

        try {
            setSaving(true);
            if (form.id) {
                const { data, error } = await supabase.from('inventory_items').update(payload).eq('id', form.id).select('id');
                if (error) throw error;
                if (!data?.length) throw new Error('Solo un administrador puede editar productos');
                toast.success('Producto actualizado');
            } else {
                const { data, error } = await supabase.from('inventory_items').insert(payload).select('id').single();
                if (error) throw error;
                if (initialStock > 0) {
                    const { error: adjErr } = await supabase.rpc('adjust_inventory_item_stock', {
                        p_item_id: data.id,
                        p_new_stock: initialStock,
                        p_unit_cost: initialCost,
                        p_notes: 'Inventario inicial',
                    });
                    if (adjErr) throw adjErr;
                }
                toast.success(
                    `Producto creado${initialStock > 0 ? ` con ${fmtQty(initialStock)} ${payload.unit} iniciales` : ''}`
                );
            }
            setForm(null);
            onChanged();
        } catch (err: any) {
            const msg = err?.code === '23505' ? 'Ya existe un producto con ese código / SKU' : err?.message || 'Error';
            toast.error('No se pudo guardar: ' + msg);
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteProduct = async (i: InventoryItem) => {
        const ok = await confirm({
            title: `¿Eliminar "${i.name}"?`,
            description: (
                <>
                    Tiene <b>{fmtQty(Number(i.current_stock))} {i.unit}</b> en stock. El Kardex y las facturas conservan
                    el historial. Si solo dejó de manejarse, mejor desactívalo desde &quot;Editar&quot;.
                </>
            ),
            confirmLabel: 'Eliminar producto',
        });
        if (!ok) return;
        try {
            setSaving(true);
            const { data, error } = await supabase.from('inventory_items').delete().eq('id', i.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Solo un administrador puede eliminar productos');
            toast.success('Producto eliminado');
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo eliminar: ' + (err?.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // ---------------- Salidas ----------------
    const handleExit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!exitItem) return;
        const qty = Number(exitQty);
        if (!(qty > 0)) return toast.error('Ingresa una cantidad mayor a 0');
        if (qty > Number(exitItem.current_stock)) return toast.error('La cantidad supera el stock disponible');
        try {
            setSaving(true);
            const { error } = await supabase.rpc('register_inventory_exit', {
                p_item_id: exitItem.id,
                p_movement: exitType,
                p_quantity: qty,
                ...(exitNotes.trim() ? { p_notes: exitNotes.trim() } : {}),
            });
            if (error) throw error;
            toast.success(`Salida de ${fmtQty(qty)} ${exitItem.unit} de ${exitItem.name} registrada`);
            setExitItem(null);
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo registrar la salida: ' + (err?.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // ---------------- Ajuste por conteo ----------------
    const handleAdjust = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adjustItem) return;
        const qty = Number(adjustQty);
        if (adjustQty.trim() === '' || !(qty >= 0)) return toast.error('Ingresa la cantidad contada (0 o más)');
        const goesUp = qty > Number(adjustItem.current_stock);
        try {
            setSaving(true);
            const { error } = await supabase.rpc('adjust_inventory_item_stock', {
                p_item_id: adjustItem.id,
                p_new_stock: qty,
                ...(goesUp && adjustCost !== '' ? { p_unit_cost: Number(adjustCost) } : {}),
                ...(adjustNotes.trim() ? { p_notes: adjustNotes.trim() } : {}),
            });
            if (error) throw error;
            toast.success(`${adjustItem.name}: stock ajustado a ${fmtQty(qty)} ${adjustItem.unit}`);
            setAdjustItem(null);
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo ajustar: ' + (err?.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // ---------------- Categorías ----------------
    const handleAddCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newCatName.trim();
        if (!name) return;
        try {
            setSaving(true);
            const nextOrder = Math.max(0, ...categories.filter((c) => c.display_order < 99).map((c) => c.display_order)) + 1;
            const { error } = await supabase.from('inventory_categories').insert({ name, display_order: nextOrder });
            if (error) throw error;
            setNewCatName('');
            toast.success(`Categoría "${name}" creada`);
            onChanged();
        } catch (err: any) {
            toast.error(err?.code === '23505' ? 'Ya existe esa categoría' : 'Error: ' + (err?.message || ''));
        } finally {
            setSaving(false);
        }
    };

    const handleRenameCategory = async () => {
        if (!editingCat || !editingCat.name.trim()) return;
        try {
            setSaving(true);
            const { data, error } = await supabase
                .from('inventory_categories')
                .update({ name: editingCat.name.trim() })
                .eq('id', editingCat.id)
                .select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Solo un administrador puede editar categorías');
            setEditingCat(null);
            onChanged();
        } catch (err: any) {
            toast.error(err?.code === '23505' ? 'Ya existe esa categoría' : 'Error: ' + (err?.message || ''));
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteCategory = async (c: InventoryCategory) => {
        const n = items.filter((i) => i.category_id === c.id).length;
        const ok = await confirm({
            title: `¿Eliminar la categoría "${c.name}"?`,
            description:
                n > 0
                    ? `Sus ${n} producto(s) no se borran: quedan como "Sin categoría".`
                    : 'La categoría no tiene productos.',
            confirmLabel: 'Eliminar categoría',
        });
        if (!ok) return;
        try {
            setSaving(true);
            const { data, error } = await supabase.from('inventory_categories').delete().eq('id', c.id).select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Solo un administrador puede eliminar categorías');
            if (selectedCat === c.id) setSelectedCat(ALL);
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo eliminar: ' + (err?.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    const chip = (key: string, label: string) => {
        const info = key === ALL ? { count: visibleItems.length, low: 0 } : countsByCat.get(key) || { count: 0, low: 0 };
        const lowTotal =
            key === ALL ? visibleItems.filter((i) => i.is_active && isLow(i)).length : info.low;
        const active = selectedCat === key;
        return (
            <button
                key={key}
                onClick={() => setSelectedCat(key)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                        ? 'border-[#2E4040] bg-[#2E4040] text-white'
                        : 'border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
                }`}
            >
                {label}
                <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-white/20' : 'bg-[#C8CDC9]/40'}`}>
                    {info.count}
                </span>
                {lowTotal > 0 && (
                    <span className="h-2 w-2 rounded-full bg-amber-500" title={`${lowTotal} con stock bajo`} />
                )}
            </button>
        );
    };

    const exitAfter = exitItem ? Number(exitItem.current_stock) - (Number(exitQty) || 0) : 0;
    const adjustDiff = adjustItem && adjustQty.trim() !== '' ? Number(adjustQty) - Number(adjustItem.current_stock) : 0;

    return (
        <div className="space-y-4">
            {confirmDialog}

            {/* Categorías */}
            <div className="flex flex-wrap items-center gap-2">
                {chip(ALL, 'Todos')}
                {categories.map((c) => chip(c.id, c.name))}
                {countsByCat.has(NONE) && chip(NONE, 'Sin categoría')}
                {isAdmin && (
                    <button
                        onClick={() => setShowCategories(true)}
                        className="flex items-center gap-1 rounded-full border border-dashed border-[#949E97] px-3 py-1 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        <Tags className="h-3.5 w-3.5" />
                        Gestionar categorías
                    </button>
                )}
            </div>

            {/* Barra de herramientas */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-3">
                    <div className="relative max-w-sm flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar producto, código o categoría..."
                            className="w-full rounded-lg border border-[#C8CDC9] bg-white py-2 pl-9 pr-3 text-xs focus:border-[#3F8346] focus:outline-none"
                        />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-[#949E97]">
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                            className="accent-[#3F8346]"
                        />
                        Ver inactivos
                    </label>
                </div>
                <div className="flex items-center gap-3">
                    <div className="text-right text-[11px] text-[#949E97]">
                        {filtered.length} producto(s) · Valor{' '}
                        <b className="text-[#3F8346]">{fmtCOP(summary.value)}</b>
                        {summary.low > 0 && <span className="ml-1 font-semibold text-amber-700">· {summary.low} bajos</span>}
                    </div>
                    {isAdmin && (
                        <button
                            onClick={openCreate}
                            className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332]"
                        >
                            <Plus className="h-4 w-4" />
                            Nuevo producto
                        </button>
                    )}
                </div>
            </div>

            {/* Tabla */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                    <Package className="mx-auto h-12 w-12 text-[#949E97]" />
                    <h3 className="mt-3 text-base font-semibold text-[#2E4040]">
                        {items.length === 0 ? 'Aún no hay productos en este inventario' : 'Sin resultados'}
                    </h3>
                    <p className="mt-1 text-xs text-[#949E97]">
                        Crea cintas, cartón industrial, papel burbuja y demás con &quot;Nuevo producto&quot;. Las compras
                        entran con factura de proveedor (línea &quot;Insumo / producto&quot;).
                    </p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Producto</th>
                                {selectedCat === ALL && <th className="px-4 py-3 font-semibold">Categoría</th>}
                                <th className="px-4 py-3 font-semibold">Stock</th>
                                <th className="px-4 py-3 font-semibold">Costo prom.</th>
                                <th className="px-4 py-3 font-semibold">Precio venta</th>
                                <th className="px-4 py-3 font-semibold">Valor</th>
                                <th className="px-4 py-3 text-right font-semibold">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C8CDC9]/40">
                            {filtered.map((i) => {
                                const stock = Number(i.current_stock);
                                const low = isLow(i);
                                const critical = stock <= 0;
                                const margin =
                                    i.sale_price != null && Number(i.sale_price) > 0 && Number(i.avg_cost) > 0
                                        ? ((Number(i.sale_price) - Number(i.avg_cost)) / Number(i.sale_price)) * 100
                                        : null;
                                return (
                                    <tr key={i.id} className={`hover:bg-[#F9FBFA] ${!i.is_active ? 'opacity-50' : ''}`}>
                                        <td className="px-4 py-3">
                                            <div className="text-sm font-semibold text-[#2E4040]">{i.name}</div>
                                            <div className="text-[11px] text-[#949E97]">
                                                {i.sku ? `Cód. ${i.sku} · ` : ''}por {i.unit}
                                                {!i.is_active && ' · inactivo'}
                                            </div>
                                        </td>
                                        {selectedCat === ALL && (
                                            <td className="px-4 py-3 text-[#2E4040]">
                                                {catName.get(i.category_id || '') || (
                                                    <span className="text-[#949E97]">Sin categoría</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="px-4 py-3">
                                            <div className="text-sm font-bold text-[#2E4040]">
                                                {fmtQty(stock)} <span className="text-xs font-normal text-gray-500">{i.unit}</span>
                                            </div>
                                            {critical ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                                    <AlertTriangle className="h-3 w-3" /> Agotado
                                                </span>
                                            ) : low ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                                    <AlertTriangle className="h-3 w-3" /> Bajo (mín. {fmtQty(Number(i.min_stock_alert))})
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                                    <CheckCircle2 className="h-3 w-3" /> OK
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">{fmtCOP(Number(i.avg_cost))}</td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {i.sale_price == null ? (
                                                '—'
                                            ) : (
                                                <>
                                                    {fmtCOP(Number(i.sale_price))}
                                                    {margin !== null && (
                                                        <div
                                                            className={`text-[10px] ${margin < 0 ? 'text-red-600' : 'text-[#949E97]'}`}
                                                        >
                                                            Margen {margin.toFixed(0)}%
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-[#3F8346]">
                                            {fmtCOP(stock * Number(i.avg_cost))}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-1.5">
                                                <button
                                                    onClick={() => {
                                                        setExitItem(i);
                                                        setExitType('salida_venta');
                                                        setExitQty('');
                                                        setExitNotes('');
                                                    }}
                                                    disabled={stock <= 0}
                                                    className="inline-flex items-center gap-1 rounded-md bg-[#2E4040] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#1f2d2d] disabled:opacity-40"
                                                    title="Registrar venta, consumo o merma"
                                                >
                                                    <ArrowDownRight className="h-3.5 w-3.5" />
                                                    Salida
                                                </button>
                                                {isAdmin && (
                                                    <>
                                                        <button
                                                            onClick={() => {
                                                                setAdjustItem(i);
                                                                setAdjustQty(String(stock));
                                                                setAdjustCost(String(Number(i.avg_cost) || ''));
                                                                setAdjustNotes('');
                                                            }}
                                                            className="rounded-md border border-[#C8CDC9] bg-white p-1.5 text-gray-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
                                                            title="Ajustar por conteo físico"
                                                        >
                                                            <SlidersHorizontal className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => openEdit(i)}
                                                            className="rounded-md border border-[#C8CDC9] bg-white p-1.5 text-gray-600 hover:bg-[#C8CDC9]/20"
                                                            title="Editar"
                                                        >
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteProduct(i)}
                                                            disabled={saving}
                                                            className="rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 disabled:opacity-40"
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ============ MODAL: CREAR / EDITAR PRODUCTO ============ */}
            {form && (
                <Modal title={form.id ? 'Editar producto' : 'Nuevo producto de inventario'} onClose={() => setForm(null)}>
                    <form onSubmit={handleSaveProduct} className="space-y-3">
                        <div>
                            <label className={LABEL}>Nombre *</label>
                            <input
                                required
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Ej: Cinta transparente 48 mm x 100 m"
                                className={INPUT}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={LABEL}>Categoría</label>
                                <select
                                    value={form.category_id}
                                    onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                                    className={`${INPUT} bg-white`}
                                >
                                    <option value="">Sin categoría</option>
                                    {categories.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className={LABEL}>Unidad de medida *</label>
                                <input
                                    required
                                    list="inventory-units"
                                    value={form.unit}
                                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                                    className={INPUT}
                                />
                                <datalist id="inventory-units">
                                    {UNIT_SUGGESTIONS.map((u) => (
                                        <option key={u} value={u} />
                                    ))}
                                </datalist>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className={LABEL}>Código / SKU</label>
                                <input
                                    value={form.sku}
                                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                                    placeholder="Opcional"
                                    className={INPUT}
                                />
                            </div>
                            <div>
                                <label className={LABEL}>Alerta mínimo ({form.unit || 'und'})</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={form.min_stock_alert}
                                    onChange={(e) => setForm({ ...form, min_stock_alert: e.target.value })}
                                    className={INPUT}
                                />
                            </div>
                            <div>
                                <label className={LABEL}>Precio venta ($)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={form.sale_price}
                                    onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
                                    placeholder="Opcional"
                                    className={INPUT}
                                />
                            </div>
                        </div>

                        {!form.id && (
                            <div className="rounded-lg border border-[#C8CDC9] bg-[#F8F9FA] p-3">
                                <div className="mb-2 text-[11px] font-semibold text-[#2E4040]">
                                    Inventario inicial (opcional)
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className={LABEL}>Cantidad en bodega ({form.unit || 'und'})</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={form.initial_stock}
                                            onChange={(e) => setForm({ ...form, initial_stock: e.target.value })}
                                            className={INPUT}
                                        />
                                    </div>
                                    <div>
                                        <label className={LABEL}>Costo por {form.unit || 'und'} ($)</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={form.initial_cost}
                                            onChange={(e) => setForm({ ...form, initial_cost: e.target.value })}
                                            className={INPUT}
                                        />
                                    </div>
                                </div>
                                <p className="mt-1.5 text-[10px] text-[#949E97]">
                                    Úsalo solo para cargar lo que ya existe. Las compras nuevas deben entrar por factura de
                                    proveedor.
                                </p>
                            </div>
                        )}

                        <div>
                            <label className={LABEL}>Notas</label>
                            <input
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                className={INPUT}
                            />
                        </div>
                        {form.id && (
                            <label className="flex items-center gap-2 text-xs text-[#2E4040]">
                                <input
                                    type="checkbox"
                                    checked={form.is_active}
                                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                                    className="accent-[#3F8346]"
                                />
                                Producto activo (los inactivos se ocultan de la lista y de las facturas)
                            </label>
                        )}
                        <ModalActions saving={saving} onCancel={() => setForm(null)} label={form.id ? 'Guardar' : 'Crear producto'} />
                    </form>
                </Modal>
            )}

            {/* ============ MODAL: SALIDA ============ */}
            {exitItem && (
                <Modal title={`Salida: ${exitItem.name}`} onClose={() => setExitItem(null)}>
                    <form onSubmit={handleExit} className="space-y-3">
                        <div className="text-xs text-[#949E97]">
                            Disponible: <b className="text-[#2E4040]">{fmtQty(Number(exitItem.current_stock))} {exitItem.unit}</b>
                        </div>
                        <div className="space-y-1.5">
                            {EXIT_TYPES.map((t) => (
                                <label key={t.value} className="flex items-center gap-2 text-xs text-[#2E4040]">
                                    <input
                                        type="radio"
                                        name="exit-type"
                                        checked={exitType === t.value}
                                        onChange={() => setExitType(t.value)}
                                        className="accent-[#3F8346]"
                                    />
                                    {t.label}
                                </label>
                            ))}
                        </div>
                        <div>
                            <label className={LABEL}>Cantidad ({exitItem.unit}) *</label>
                            <input
                                type="number"
                                required
                                min="0"
                                step="any"
                                value={exitQty}
                                onChange={(e) => setExitQty(e.target.value)}
                                className={`${INPUT} text-sm font-bold`}
                            />
                            {exitQty !== '' && (
                                <p className={`mt-1 text-[11px] ${exitAfter < 0 ? 'font-semibold text-red-600' : 'text-[#949E97]'}`}>
                                    {exitAfter < 0
                                        ? 'La cantidad supera el stock disponible'
                                        : `Quedarán ${fmtQty(exitAfter)} ${exitItem.unit} · costo ${fmtCOP((Number(exitQty) || 0) * Number(exitItem.avg_cost))}`}
                                </p>
                            )}
                        </div>
                        <div>
                            <label className={LABEL}>Cliente / motivo / notas</label>
                            <input
                                value={exitNotes}
                                onChange={(e) => setExitNotes(e.target.value)}
                                placeholder="Ej: Remisión 1023 - Cliente XYZ"
                                className={INPUT}
                            />
                        </div>
                        <ModalActions saving={saving} disabled={exitAfter < 0} onCancel={() => setExitItem(null)} label="Registrar salida" />
                    </form>
                </Modal>
            )}

            {/* ============ MODAL: AJUSTE POR CONTEO ============ */}
            {adjustItem && (
                <Modal title={`Ajustar conteo: ${adjustItem.name}`} onClose={() => setAdjustItem(null)}>
                    <form onSubmit={handleAdjust} className="space-y-3">
                        <div className="text-xs text-[#949E97]">
                            Stock en sistema:{' '}
                            <b className="text-[#2E4040]">
                                {fmtQty(Number(adjustItem.current_stock))} {adjustItem.unit}
                            </b>
                        </div>
                        <div>
                            <label className={LABEL}>Cantidad real contada ({adjustItem.unit}) *</label>
                            <input
                                type="number"
                                required
                                min="0"
                                step="any"
                                value={adjustQty}
                                onChange={(e) => setAdjustQty(e.target.value)}
                                className={`${INPUT} text-sm font-bold`}
                            />
                            {adjustDiff !== 0 && (
                                <p className="mt-1 text-[11px] text-[#949E97]">
                                    Diferencia: <b>{adjustDiff > 0 ? '+' : ''}{fmtQty(adjustDiff)} {adjustItem.unit}</b> (queda en
                                    el Kardex como ajuste manual)
                                </p>
                            )}
                        </div>
                        {adjustDiff > 0 && (
                            <div>
                                <label className={LABEL}>Costo por {adjustItem.unit} de lo que entra ($)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={adjustCost}
                                    onChange={(e) => setAdjustCost(e.target.value)}
                                    className={INPUT}
                                />
                                <p className="mt-1 text-[10px] text-[#949E97]">Se promedia con el costo actual.</p>
                            </div>
                        )}
                        <div>
                            <label className={LABEL}>Motivo</label>
                            <input
                                value={adjustNotes}
                                onChange={(e) => setAdjustNotes(e.target.value)}
                                placeholder="Ej: Conteo mensual"
                                className={INPUT}
                            />
                        </div>
                        <ModalActions saving={saving} onCancel={() => setAdjustItem(null)} label="Guardar ajuste" />
                    </form>
                </Modal>
            )}

            {/* ============ MODAL: CATEGORÍAS ============ */}
            {showCategories && (
                <Modal title="Categorías de inventario" onClose={() => setShowCategories(false)}>
                    <div className="space-y-3">
                        <ul className="divide-y divide-[#C8CDC9]/50 rounded-lg border border-[#C8CDC9]">
                            {categories.length === 0 && (
                                <li className="p-3 text-center text-xs text-[#949E97]">Sin categorías</li>
                            )}
                            {categories.map((c) => {
                                const n = items.filter((i) => i.category_id === c.id).length;
                                const editing = editingCat?.id === c.id;
                                return (
                                    <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                                        {editing ? (
                                            <input
                                                autoFocus
                                                value={editingCat.name}
                                                onChange={(e) => setEditingCat({ id: c.id, name: e.target.value })}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        handleRenameCategory();
                                                    }
                                                    if (e.key === 'Escape') setEditingCat(null);
                                                }}
                                                className={INPUT}
                                            />
                                        ) : (
                                            <span className="flex-1 text-xs font-semibold text-[#2E4040]">
                                                {c.name} <span className="font-normal text-[#949E97]">({n})</span>
                                            </span>
                                        )}
                                        {editing ? (
                                            <button
                                                onClick={handleRenameCategory}
                                                disabled={saving}
                                                className="rounded bg-[#3F8346] px-2 py-1 text-[11px] font-semibold text-white"
                                            >
                                                Guardar
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => setEditingCat({ id: c.id, name: c.name })}
                                                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                                                title="Renombrar"
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDeleteCategory(c)}
                                            disabled={saving}
                                            className="rounded p-1 text-red-500 hover:bg-red-50"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        <form onSubmit={handleAddCategory} className="flex gap-2">
                            <input
                                value={newCatName}
                                onChange={(e) => setNewCatName(e.target.value)}
                                placeholder="Nueva categoría (ej: Esquineros)"
                                className={INPUT}
                            />
                            <button
                                type="submit"
                                disabled={saving || !newCatName.trim()}
                                className="flex items-center gap-1 whitespace-nowrap rounded bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                                <Plus className="h-3.5 w-3.5" /> Agregar
                            </button>
                        </form>
                    </div>
                </Modal>
            )}
        </div>
    );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                    <h3 className="font-heading text-base font-bold text-[#2E4040]">{title}</h3>
                    <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}

function ModalActions({
    saving,
    disabled,
    onCancel,
    label,
}: {
    saving: boolean;
    disabled?: boolean;
    onCancel: () => void;
    label: string;
}) {
    return (
        <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
            <button
                type="button"
                onClick={onCancel}
                className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
                Cancelar
            </button>
            <button
                type="submit"
                disabled={saving || disabled}
                className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
            >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : label}
            </button>
        </div>
    );
}
