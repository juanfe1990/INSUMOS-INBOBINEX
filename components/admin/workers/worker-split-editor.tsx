'use client';

import { useMemo, useState } from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import type { Worker } from '@/lib/types';

/**
 * Reparto de un trabajo entre varias personas.
 * Los CORES NO se dividen (cada persona queda con el total de cores del trabajo):
 * se divide el DINERO, en partes iguales o con un valor propio por persona.
 */
export type WorkerShare = { worker_id: string; amount: string };

const fmt = (n: number) => '$' + Math.round(n || 0).toLocaleString('es-CO');

/** Mismo reparto que la base (fn_create_worker_earnings): partes iguales, el residuo de pesos a los primeros */
export function equalAmounts(total: number, n: number): number[] {
    if (n <= 0) return [];
    const t = Math.round(total);
    const base = Math.floor(t / n);
    const rest = t - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

/** Valida el reparto: en partes iguales siempre cuadra; con valores propios deben sumar el total */
export function shareStatus(shares: WorkerShare[], total: number, custom: boolean) {
    if (!custom || shares.length === 0) return { sum: shares.length ? Math.round(total) : 0, ok: true, diff: 0 };
    const sum = shares.reduce((a, s) => a + Math.round(Number(s.amount) || 0), 0);
    const diff = Math.round(total) - sum;
    return { sum, ok: diff === 0 && shares.every((s) => Number(s.amount) > 0), diff };
}

/** Lo que se envía a la RPC: solo worker_id (partes iguales) o worker_id + amount (valores propios) */
export function sharesPayload(shares: WorkerShare[], custom: boolean) {
    return shares.map((s) => (custom ? { worker_id: s.worker_id, amount: Math.round(Number(s.amount) || 0) } : { worker_id: s.worker_id }));
}

export default function WorkerSplitEditor({
    workers,
    total,
    value,
    onChange,
    custom = false,
    onCustomChange,
    title,
    hint,
    units,
}: {
    workers: Worker[];
    /** Valor total a repartir ($) */
    total: number;
    value: WorkerShare[];
    onChange: (v: WorkerShare[]) => void;
    /** Valores propios por persona (si no, partes iguales) */
    custom?: boolean;
    /** Si se pasa, se muestra el selector Partes iguales / Valor por persona */
    onCustomChange?: (v: boolean) => void;
    title?: string;
    hint?: string;
    /** Cores del trabajo: se muestra que cada persona queda con todos */
    units?: number;
}) {
    const [q, setQ] = useState('');
    const selected = new Set(value.map((v) => v.worker_id));
    const equal = equalAmounts(total, value.length);
    const status = shareStatus(value, total, custom);

    const visible = useMemo(() => {
        const t = q.trim().toLowerCase();
        return t ? workers.filter((w) => w.full_name.toLowerCase().includes(t)) : workers;
    }, [workers, q]);

    // Al agregar en modo "valor propio", prellenar con partes iguales para no empezar en cero
    const withEqualAmounts = (ids: string[]) => {
        const eq = equalAmounts(total, ids.length);
        return ids.map((id, i) => ({ worker_id: id, amount: String(eq[i] || '') }));
    };
    const toggle = (id: string) => {
        const ids = selected.has(id) ? value.map((v) => v.worker_id).filter((x) => x !== id) : [...value.map((v) => v.worker_id), id];
        onChange(withEqualAmounts(ids));
    };
    const allVisibleOn = visible.length > 0 && visible.every((w) => selected.has(w.id));
    const toggleAll = () => {
        const ids = allVisibleOn
            ? value.map((v) => v.worker_id).filter((id) => !visible.some((w) => w.id === id))
            : [...value.map((v) => v.worker_id), ...visible.filter((w) => !selected.has(w.id)).map((w) => w.id)];
        onChange(withEqualAmounts(ids));
    };

    return (
        <div className="space-y-2">
            {(title || onCustomChange) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {title && <p className="text-[11px] font-bold text-[#2E4040]">{title}</p>}
                    {onCustomChange && value.length > 1 && (
                        <div className="inline-flex overflow-hidden rounded border border-[#C8CDC9] text-[10px] font-semibold">
                            {[
                                { v: false, l: 'Partes iguales' },
                                { v: true, l: 'Valor por persona' },
                            ].map((o) => (
                                <button
                                    key={o.l}
                                    type="button"
                                    onClick={() => {
                                        onCustomChange(o.v);
                                        if (o.v) onChange(withEqualAmounts(value.map((x) => x.worker_id)));
                                    }}
                                    className={`px-2 py-1 ${custom === o.v ? 'bg-[#2E4040] text-white' : 'bg-white text-[#2E4040] hover:bg-[#C8CDC9]/30'}`}
                                >
                                    {o.l}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {hint && <p className="text-[10px] text-[#949E97]">{hint}</p>}

            {workers.length === 0 ? (
                <p className="rounded-md border border-dashed border-[#C8CDC9] p-2 text-center text-[11px] text-[#949E97]">
                    No hay personas activas. Créalas en el módulo Trabajadores.
                </p>
            ) : (
                <>
                    <div className="flex items-center gap-2">
                        {workers.length > 6 && (
                            <div className="relative flex-1">
                                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#949E97]" />
                                <input
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Buscar persona..."
                                    className="w-full rounded border border-[#C8CDC9] py-1 pl-7 pr-2 text-xs focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>
                        )}
                        {visible.length > 1 && (
                            <button type="button" onClick={toggleAll} className="ml-auto text-[11px] font-semibold text-[#3F8346] hover:underline">
                                {allVisibleOn ? 'Quitar todos' : 'Marcar todos'}
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {visible.map((w) => {
                            const on = selected.has(w.id);
                            return (
                                <button
                                    key={w.id}
                                    type="button"
                                    onClick={() => toggle(w.id)}
                                    aria-pressed={on}
                                    className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                        on ? 'border-[#3F8346] bg-[#3F8346] text-white' : 'border-[#C8CDC9] bg-white text-[#2E4040] hover:border-[#3F8346]'
                                    }`}
                                >
                                    {on && <Check className="h-3 w-3" />}
                                    {w.full_name}
                                </button>
                            );
                        })}
                        {visible.length === 0 && <span className="text-[11px] text-[#949E97]">Sin resultados</span>}
                    </div>
                </>
            )}

            {value.length > 0 && (
                <div className="overflow-hidden rounded-md border border-[#C8CDC9] bg-white">
                    <table className="w-full text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        <thead className="bg-[#F5F7F6] text-[10px] text-[#949E97]">
                            <tr>
                                <th className="px-2 py-1 text-left font-semibold">Persona</th>
                                {units !== undefined && <th className="px-2 py-1 text-right font-semibold">Cores</th>}
                                <th className="px-2 py-1 text-right font-semibold">A pagar</th>
                                <th className="w-6" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#C8CDC9]/50">
                            {value.map((v, i) => {
                                const w = workers.find((x) => x.id === v.worker_id);
                                return (
                                    <tr key={v.worker_id}>
                                        <td className="px-2 py-1.5">
                                            <div className="font-semibold text-[#2E4040]">{w?.full_name || 'Persona'}</div>
                                            {(w?.bank_name || w?.bank_account) && (
                                                <div className="text-[10px] text-[#949E97]">{[w?.bank_name, w?.bank_account].filter(Boolean).join(' · ')}</div>
                                            )}
                                        </td>
                                        {units !== undefined && <td className="px-2 py-1.5 text-right text-[#949E97]">{units.toLocaleString('es-CO')}</td>}
                                        <td className="px-2 py-1.5 text-right">
                                            {custom ? (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={v.amount}
                                                    onChange={(e) => onChange(value.map((x) => (x.worker_id === v.worker_id ? { ...x, amount: e.target.value } : x)))}
                                                    className="w-28 rounded border border-[#C8CDC9] px-2 py-1 text-right text-xs font-semibold focus:border-[#3F8346] focus:outline-none"
                                                    aria-label={`Valor para ${w?.full_name || 'la persona'}`}
                                                />
                                            ) : (
                                                <span className="font-bold text-[#2E4040]">{fmt(equal[i])}</span>
                                            )}
                                        </td>
                                        <td className="pr-1 text-right">
                                            <button
                                                type="button"
                                                onClick={() => toggle(v.worker_id)}
                                                className="rounded p-0.5 text-[#949E97] hover:bg-red-50 hover:text-red-600"
                                                aria-label="Quitar"
                                            >
                                                <X className="h-3.5 w-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className="flex items-center justify-between border-t border-[#C8CDC9]/60 bg-[#F5F7F6] px-2 py-1.5 text-[11px]">
                        <span className="flex items-center gap-1 text-[#2E4040]">
                            <Users className="h-3.5 w-3.5 text-[#3F8346]" />
                            {value.length} persona(s){units !== undefined && value.length > 1 ? ` · cada una con los ${units.toLocaleString('es-CO')} cores` : ''}
                        </span>
                        {custom ? (
                            <span className={status.ok ? 'font-semibold text-[#3F8346]' : 'font-semibold text-red-700'}>
                                {fmt(status.sum)} de {fmt(total)}
                                {status.diff > 0 && ` · faltan ${fmt(status.diff)}`}
                                {status.diff < 0 && ` · sobran ${fmt(-status.diff)}`}
                            </span>
                        ) : (
                            <span className="font-semibold text-[#2E4040]">Total {fmt(total)}</span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
