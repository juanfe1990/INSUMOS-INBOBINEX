'use client';

import { Scissors } from 'lucide-react';

/**
 * Interruptor "lleva parte de cartón" + costo del corte de cartón por core.
 * Ese costo se suma al del core y se liquida aparte a quien corta el cartón
 * (el armado se paga con labor_cost_per_unit).
 */
export default function CardboardCutField({
    enabled,
    onEnabledChange,
    cost,
    onCostChange,
}: {
    enabled: boolean;
    onEnabledChange: (v: boolean) => void;
    cost: string;
    onCostChange: (v: string) => void;
}) {
    return (
        <div className={`rounded-lg border p-3 ${enabled ? 'border-[#3F8346]/50 bg-[#3F8346]/5' : 'border-[#C8CDC9] bg-white'}`}>
            <label className="flex cursor-pointer items-start gap-2.5">
                <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => onEnabledChange(!enabled)}
                    className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${enabled ? 'bg-[#3F8346]' : 'bg-[#C8CDC9]'}`}
                >
                    <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${enabled ? 'left-[18px]' : 'left-0.5'}`}
                    />
                </button>
                <span className="text-xs text-[#2E4040]" onClick={() => onEnabledChange(!enabled)}>
                    <span className="flex items-center gap-1 font-semibold">
                        <Scissors className="h-3.5 w-3.5 text-[#3F8346]" />
                        Lleva una parte de cartón (el resto es plega)
                    </span>
                    <span className="block text-[11px] text-[#949E97]">
                        Agrega el costo de quien corta el cartón, aparte del armado.
                    </span>
                </span>
            </label>
            {enabled && (
                <div className="mt-2.5 pl-11">
                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Corte de cartón / core ($):</label>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={cost}
                        onChange={(e) => onCostChange(e.target.value)}
                        placeholder="Ej: 80"
                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                    />
                </div>
            )}
        </div>
    );
}
