import type { CoreSpecification, FilmCutWidth, RawMaterial } from '@/lib/types';
import { allowedRollWidths, fmtCm, passPlan, rollsPerPass } from '@/lib/film-cuts';

/**
 * Medidas de stretch de un pedido (o de un pedido habitual): cada línea es una medida
 * de rollo con su bobina madre, core, peso por rollo, cantidad y precio.
 * Mismas reglas que la RPC create_order: corte permitido, peso > core y stock COMBINADO
 * por bobina (kg de película de todas las líneas) y por core (unidades de todas las líneas).
 */
export type StretchLine = {
    key: number;
    raw_material_id: string;
    core_id: string;
    quantity: string;
    /** Peso total por rollo (g) = core + película */
    weight_grams: string;
    unit_price: string;
};

export type StretchCheck = {
    raw: RawMaterial | null;
    core: CoreSpecification | null;
    qty: number;
    weight: number;
    coreWeight: number;
    filmPerRoll: number;
    filmKg: number;
    subtotal: number;
    perPass: number | null;
    plan: { passes: number; spare: number; suggested: number } | null;
    allowedWidths: number[];
    error: string | null;
    warning: string | null;
};

let seq = 1;
export function newStretchLine(partial: Partial<StretchLine> = {}): StretchLine {
    return {
        key: seq++,
        raw_material_id: '',
        core_id: '',
        quantity: '10',
        weight_grams: '1500',
        unit_price: '',
        ...partial,
    };
}

export const fmtKg = (kg: number) => kg.toLocaleString('es-CO', { maximumFractionDigits: 2 });

/** Cores compatibles con una bobina según los cortes permitidos */
export function compatibleCores(raw: RawMaterial | null, cores: CoreSpecification[], cuts: FilmCutWidth[]) {
    if (!raw) return [];
    return cores.filter((c) => rollsPerPass(cuts, raw.width_cm, Number(c.length_cm)) !== null);
}

export function analyzeStretch(
    lines: StretchLine[],
    raws: RawMaterial[],
    cores: CoreSpecification[],
    cuts: FilmCutWidth[],
    /** false = solo valida forma (pedido habitual), sin exigir stock */
    checkStock = true
) {
    const checks: Record<number, StretchCheck> = {};
    const filmByRaw: Record<string, number> = {};
    const unitsByCore: Record<string, number> = {};
    let subtotal = 0;
    let rolls = 0;
    let filmKg = 0;

    for (const l of lines) {
        const raw = raws.find((r) => r.id === l.raw_material_id) || null;
        const core = cores.find((c) => c.id === l.core_id) || null;
        const qty = Math.floor(Number(l.quantity) || 0);
        const weight = Number(l.weight_grams) || 0;
        const price = Number(l.unit_price) || 0;
        const coreWeight = Number(core?.weight_grams || 0);
        const filmPerRoll = weight - coreWeight;
        const kg = (Math.max(filmPerRoll, 0) * qty) / 1000;
        const perPass = raw && core ? rollsPerPass(cuts, raw.width_cm, Number(core.length_cm)) : null;
        const allowedWidths = raw ? allowedRollWidths(cuts, raw.width_cm) : [];
        let error: string | null = null;
        if (!raw) error = 'Elige la bobina madre';
        else if (!core) error = 'Elige la medida del rollo (core)';
        else if (perPass === null)
            error = `La bobina de ${fmtCm(raw.width_cm)} cm permite rollos de ${allowedWidths.map(fmtCm).join(', ')} cm`;
        else if (qty <= 0) error = 'Indica la cantidad de rollos';
        else if (weight <= 0) error = 'Indica el peso por rollo';
        else if (weight <= coreWeight) error = `El peso por rollo debe ser mayor al core (${coreWeight} g)`;
        else if (l.unit_price === '' || price < 0) error = 'Indica el precio por rollo';

        const plan = perPass ? passPlan(qty, perPass) : null;
        checks[l.key] = {
            raw,
            core,
            qty,
            weight,
            coreWeight,
            filmPerRoll,
            filmKg: kg,
            subtotal: qty * price,
            perPass,
            plan,
            allowedWidths,
            error,
            warning:
                !error && perPass && perPass > 1 && plan && plan.spare > 0
                    ? `En la última pasada quedan ${plan.spare} ${plan.spare === 1 ? 'pista' : 'pistas'} sin usar: considera ${plan.suggested} rollos`
                    : !error && coreWeight === 0
                      ? 'El core no tiene peso promedio definido (se toma 0 g)'
                      : null,
        };
        if (raw) filmByRaw[raw.id] = (filmByRaw[raw.id] || 0) + kg;
        if (core) unitsByCore[core.id] = (unitsByCore[core.id] || 0) + qty;
        subtotal += qty * price;
        rolls += qty;
        filmKg += kg;
    }

    // Stock combinado: si varias medidas comparten bobina o core, se suman
    if (checkStock) {
        for (const l of lines) {
            const c = checks[l.key];
            if (c.error || !c.raw || !c.core) continue;
            const needKg = filmByRaw[c.raw.id] || 0;
            const needUnits = unitsByCore[c.core.id] || 0;
            const shared = (n: number) => (n > 1 ? ' (sumando las medidas que la comparten)' : '');
            const rawLines = lines.filter((x) => x.raw_material_id === c.raw!.id).length;
            const coreLines = lines.filter((x) => x.core_id === c.core!.id).length;
            if (needKg > Number(c.raw.current_stock_kg))
                c.error = `Película insuficiente en "${c.raw.name}": se requieren ${fmtKg(needKg)} kg y hay ${fmtKg(
                    Number(c.raw.current_stock_kg)
                )} kg${shared(rawLines)}`;
            else if (needUnits > Number(c.core.current_stock_units))
                c.error = `Solo hay ${c.core.current_stock_units} cores de ${fmtCm(c.core.length_cm)} cm y se requieren ${needUnits}${shared(coreLines)}`;
        }
    }

    // Reservado para validar productos de bodega de la misma referencia
    const reserved: Record<string, number> = {};
    for (const [id, kg] of Object.entries(filmByRaw)) reserved[`bobina:${id}`] = kg;
    for (const [id, u] of Object.entries(unitsByCore)) reserved[`core:${id}`] = u;

    const firstKey = lines.find((l) => checks[l.key].error)?.key;
    const idx = firstKey === undefined ? -1 : lines.findIndex((l) => l.key === firstKey);
    return {
        checks,
        reserved,
        subtotal,
        rolls,
        filmKg,
        firstError: idx >= 0 ? `Medida ${idx + 1}: ${checks[firstKey!].error}` : null,
    };
}

/** Payload para la RPC create_order (p_stretch como arreglo) */
export function stretchPayload(lines: StretchLine[]) {
    return lines.map((l) => ({
        raw_material_id: l.raw_material_id,
        core_id: l.core_id,
        quantity: Math.floor(Number(l.quantity) || 0),
        weight_grams: Number(l.weight_grams) || 0,
        unit_price: Number(l.unit_price) || 0,
    }));
}
