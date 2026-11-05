'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, FileUp, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Client, CoreMaterial, CoreSpecification, InventoryItem, RawMaterial } from '@/lib/types';
import { TEMPLATE_CSV_HELP, parseCSV, resolveTemplateImport, type ImportResult } from '@/lib/client-templates';

/**
 * Importación masiva del pedido habitual (CSV exportado desde aquí y editado en Excel).
 * Muestra una vista previa con errores por fila; al confirmar REEMPLAZA, en una sola
 * transacción (RPC replace_client_templates), el pedido habitual de los clientes del archivo.
 */
export default function TemplatesImportModal({
    clients,
    catalog,
    onClose,
    onDone,
}: {
    clients: Client[];
    catalog: { raws: RawMaterial[]; cores: CoreSpecification[]; coreMaterials: CoreMaterial[]; items: InventoryItem[] };
    onClose: () => void;
    onDone: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [fileName, setFileName] = useState('');
    const [result, setResult] = useState<ImportResult | null>(null);
    const [saving, setSaving] = useState(false);

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        setFileName(file.name);
        const text = await file.text();
        setResult(resolveTemplateImport(parseCSV(text), clients, catalog));
    };

    const apply = async () => {
        if (!result || result.errors.length > 0 || result.data.length === 0) return;
        setSaving(true);
        const { data, error } = await supabase.rpc('replace_client_templates', {
            p_data: result.data.map((d) => ({ client_id: d.client_id, reorder_days: d.reorder_days, lines: d.lines })),
        });
        setSaving(false);
        if (error) return toast.error('No se pudo importar: ' + error.message);
        toast.success(`Importado: ${result.data.length} cliente(s), ${data ?? result.lineCount} línea(s) de pedido habitual`);
        onDone();
    };

    const ok = result && result.errors.length === 0 && result.data.length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                    <h3 className="font-heading text-base font-bold text-[#2E4040]">Importar pedidos habituales</h3>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-4 overflow-y-auto px-6 py-5 text-xs text-[#2E4040]">
                    <div className="rounded-lg border border-[#C8CDC9] bg-slate-50 p-3">
                        <p className="mb-1 font-semibold">Cómo funciona</p>
                        <ol className="list-decimal space-y-0.5 pl-4 text-[11px]">
                            <li>Exporta el archivo actual con &quot;Exportar pedidos habituales&quot; (sirve de plantilla).</li>
                            <li>Edítalo en Excel (una fila por línea de pedido) y guárdalo como CSV.</li>
                            <li>Súbelo aquí: verás la vista previa y los errores antes de aplicar.</li>
                        </ol>
                        <ul className="mt-2 space-y-0.5 text-[11px] text-[#949E97]">
                            {TEMPLATE_CSV_HELP.map((h) => (
                                <li key={h}>• {h}</li>
                            ))}
                        </ul>
                    </div>

                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#C8CDC9] bg-white p-5 font-semibold text-[#2E4040] hover:border-[#3F8346]">
                        <FileUp className="h-5 w-5 text-[#3F8346]" />
                        {fileName || 'Elegir archivo CSV'}
                        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                    </label>

                    {result && (
                        <>
                            {result.errors.length > 0 ? (
                                <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                                    <p className="mb-1 flex items-center gap-1.5 font-semibold text-red-800">
                                        <AlertCircle className="h-4 w-4" /> {result.errors.length} error(es): corrige el archivo y vuelve a subirlo
                                    </p>
                                    <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px] text-red-700">
                                        {result.errors.map((e, i) => (
                                            <li key={i}>
                                                Fila {e.row}: {e.message}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : (
                                <p className="flex items-center gap-1.5 font-semibold text-[#3F8346]">
                                    <CheckCircle2 className="h-4 w-4" /> Archivo válido: {result.data.length} cliente(s), {result.lineCount} línea(s)
                                </p>
                            )}
                            {result.data.length > 0 && (
                                <table className="w-full text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    <thead className="text-[#949E97]">
                                        <tr className="border-b border-[#C8CDC9]">
                                            <th className="py-1 text-left font-semibold">Cliente</th>
                                            <th className="py-1 text-right font-semibold">Frecuencia</th>
                                            <th className="py-1 text-right font-semibold">Rollos</th>
                                            <th className="py-1 text-right font-semibold">Productos</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[#C8CDC9]/40">
                                        {result.data.map((d) => (
                                            <tr key={d.client_id}>
                                                <td className="py-1">{d.client_name}</td>
                                                <td className="py-1 text-right">{d.reorder_days ? `${d.reorder_days} días` : '—'}</td>
                                                <td className="py-1 text-right">{d.lines.filter((l) => l.kind === 'stretch').length}</td>
                                                <td className="py-1 text-right">{d.lines.filter((l) => l.kind !== 'stretch').length}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            <p className="text-[11px] text-amber-700">
                                Al aplicar se reemplaza el pedido habitual (y la frecuencia, si viene) de los clientes del archivo. Los demás no cambian.
                            </p>
                        </>
                    )}
                </div>

                <div className="flex justify-end gap-2 border-t border-[#C8CDC9] px-6 py-3">
                    <button
                        onClick={onClose}
                        className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={apply}
                        disabled={!ok || saving}
                        className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-40"
                    >
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Aplicar importación
                    </button>
                </div>
            </div>
        </div>
    );
}
