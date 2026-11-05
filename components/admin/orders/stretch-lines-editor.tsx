'use client';

import { AlertCircle, CheckCircle2, Plus, Scissors, Trash2 } from 'lucide-react';
import type { CoreMaterial, CoreSpecification, FilmCutWidth, RawMaterial } from '@/lib/types';
import { fmtCm, rollsPerPass } from '@/lib/film-cuts';
import { compatibleCores, fmtKg, newStretchLine, type StretchCheck, type StretchLine } from '@/lib/stretch-lines';

const INPUT =
    'w-full rounded border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';
const fmtCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

type Props = {
    lines: StretchLine[];
    onChange: (lines: StretchLine[]) => void;
    checks: Record<number, StretchCheck>;
    raws: RawMaterial[];
    cores: CoreSpecification[];
    coreMaterials: CoreMaterial[];
    cuts: FilmCutWidth[];
    /** Pedido habitual: muestra todas las bobinas (aunque no tengan stock) y oculta el consumo */
    templateMode?: boolean;
    subtotal: number;
    rolls: number;
    filmKg: number;
};

/** Varias medidas de stretch (ej. 15 cm y 45 cm en el mismo pedido / factura) */
export default function StretchLinesEditor({
    lines,
    onChange,
    checks,
    raws,
    cores,
    coreMaterials,
    cuts,
    templateMode = false,
    subtotal,
    rolls,
    filmKg,
}: Props) {
    const update = (key: number, patch: Partial<StretchLine>) =>
        onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

    const pickRaw = (line: StretchLine, rawId: string) => {
        const raw = raws.find((r) => r.id === rawId) || null;
        const compatible = compatibleCores(raw, cores, cuts);
        const keep = compatible.find((c) => c.id === line.core_id);
        update(line.key, { raw_material_id: rawId, core_id: keep?.id || compatible[0]?.id || '' });
    };

    const addLine = () => {
        // La nueva medida arranca con la misma bobina de la última línea (lo más común)
        const last = lines[lines.length - 1];
        const raw =
            raws.find((r) => r.id === last?.raw_material_id) ||
            raws.find((r) => templateMode || Number(r.current_stock_kg) > 0) ||
            null;
        const used = new Set(lines.map((l) => l.core_id));
        const compatible = compatibleCores(raw, cores, cuts);
        const core = compatible.find((c) => !used.has(c.id)) || compatible[0];
        onChange([
            ...lines,
            newStretchLine({
                raw_material_id: raw?.id || '',
                core_id: core?.id || '',
                weight_grams: last?.weight_grams || '1500',
                unit_price: '',
            }),
        ]);
    };

    const materialName = (c: CoreSpecification) => coreMaterials.find((m) => m.id === c.core_material_id)?.name || c.name;

    return (
        <div className="space-y-2.5">
            {lines.length === 0 && (
                <p className="rounded-md border border-dashed border-[#C8CDC9] bg-white p-3 text-center text-[11px] text-[#949E97]">
                    {templateMode
                        ? 'Sin rollos en el pedido habitual.'
                        : 'Pedido sin fabricación: no pasa por planta y queda "Listo Despacho" al crearlo.'}
                </p>
            )}

            {lines.map((line, idx) => {
                const c = checks[line.key];
                const rawOptions = raws.filter(
                    (r) => templateMode || Number(r.current_stock_kg) > 0 || r.id === line.raw_material_id
                );
                const compatible = compatibleCores(c?.raw || null, cores, cuts);
                return (
                    <div key={line.key} className="rounded-lg border border-[#C8CDC9] bg-white p-3 shadow-sm">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-bold text-[#2E4040]">
                                Medida {idx + 1}
                                {c?.core && (
                                    <span className="ml-1.5 font-normal text-[#949E97]">
                                        · {fmtCm(c.core.length_cm)} cm{c.qty > 0 ? ` × ${c.qty} rollos` : ''}
                                    </span>
                                )}
                            </span>
                            <button
                                type="button"
                                onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                                className="rounded p-1 text-[#949E97] hover:bg-red-50 hover:text-red-600"
                                title="Quitar esta medida"
                                aria-label={`Quitar medida ${idx + 1}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-12 sm:col-span-6">
                                <label className={LABEL}>Bobina madre (color · ancho · calibre)</label>
                                <select value={line.raw_material_id} onChange={(e) => pickRaw(line, e.target.value)} className={`${INPUT} font-semibold`}>
                                    <option value="">Selecciona...</option>
                                    {rawOptions.map((r) => (
                                        <option key={r.id} value={r.id}>
                                            {r.name} — {r.color} · {fmtCm(r.width_cm)} cm · {Number(r.caliber_microns)} µ
                                            {templateMode ? '' : ` — ${fmtKg(Number(r.current_stock_kg))} kg`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="col-span-12 sm:col-span-6">
                                <label className={LABEL}>
                                    Medida del rollo / core
                                    {c?.raw ? ` (cortes: ${c.allowedWidths.map(fmtCm).join(', ')} cm)` : ''}
                                </label>
                                <select
                                    value={line.core_id}
                                    onChange={(e) => update(line.key, { core_id: e.target.value })}
                                    disabled={!c?.raw || compatible.length === 0}
                                    className={`${INPUT} font-semibold disabled:bg-gray-50 disabled:text-[#949E97]`}
                                >
                                    {compatible.length === 0 ? (
                                        <option value="">{c?.raw ? 'Sin cores para estos cortes' : 'Elige primero la bobina'}</option>
                                    ) : (
                                        compatible.map((co) => {
                                            const n = c?.raw ? rollsPerPass(cuts, c.raw.width_cm, Number(co.length_cm)) : null;
                                            return (
                                                <option key={co.id} value={co.id}>
                                                    {fmtCm(co.length_cm)} cm {materialName(co)}
                                                    {n && n > 1 ? ` (${n} por pasada)` : ''} — {Number(co.weight_grams || 0)} g
                                                    {templateMode ? '' : ` — ${co.current_stock_units} und`}
                                                </option>
                                            );
                                        })
                                    )}
                                </select>
                            </div>
                            <div className="col-span-4">
                                <label className={LABEL}>Rollos</label>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={line.quantity}
                                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                                    className={INPUT}
                                />
                            </div>
                            <div className="col-span-4">
                                <label className={LABEL}>Peso total por rollo (g)</label>
                                <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={line.weight_grams}
                                    onChange={(e) => update(line.key, { weight_grams: e.target.value })}
                                    placeholder="Core + película"
                                    className={INPUT}
                                />
                            </div>
                            <div className="col-span-4">
                                <label className={LABEL}>Precio por rollo ($)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={line.unit_price}
                                    onChange={(e) => update(line.key, { unit_price: e.target.value })}
                                    className={INPUT}
                                />
                            </div>
                        </div>

                        {c && (
                            <div className="mt-2 space-y-1 text-[11px]">
                                {c.error ? (
                                    <div className="flex items-start gap-1.5 rounded border border-red-200 bg-red-50 p-1.5 font-semibold text-red-700">
                                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span>{c.error}</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[#2E4040]">
                                        <CheckCircle2 className="h-3.5 w-3.5 text-[#3F8346]" />
                                        <span>
                                            {c.coreWeight} g core + {c.filmPerRoll} g película
                                            {!templateMode && (
                                                <>
                                                    {' '}
                                                    · <b>{fmtKg(c.filmKg)} kg</b> de &quot;{c.raw?.name}&quot;
                                                </>
                                            )}
                                        </span>
                                        {c.perPass && c.perPass > 1 && c.plan && (
                                            <span className="inline-flex items-center gap-1 text-[#949E97]">
                                                <Scissors className="h-3 w-3" />
                                                {c.perPass} por pasada · {c.plan.passes} {c.plan.passes === 1 ? 'pasada' : 'pasadas'}
                                            </span>
                                        )}
                                        <span className="ml-auto font-semibold">{fmtCOP(c.subtotal)}</span>
                                    </div>
                                )}
                                {c.warning && <p className="text-amber-700">{c.warning}</p>}
                            </div>
                        )}
                    </div>
                );
            })}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={addLine}
                    className="flex items-center gap-1.5 rounded-md border border-dashed border-[#3F8346] bg-white px-3 py-1.5 text-xs font-semibold text-[#3F8346] hover:bg-[#3F8346]/5"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {lines.length === 0 ? 'Agregar rollos de stretch' : 'Agregar otra medida'}
                </button>
                {lines.length > 0 && (
                    <span className="text-[11px] text-[#2E4040]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {rolls} rollos{templateMode ? '' : ` · ${fmtKg(filmKg)} kg de película`} · <b>{fmtCOP(subtotal)}</b>
                    </span>
                )}
            </div>
        </div>
    );
}
