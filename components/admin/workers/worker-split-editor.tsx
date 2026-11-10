'use client';

import { Check, Equal } from 'lucide-react';
import type { Worker } from '@/lib/types';

export type WorkerSplit = { worker_id: string; value: string };

/** Reparte un total entero en partes iguales (el residuo va a los primeros) */
export function equalSplit(ids: string[], total: number): WorkerSplit[] {
    if (ids.length === 0) return [];
    const base = Math.floor(total / ids.length);
    let rest = total - base * ids.length;
    return ids.map((id) => {
        const v = base + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
        return { worker_id: id, value: String(v) };
    });
}

export const splitSum = (s: WorkerSplit[]) => s.reduce((a, x) => a + (Number(x.value) || 0), 0);

/**
 * Elige las personas que trabajaron y cuánto le toca a cada una
 * (cores por defecto; en servicios, valor en $). Al marcar o desmarcar se reparte en partes iguales.
 */
export default function WorkerSplitEditor({
    workers,
    total,
    value,
    onChange,
    unitLabel = 'cores',
    rate,
    title,
}: {
    workers: Worker[];
    /** Total a repartir (cores o $) */
    total: number;
    value: WorkerSplit[];
    onChange: (v: WorkerSplit[]) => void;
    unitLabel?: string;
    /** Valor por core: muestra cuánto le toca a cada persona */
    rate?: number;
    title?: string;
}) {
    const selected = new Set(value.map((v) => v.worker_id));
    const toggle = (id: string) => {
        const ids = selected.has(id) ? value.map((v) => v.worker_id).filter((x) => x !== id) : [...value.map((v) => v.worker_id), id];
        onChange(equalSplit(ids, Math.max(0, Math.floor(total))));
    };
    const sum = splitSum(value);
    const ok = value.length === 0 || sum === total;
    const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

    return (
        <div className="space-y-2">
            {title && <p className="text-[11px] font-semibold text-[#2E4040]">{title}</p>}
            {workers.length === 0 ? (
                <p className="rounded-md border border-dashed border-[#C8CDC9] p-2 text-center text-[11px] text-[#949E97]">
                    No hay personas activas. Créalas en el módulo Trabajadores.
                </p>
            ) : (
                <div className="flex flex-wrap gap-1.5">
                    {workers.map((w) => {
                        const on = selected.has(w.id);
                        return (
                            <button
                                key={w.id}
                                type="button"
                                onClick={() => toggle(w.id)}
                                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                    on ? 'border-[#3F8346] bg-[#3F8346] text-white' : 'border-[#C8CDC9] bg-white text-[#2E4040] hover:border-[#3F8346]'
                                }`}
                            >
                                {on && <Check className="h-3 w-3" />}
                                {w.full_name}
                            </button>
                        );
                    })}
                </div>
            )}

            {value.length > 0 && (
                <div className="space-y-1 rounded-md border border-[#C8CDC9] bg-white p-2">
                    {value.map((v) => {
                        const w = workers.find((x) => x.id === v.worker_id);
                        return (
                            <div key={v.worker_id} className="flex items-center gap-2 text-xs">
                                <span className="flex-1 truncate font-semibold text-[#2E4040]">{w?.full_name || 'Persona'}</span>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={v.value}
                                    onChange={(e) =>
                                        onChange(value.map((x) => (x.worker_id === v.worker_id ? { ...x, value: e.target.value } : x)))
                                    }
                                    className="w-20 rounded border border-[#C8CDC9] px-2 py-1 text-right text-xs focus:border-[#3F8346] focus:outline-none"
                                />
                                <span className="w-12 text-[11px] text-[#949E97]">{unitLabel}</span>
                                {rate !== undefined && (
                                    <span className="w-20 text-right text-[11px] font-semibold text-[#2E4040]">
                                        {fmt((Number(v.value) || 0) * rate)}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                    <div className="flex items-center justify-between border-t border-[#C8CDC9]/60 pt-1 text-[11px]">
                        <span className={ok ? 'text-[#3F8346]' : 'font-semibold text-red-700'}>
                            Suma {sum.toLocaleString('es-CO')} de {total.toLocaleString('es-CO')} {unitLabel}
                            {!ok && ' — debe cuadrar'}
                        </span>
                        <button
                            type="button"
                            onClick={() => onChange(equalSplit(value.map((v) => v.worker_id), Math.max(0, Math.floor(total))))}
                            className="flex items-center gap-1 font-semibold text-[#3F8346] hover:underline"
                        >
                            <Equal className="h-3 w-3" /> Partes iguales
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
