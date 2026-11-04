import type {
    PaymentMethod,
    PurchaseInvoice,
    PurchaseInvoiceStatus,
    PurchaseItemType,
    SupplierCategory,
} from '@/lib/types';

export const INPUT =
    'w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none';
export const LABEL = 'block text-[10px] font-semibold text-[#949E97] mb-1';

export const CATEGORY_LABELS: Record<SupplierCategory, string> = {
    materia_prima: 'Materia prima (bobinas)',
    cores_tubos: 'Cores / tubos',
    insumos: 'Insumos y empaque',
    servicios: 'Servicios',
    transporte: 'Transporte',
    otro: 'Otro',
};

export const STATUS_CONFIG: Record<PurchaseInvoiceStatus, { label: string; cls: string }> = {
    pendiente: { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' },
    parcial: { label: 'Abono parcial', cls: 'bg-blue-100 text-blue-800' },
    pagada: { label: 'Pagada', cls: 'bg-emerald-100 text-emerald-800' },
    anulada: { label: 'Anulada', cls: 'bg-gray-200 text-gray-600 line-through' },
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
    transferencia: 'Transferencia',
    efectivo: 'Efectivo',
    cheque: 'Cheque',
    tarjeta: 'Tarjeta',
    otro: 'Otro',
};

export const ITEM_TYPE_LABELS: Record<PurchaseItemType, string> = {
    bobina: 'Bobina madre (kg)',
    core: 'Material cores (kg)',
    insumo: 'Insumo / producto',
    otro: 'Otro gasto',
};

/** IVA general en Colombia */
export const DEFAULT_VAT_RATE = 0.19;

export const formatCOP = (n: number) =>
    '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');

export const formatNumber = (n: number, digits = 2) =>
    (Number(n) || 0).toLocaleString('es-CO', { maximumFractionDigits: digits });

/** 'YYYY-MM-DD' de hoy en hora local (no UTC) */
export function todayISO(): string {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

/** Días entre hoy y la fecha (negativo = vencida hace N días) */
export function daysUntil(iso: string): number {
    const today = new Date(todayISO() + 'T00:00:00').getTime();
    const target = new Date(iso + 'T00:00:00').getTime();
    return Math.round((target - today) / 86400000);
}

export function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

export const balanceOf = (inv: Pick<PurchaseInvoice, 'total' | 'paid_amount' | 'status'>) =>
    inv.status === 'anulada' ? 0 : Math.max(Number(inv.total) - Number(inv.paid_amount), 0);

export const isOpen = (inv: Pick<PurchaseInvoice, 'status'>) =>
    inv.status === 'pendiente' || inv.status === 'parcial';

export type AgingBucket = 'por_vencer' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_mas';

export const AGING_LABELS: Record<AgingBucket, string> = {
    por_vencer: 'Por vencer',
    d1_30: 'Vencidas 1–30 días',
    d31_60: 'Vencidas 31–60 días',
    d61_90: 'Vencidas 61–90 días',
    d90_mas: 'Vencidas +90 días',
};

export function agingBucket(dueISO: string): AgingBucket {
    const d = daysUntil(dueISO);
    if (d >= 0) return 'por_vencer';
    const overdue = -d;
    if (overdue <= 30) return 'd1_30';
    if (overdue <= 60) return 'd31_60';
    if (overdue <= 90) return 'd61_90';
    return 'd90_mas';
}

/** Dígito de verificación del NIT según el algoritmo de la DIAN */
export function computeNitDV(nit: string): number | null {
    const digits = nit.replace(/\D/g, '');
    if (!digits || digits.length > 15) return null;
    const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        sum += Number(digits[digits.length - 1 - i]) * weights[i];
    }
    const r = sum % 11;
    return r > 1 ? 11 - r : r;
}

/** Descarga un CSV compatible con Excel (separador ';' y BOM UTF-8) */
export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
    const esc = (v: string | number) => {
        const s = String(v ?? '');
        return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/** Mensaje legible para errores de Postgres/Supabase */
export function dbErrorMessage(err: any): string {
    if (err?.code === '23505') {
        if (String(err.message).includes('purchase_invoices_supplier_number_key')) {
            return 'Ya existe una factura con ese número para este proveedor.';
        }
        if (String(err.message).includes('suppliers_nit_key')) {
            return 'Ya existe un proveedor con ese NIT.';
        }
        return 'Registro duplicado.';
    }
    if (err?.code === '23503') return 'El registro tiene información asociada y no se puede eliminar.';
    return err?.message || 'Error desconocido';
}
