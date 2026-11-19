'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Hammer, Loader2, Package, Scissors, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { CoreMaterial, CoreSpecification, Worker } from '@/lib/types';
import { INPUT, LABEL, dbErrorMessage, formatCOP, todayISO } from '@/components/admin/suppliers/utils';
import WorkerSplitEditor, { type WorkerShare } from './worker-split-editor';

const fmtKg = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fmtCm = (n: number) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
const QUICK = [10, 25, 50, 100];

function shiftISO(days: number) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString('en-CA');
}

/**
 * Registrar trabajo de ARMADO DE CORES (igual que "Armar cores" de la app):
 * medida + cantidad + fecha + personas. La RPC register_core_assembly descuenta el material (kg),
 * suma los cores al inventario, recalcula el costo y causa la mano de obra por persona
 * (los cores no se dividen: el valor se reparte en partes iguales).
 */
export default function CoreAssemblyModal({
    workers,
    onClose,
    onSaved,
    onServiceInstead,
}: {
    workers: Worker[];
    onClose: () => void;
    onSaved: () => void;
    /** Cambiar al formulario de servicios u otros trabajos */
    onServiceInstead: () => void;
}) {
    const [supabase] = useState(() => createClient());
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [cores, setCores] = useState<CoreSpecification[]>([]);
    const [materials, setMaterials] = useState<CoreMaterial[]>([]);
    const [coreId, setCoreId] = useState('');
    const [qty, setQty] = useState('');
    const [date, setDate] = useState(todayISO());
    const [assemblers, setAssemblers] = useState<WorkerShare[]>([]);
    const [cutters, setCutters] = useState<WorkerShare[]>([]);
    // Igual que en la app: por defecto el corte de cartón NO se reparte entre las mismas personas
    const [cutSame, setCutSame] = useState(false);
    const [notes, setNotes] = useState('');

    const coreWorkers = useMemo(() => workers.filter((w) => w.work_type !== 'servicios'), [workers]);

    useEffect(() => {
        (async () => {
            const [c, m] = await Promise.all([
                supabase.from('core_specifications').select('*').order('length_cm'),
                supabase.from('core_materials').select('*').order('name'),
            ]);
            if (c.error || m.error) toast.error('No se pudieron cargar las medidas de cores');
            setCores((c.data || []) as CoreSpecification[]);
            setMaterials((m.data || []) as CoreMaterial[]);
            setLoading(false);
        })();
    }, [supabase]);

    // Medidas agrupadas por material (como en la app)
    const groups = useMemo(() => {
        const g = new Map<string, { title: string; items: CoreSpecification[] }>();
        for (const c of cores) {
            const key = c.core_material_id || 'sin';
            if (!g.has(key)) g.set(key, { title: materials.find((m) => m.id === c.core_material_id)?.name || 'Sin material asignado', items: [] });
            g.get(key)!.items.push(c);
        }
        return [...g.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'));
    }, [cores, materials]);

    const core = cores.find((c) => c.id === coreId) || null;
    const material = materials.find((m) => m.id === core?.core_material_id) || null;
    const units = Math.max(0, Math.floor(Number(qty) || 0));
    const weight = Number(core?.weight_grams || 0);
    const kgUsed = (units * weight) / 1000;
    const kgAvailable = Number(material?.current_stock_kg || 0);
    const maxBuildable = weight > 0 ? Math.floor((kgAvailable * 1000) / weight) : null;
    const materialCost = kgUsed * Number(material?.cost_per_kg || 0);
    const laborRate = Number(core?.labor_cost_per_unit || 0);
    const cutRate = core?.has_cardboard_part ? Number(core?.cardboard_cut_cost_per_unit || 0) : 0;
    const laborCost = units * laborRate;
    const cutCost = units * cutRate;
    const unitCost = units > 0 ? (materialCost + laborCost + cutCost) / units : 0;

    const problem = !core
        ? 'Elige la medida'
        : !material
          ? 'Esta medida no tiene material asignado (Inventarios → Cores → Editar).'
          : weight <= 0
            ? 'Esta medida no tiene peso promedio del core armado (Inventarios → Cores → Editar).'
            : units <= 0
              ? 'Escribe cuántos cores se armaron'
              : kgUsed > kgAvailable
                ? `No alcanza el material: se necesitan ${fmtKg(kgUsed)} kg y hay ${fmtKg(kgAvailable)} kg.`
                : coreWorkers.length > 0 && assemblers.length === 0
                  ? 'Elige quién armó los cores'
                  : null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (problem || !core) return toast.error(problem || 'Revisa el formulario');
        const cutPeople = cutRate > 0 ? (cutSame ? assemblers : cutters) : [];
        setSaving(true);
        const { data, error } = await supabase.rpc('register_core_assembly', {
            p_core_id: core.id,
            p_units: units,
            ...(notes.trim() ? { p_notes: notes.trim() } : {}),
            p_workers: [
                ...assemblers.map((x) => ({ worker_id: x.worker_id, trade: 'armado' })),
                ...cutPeople.map((x) => ({ worker_id: x.worker_id, trade: 'corte_carton' })),
            ],
            p_date: date,
        });
        setSaving(false);
        if (error) return toast.error('No se pudo registrar: ' + dbErrorMessage(error));
        const r = (data || {}) as { kg_used?: number; unassigned?: number };
        toast.success(
            `+${units} cores de ${fmtCm(core.length_cm)} cm · ${fmtKg(Number(r.kg_used ?? kgUsed))} kg de ${material?.name} descontados · mano de obra ${formatCOP(laborCost + cutCost)} por pagar`
        );
        if (Number(r.unassigned || 0) > 0) toast.info('Parte de la mano de obra quedó "sin asignar": asígnala en Por pagar.');
        onSaved();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
            <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#C8CDC9] bg-[#FDFDFD] px-6 py-4">
                    <div>
                        <h3 className="font-heading text-base font-bold text-[#2E4040]">Registrar trabajo</h3>
                        <div className="mt-1.5 inline-flex overflow-hidden rounded border border-[#C8CDC9] text-[11px] font-semibold">
                            <span className="flex items-center gap-1 bg-[#2E4040] px-2.5 py-1 text-white">
                                <Hammer className="h-3 w-3" /> Armado de cores
                            </span>
                            <button type="button" onClick={onServiceInstead} className="bg-white px-2.5 py-1 text-[#2E4040] hover:bg-[#C8CDC9]/30">
                                Servicio u otro
                            </button>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30" aria-label="Cerrar">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-16">
                        <Loader2 className="h-7 w-7 animate-spin text-[#3F8346]" />
                    </div>
                ) : (
                    <form onSubmit={submit} className="space-y-5 px-6 py-5">
                        {/* 1. Medida */}
                        <section>
                            <Step n={1} text="¿Qué medida se armó?" />
                            {cores.length === 0 ? (
                                <p className="text-xs text-[#949E97]">No hay medidas de cores. Créalas en Inventarios → Cores.</p>
                            ) : (
                                <div className="space-y-2.5">
                                    {groups.map((g) => (
                                        <div key={g.title}>
                                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#949E97]">{g.title}</p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {g.items.map((c) => {
                                                    const on = c.id === coreId;
                                                    return (
                                                        <button
                                                            key={c.id}
                                                            type="button"
                                                            onClick={() => setCoreId(c.id)}
                                                            aria-pressed={on}
                                                            className={`rounded-lg border px-3 py-1.5 text-left transition ${
                                                                on ? 'border-[#3F8346] bg-[#3F8346] text-white' : 'border-[#C8CDC9] bg-white text-[#2E4040] hover:border-[#3F8346]'
                                                            }`}
                                                        >
                                                            <span className="block text-sm font-bold">{fmtCm(c.length_cm)} cm</span>
                                                            <span className={`block text-[10px] ${on ? 'text-white/80' : 'text-[#949E97]'}`}>
                                                                {c.current_stock_units} en stock{c.has_cardboard_part ? ' · con cartón' : ''}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* 2. Cantidad y fecha */}
                        <section className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
                            <div>
                                <Step n={2} text="¿Cuántos cores?" />
                                <div className="flex flex-wrap items-center gap-2">
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={qty}
                                        onChange={(e) => setQty(e.target.value)}
                                        placeholder="Ej: 200"
                                        className="w-32 rounded-lg border border-[#C8CDC9] px-3 py-2 text-lg font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                    {QUICK.map((n) => (
                                        <button
                                            key={n}
                                            type="button"
                                            onClick={() => setQty(String(units + n))}
                                            className="rounded-md border border-[#C8CDC9] bg-white px-2.5 py-1.5 text-xs font-bold text-[#2E4040] hover:border-[#3F8346] hover:text-[#3F8346]"
                                        >
                                            +{n}
                                        </button>
                                    ))}
                                    {units > 0 && (
                                        <button type="button" onClick={() => setQty('')} className="text-[11px] font-semibold text-[#949E97] hover:text-red-600">
                                            Limpiar
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div>
                                <Step n={3} text="¿Cuándo?" />
                                <div className="flex items-center gap-1.5">
                                    {['Hoy', 'Ayer', 'Antier'].map((l, i) => (
                                        <button
                                            key={l}
                                            type="button"
                                            onClick={() => setDate(shiftISO(i))}
                                            className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                                                date === shiftISO(i) ? 'border-[#2E4040] bg-[#2E4040] text-white' : 'border-[#C8CDC9] bg-white text-[#2E4040]'
                                            }`}
                                        >
                                            {l}
                                        </button>
                                    ))}
                                    <div className="relative">
                                        <CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#949E97]" />
                                        <input
                                            type="date"
                                            value={date}
                                            min={shiftISO(31)}
                                            max={todayISO()}
                                            onChange={(e) => setDate(e.target.value)}
                                            className="rounded-md border border-[#C8CDC9] py-1.5 pl-7 pr-2 text-xs focus:border-[#3F8346] focus:outline-none"
                                            aria-label="Fecha del trabajo"
                                        />
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Cálculo: inventario y costos */}
                        {core && (
                            <section
                                className={`grid grid-cols-1 gap-3 rounded-lg border p-3 text-xs sm:grid-cols-2 ${
                                    material && weight > 0 && kgUsed > kgAvailable ? 'border-red-200 bg-red-50' : 'border-[#C8CDC9] bg-[#F5F7F6]'
                                }`}
                                style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                                <div className="space-y-1">
                                    <p className="flex items-center gap-1 font-bold text-[#2E4040]">
                                        <Package className="h-3.5 w-3.5 text-[#3F8346]" /> Inventario
                                    </p>
                                    {material ? (
                                        <>
                                            <Row label={`Material (${units} × ${weight.toLocaleString('es-CO')} g)`} value={`−${fmtKg(kgUsed)} kg`} strong />
                                            <Row label={`${material.name} en bodega`} value={`${fmtKg(kgAvailable)} kg`} />
                                            <Row label="Queda" value={`${fmtKg(Math.max(kgAvailable - kgUsed, 0))} kg`} />
                                            {maxBuildable !== null && <Row label="Alcanza para" value={`${maxBuildable.toLocaleString('es-CO')} cores`} />}
                                            <Row label={`Cores de ${fmtCm(core.length_cm)} cm`} value={`${core.current_stock_units} → ${core.current_stock_units + units}`} />
                                        </>
                                    ) : (
                                        <p className="text-red-700">Sin material asignado.</p>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <p className="flex items-center gap-1 font-bold text-[#2E4040]">
                                        <Hammer className="h-3.5 w-3.5 text-[#3F8346]" /> Costos
                                    </p>
                                    <Row label="Material" value={formatCOP(materialCost)} />
                                    <Row label={`Armado (${formatCOP(laborRate)} c/u)`} value={formatCOP(laborCost)} />
                                    {cutRate > 0 && <Row label={`Corte de cartón (${formatCOP(cutRate)} c/u)`} value={formatCOP(cutCost)} />}
                                    <Row label="Mano de obra por pagar" value={formatCOP(laborCost + cutCost)} strong />
                                    <Row label="Costo por core" value={formatCOP(unitCost)} />
                                </div>
                            </section>
                        )}

                        {/* 4. Personas */}
                        <section className="space-y-3">
                            <Step n={4} text="¿Quién trabajó?" />
                            <WorkerSplitEditor
                                workers={coreWorkers}
                                total={laborCost}
                                units={units}
                                value={assemblers}
                                onChange={setAssemblers}
                                title={`Armaron · ${formatCOP(laborCost)}`}
                                hint="Marca a todas las personas que armaron. Los cores no se dividen: el valor se reparte en partes iguales."
                            />
                            {cutRate > 0 && (
                                <div className="space-y-2 rounded-lg border border-[#C8CDC9] bg-[#F5F7F6] p-3">
                                    <label className="flex cursor-pointer items-center justify-between gap-3">
                                        <span>
                                            <span className="flex items-center gap-1 text-xs font-bold text-[#2E4040]">
                                                <Scissors className="h-3.5 w-3.5 text-[#3F8346]" /> ¿Dividir también el corte de cartón? ({formatCOP(cutCost)})
                                            </span>
                                            <span className="block text-[11px] text-[#949E97]">
                                                {cutSame
                                                    ? 'Sí: se reparte entre las mismas personas del armado.'
                                                    : 'No: elige quién cortó el cartón (vacío = queda sin asignar).'}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={cutSame}
                                            onClick={() => setCutSame((v) => !v)}
                                            className={`relative h-5 w-9 shrink-0 rounded-full transition ${cutSame ? 'bg-[#3F8346]' : 'bg-[#C8CDC9]'}`}
                                        >
                                            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${cutSame ? 'left-[18px]' : 'left-0.5'}`} />
                                        </button>
                                    </label>
                                    {cutSame ? (
                                        assemblers.length > 0 && (
                                            <p className="text-[11px] text-[#2E4040]">
                                                Corte: {formatCOP(cutCost / assemblers.length)} para cada una de las {assemblers.length} persona(s).
                                            </p>
                                        )
                                    ) : (
                                        <WorkerSplitEditor
                                            workers={coreWorkers}
                                            total={cutCost}
                                            units={units}
                                            value={cutters}
                                            onChange={setCutters}
                                            title="Cortaron el cartón"
                                        />
                                    )}
                                </div>
                            )}
                        </section>

                        <div>
                            <label className={LABEL}>Observaciones (opcional)</label>
                            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: Turno mañana, lote 1" className={INPUT} />
                        </div>

                        {problem && units > 0 && core && (
                            <p className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                <AlertTriangle className="h-4 w-4" /> {problem}
                            </p>
                        )}

                        <div className="flex justify-end gap-2 border-t border-[#C8CDC9] pt-3">
                            <button type="button" onClick={onClose} className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20">
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !!problem}
                                className="flex items-center gap-1.5 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                            >
                                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                {units > 0 && core ? `Registrar ${units} cores de ${fmtCm(core.length_cm)} cm` : 'Registrar armado'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

function Step({ n, text }: { n: number; text: string }) {
    return (
        <p className="mb-2 flex items-center gap-2 text-xs font-bold text-[#2E4040]">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2E4040] text-[10px] text-white">{n}</span>
            {text}
        </p>
    );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
    return (
        <div className="flex justify-between gap-2">
            <span className="text-[#949E97]">{label}</span>
            <span className={strong ? 'font-bold text-[#2E4040]' : 'text-[#2E4040]'}>{value}</span>
        </div>
    );
}
