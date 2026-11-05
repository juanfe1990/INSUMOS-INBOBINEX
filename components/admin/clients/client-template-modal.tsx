'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Repeat, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Client, ClientOrderTemplate } from '@/lib/types';
import StretchLinesEditor from '@/components/admin/orders/stretch-lines-editor';
import OrderProductsEditor, {
    getSource,
    type InventoryCatalog,
    type LineCheck,
    type ProductLine,
} from '@/components/admin/orders/order-products-editor';
import { analyzeStretch, type StretchLine } from '@/lib/stretch-lines';
import { linesToTemplatePayload, templatesToLines } from '@/lib/client-templates';
import type { FilmCutWidth } from '@/lib/types';

const INPUT =
    'w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';
const fmtCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

/**
 * Pedido habitual de un cliente: lo que suele pedir (varias medidas de stretch + productos)
 * y cada cuántos días. Se carga solo al crear un pedido para ese cliente (web y app).
 * No valida stock: es una plantilla; el stock se valida al crear el pedido.
 */
export default function ClientTemplateModal({
    client,
    catalog,
    cuts,
    onClose,
    onSaved,
}: {
    client: Client;
    catalog: InventoryCatalog;
    cuts: FilmCutWidth[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [stretch, setStretch] = useState<StretchLine[]>([]);
    const [products, setProducts] = useState<ProductLine[]>([]);
    const [reorderDays, setReorderDays] = useState(client.reorder_days ? String(client.reorder_days) : '');

    useEffect(() => {
        supabase
            .from('client_order_templates')
            .select('*')
            .eq('client_id', client.id)
            .order('position')
            .then(({ data, error }) => {
                if (error) toast.error('No se pudo cargar el pedido habitual: ' + error.message);
                const { stretch: s, products: p } = templatesToLines((data || []) as ClientOrderTemplate[]);
                setStretch(s);
                setProducts(p);
                setLoading(false);
            });
    }, [supabase, client.id]);

    const stretchAnalysis = useMemo(
        () => analyzeStretch(stretch, catalog.rawMaterials, catalog.cores, cuts, false),
        [stretch, catalog, cuts]
    );

    // Productos: solo forma (producto elegido, cantidad > 0), sin exigir stock
    const productChecks = useMemo(() => {
        const checks: Record<number, LineCheck> = {};
        let total = 0;
        let firstError: string | null = null;
        for (const l of products) {
            const src = getSource(catalog, l.kind, l.ref_id);
            const qty = Number(l.quantity) || 0;
            const subtotal = qty * (Number(l.unit_price) || 0);
            const error = !src ? 'Selecciona el producto' : !(qty > 0) ? 'La cantidad debe ser mayor a 0' : l.unit_price === '' ? 'Indica el precio' : null;
            checks[l.key] = { error, available: src?.stock || 0, required: qty, subtotal };
            total += subtotal;
            if (error && !firstError) firstError = `${src?.name || 'Producto'}: ${error}`;
        }
        return { checks, total, firstError };
    }, [products, catalog]);

    const save = async () => {
        if (stretchAnalysis.firstError) return toast.error(stretchAnalysis.firstError);
        if (productChecks.firstError) return toast.error(productChecks.firstError);
        const days = reorderDays.trim() === '' ? null : Math.floor(Number(reorderDays));
        if (days !== null && !(days > 0)) return toast.error('La frecuencia debe ser un número de días mayor a 0');
        setSaving(true);
        const { error } = await supabase.rpc('replace_client_templates', {
            p_data: [{ client_id: client.id, reorder_days: days, lines: linesToTemplatePayload(stretch, products) }],
        });
        setSaving(false);
        if (error) return toast.error('No se pudo guardar: ' + error.message);
        toast.success(
            stretch.length + products.length === 0
                ? `Pedido habitual de ${client.business_name} vaciado`
                : `Pedido habitual de ${client.business_name} guardado (${stretch.length} medida(s), ${products.length} producto(s))`
        );
        onSaved();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                    <div>
                        <h3 className="flex items-center gap-1.5 font-heading text-base font-bold text-[#2E4040]">
                            <Repeat className="h-4 w-4 text-[#3F8346]" />
                            Pedido habitual · {client.business_name}
                        </h3>
                        <p className="text-[11px] text-[#949E97]">
                            Se carga automáticamente al crear un pedido para este cliente (web y app).
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="h-6 w-6 animate-spin text-[#3F8346]" />
                    </div>
                ) : (
                    <div className="space-y-4 overflow-y-auto px-6 py-5">
                        <div className="max-w-xs">
                            <label className={LABEL}>Pide cada (días)</label>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={reorderDays}
                                onChange={(e) => setReorderDays(e.target.value)}
                                placeholder="Ej: 15 (vacío = sin frecuencia)"
                                className={INPUT}
                            />
                            <p className="mt-0.5 text-[10px] text-[#949E97]">
                                Con la frecuencia, las estadísticas avisan cuándo debería volver a pedir.
                            </p>
                        </div>

                        <div className="space-y-2 rounded-lg border border-[#C8CDC9] bg-slate-50/50 p-3.5">
                            <p className="text-xs font-bold text-[#2E4040]">Rollos de stretch</p>
                            <StretchLinesEditor
                                lines={stretch}
                                onChange={setStretch}
                                checks={stretchAnalysis.checks}
                                raws={catalog.rawMaterials}
                                cores={catalog.cores}
                                coreMaterials={catalog.coreMaterials}
                                cuts={cuts}
                                templateMode
                                subtotal={stretchAnalysis.subtotal}
                                rolls={stretchAnalysis.rolls}
                                filmKg={stretchAnalysis.filmKg}
                            />
                        </div>

                        <OrderProductsEditor
                            lines={products}
                            onChange={setProducts}
                            catalog={catalog}
                            checks={productChecks.checks}
                            total={productChecks.total}
                        />
                    </div>
                )}

                <div className="flex items-center justify-between gap-3 border-t border-[#C8CDC9] px-6 py-3">
                    <span className="text-xs text-[#2E4040]">
                        Valor del pedido habitual (antes de IVA):{' '}
                        <b>{fmtCOP(stretchAnalysis.subtotal + productChecks.total)}</b>
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
                            type="button"
                            onClick={save}
                            disabled={saving || loading}
                            className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                        >
                            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            Guardar pedido habitual
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
