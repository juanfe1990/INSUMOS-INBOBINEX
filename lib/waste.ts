import type { WasteKind, WasteReason } from '@/lib/types';

/** Causas de desperdicio (enum waste_reason) con las clases de producto donde aplican */
export const WASTE_REASONS: { value: WasteReason; label: string; kinds: WasteKind[] }[] = [
    { value: 'refile', label: 'Refile / bordes', kinds: ['bobina'] },
    { value: 'arranque', label: 'Arranque / cambio de bobina', kinds: ['bobina'] },
    { value: 'rollo_defectuoso', label: 'Rollo defectuoso / reproceso', kinds: ['bobina', 'core'] },
    { value: 'rotura', label: 'Rotura de película', kinds: ['bobina'] },
    { value: 'core_danado', label: 'Core dañado / mal armado', kinds: ['core', 'material_core'] },
    { value: 'dano_bodega', label: 'Daño en bodega o transporte', kinds: ['bobina', 'core', 'material_core', 'insumo'] },
    { value: 'obsoleto', label: 'Vencido / obsoleto', kinds: ['bobina', 'core', 'material_core', 'insumo'] },
    { value: 'otro', label: 'Otro', kinds: ['bobina', 'core', 'material_core', 'insumo'] },
];

export const WASTE_REASON_LABEL: Record<string, string> = Object.fromEntries(
    WASTE_REASONS.map((r) => [r.value, r.label])
);

export const WASTE_KIND_LABEL: Record<WasteKind, string> = {
    bobina: 'Bobina madre (película)',
    core: 'Cores armados',
    material_core: 'Material de cores',
    insumo: 'Otros inventarios',
};

export const reasonsFor = (kind: WasteKind) => WASTE_REASONS.filter((r) => r.kinds.includes(kind));
