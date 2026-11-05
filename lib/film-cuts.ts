import type { FilmCutWidth } from '@/lib/types';

/**
 * Cortes de bobina madre: una bobina de un ancho se corta en varias pistas para fabricar
 * rollos más angostos (60 cm → 4 rollos de 15 cm por pasada). El consumo de película no
 * cambia: kg = (peso rollo − peso core) × rollos / 1000 sobre la bobina exacta.
 * Misma regla que la función SQL public.film_rolls_per_pass.
 */
const TOL = 0.05;

/** Rollos por pasada si el corte está permitido; null si no lo está. */
export function rollsPerPass(cuts: FilmCutWidth[], bobinaWidth: number, rollWidth: number): number | null {
    const forWidth = cuts.filter((c) => Number(c.bobina_width_cm) === Number(bobinaWidth));
    if (forWidth.length === 0) {
        // Ancho sin cortes configurados: solo el mismo ancho (comportamiento anterior)
        return Math.abs(Number(bobinaWidth) - Number(rollWidth)) < TOL ? 1 : null;
    }
    const hit = forWidth.find((c) => Math.abs(Number(c.roll_width_cm) - Number(rollWidth)) < TOL);
    return hit ? Number(hit.rolls_per_pass) : null;
}

/** Medidas de rollo permitidas para un ancho de bobina, de menor a mayor. */
export function allowedRollWidths(cuts: FilmCutWidth[], bobinaWidth: number): number[] {
    const list = cuts
        .filter((c) => Number(c.bobina_width_cm) === Number(bobinaWidth))
        .map((c) => Number(c.roll_width_cm))
        .sort((a, b) => a - b);
    return list.length ? list : [Number(bobinaWidth)];
}

/** Pasadas necesarias y pistas que quedan sin usar en la última pasada. */
export function passPlan(quantity: number, perPass: number) {
    const passes = perPass > 0 ? Math.ceil(quantity / perPass) : 0;
    const spare = passes * perPass - quantity;
    return { passes, spare, suggested: passes * perPass };
}

export const fmtCm = (n: number) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 });
