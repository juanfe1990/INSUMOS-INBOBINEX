'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Scissors, X } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { FilmCutWidth } from '@/lib/types';
import { fmtCm } from '@/lib/film-cuts';

/**
 * Cortes permitidos por ancho de bobina madre (60 cm → rollos de 15, 20, 30 cm).
 * Definen qué cores se pueden usar con cada bobina al crear pedidos (web y app).
 * Un ancho sin cortes configurados solo admite su mismo ancho.
 */
export default function FilmCutsManager({ rawWidths, canEdit }: { rawWidths: number[]; canEdit: boolean }) {
    const [supabase] = useState(() => createClient());
    const [cuts, setCuts] = useState<FilmCutWidth[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [bobina, setBobina] = useState('');
    const [roll, setRoll] = useState('');

    const load = async () => {
        const { data, error } = await supabase
            .from('film_cut_widths')
            .select('*')
            .order('bobina_width_cm')
            .order('roll_width_cm');
        if (error) toast.error('No se pudieron cargar los cortes: ' + error.message);
        setCuts((data || []) as FilmCutWidth[]);
        setLoading(false);
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Anchos a mostrar: los configurados + los de bobinas registradas (aunque no tengan cortes)
    const groups = useMemo(() => {
        const widths = new Set<number>([...cuts.map((c) => Number(c.bobina_width_cm)), ...rawWidths.map(Number)]);
        return Array.from(widths)
            .sort((a, b) => a - b)
            .map((w) => ({ width: w, cuts: cuts.filter((c) => Number(c.bobina_width_cm) === w) }));
    }, [cuts, rawWidths]);

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        const b = Number(bobina);
        const r = Number(roll);
        if (!(b > 0) || !(r > 0)) return toast.error('Indica el ancho de la bobina y la medida del rollo');
        if (r > b) return toast.error('El rollo no puede ser más ancho que la bobina');
        setSaving(true);
        const { error } = await supabase.from('film_cut_widths').insert({ bobina_width_cm: b, roll_width_cm: r });
        setSaving(false);
        if (error) {
            return toast.error(
                error.code === '23505' ? 'Ese corte ya existe' : 'No se pudo guardar: ' + error.message
            );
        }
        toast.success(`Bobina ${fmtCm(b)} cm → rollos de ${fmtCm(r)} cm`);
        setRoll('');
        load();
    };

    const remove = async (c: FilmCutWidth) => {
        const { data, error } = await supabase.from('film_cut_widths').delete().eq('id', c.id).select('id');
        if (error) return toast.error('No se pudo eliminar: ' + error.message);
        if (!data?.length) return toast.error('Solo un administrador puede modificar los cortes');
        toast.success(`Corte de ${fmtCm(c.roll_width_cm)} cm eliminado de la bobina de ${fmtCm(c.bobina_width_cm)} cm`);
        load();
    };

    return (
        <div className="rounded-xl border border-[#C8CDC9] bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-[#2E4040]">
                        <Scissors className="h-4 w-4 text-[#3F8346]" />
                        Cortes por ancho de bobina
                    </h3>
                    <p className="text-[11px] text-[#949E97]">
                        Medidas de rollo que se pueden fabricar con cada bobina. El pedido descuenta el peso real de
                        todos los rollos de la bobina usada.
                    </p>
                </div>
                {canEdit && (
                    <form onSubmit={add} className="flex items-end gap-2">
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Bobina (cm)</label>
                            <input
                                type="number"
                                min="1"
                                step="any"
                                list="film-cut-widths"
                                value={bobina}
                                onChange={(e) => setBobina(e.target.value)}
                                className="w-20 rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                            />
                            <datalist id="film-cut-widths">
                                {groups.map((g) => (
                                    <option key={g.width} value={g.width} />
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold text-[#949E97]">Rollo (cm)</label>
                            <input
                                type="number"
                                min="0.1"
                                step="any"
                                value={roll}
                                onChange={(e) => setRoll(e.target.value)}
                                className="w-20 rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex items-center gap-1 rounded-md bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            Agregar corte
                        </button>
                    </form>
                )}
            </div>

            {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-[#3F8346]" />
            ) : (
                <div className="divide-y divide-[#C8CDC9]/60">
                    {groups.map((g) => (
                        <div key={g.width} className="flex flex-wrap items-center gap-2 py-2">
                            <span className="w-24 shrink-0 text-xs font-bold text-[#2E4040]">Bobina {fmtCm(g.width)} cm</span>
                            {g.cuts.length === 0 ? (
                                <span className="text-[11px] text-[#949E97]">
                                    Sin cortes configurados: solo rollos de {fmtCm(g.width)} cm
                                </span>
                            ) : (
                                g.cuts.map((c) => (
                                    <span
                                        key={c.id}
                                        className="flex items-center gap-1 rounded-full border border-[#C8CDC9] bg-slate-50 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-[#2E4040]"
                                    >
                                        {fmtCm(c.roll_width_cm)} cm
                                        <span className="font-normal text-[#949E97]">×{c.rolls_per_pass}</span>
                                        {canEdit ? (
                                            <button
                                                type="button"
                                                onClick={() => remove(c)}
                                                title="Quitar corte"
                                                className="rounded-full p-0.5 text-[#949E97] hover:bg-red-50 hover:text-red-600"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        ) : (
                                            <span className="w-1" />
                                        )}
                                    </span>
                                ))
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
