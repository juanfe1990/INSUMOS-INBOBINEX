import type { SupabaseClient } from '@supabase/supabase-js';
import type { TreasuryAccountType, TreasuryMovementType } from '@/lib/types';

export const ACCOUNT_TYPE_LABELS: Record<TreasuryAccountType, string> = {
    caja_general: 'Caja general (efectivo)',
    banco: 'Cuenta bancaria',
    caja_menor: 'Caja menor',
};

export const ACCOUNT_TYPE_SHORT: Record<TreasuryAccountType, string> = {
    caja_general: 'Efectivo',
    banco: 'Banco',
    caja_menor: 'Caja menor',
};

/** Cuenta del PUC sugerida por tipo de cuenta */
export const DEFAULT_PUC: Record<TreasuryAccountType, string> = {
    caja_general: '110505',
    banco: '111005',
    caja_menor: '110510',
};

export const MOVEMENT_LABELS: Record<TreasuryMovementType, string> = {
    saldo_inicial: 'Saldo inicial',
    cobro_cliente: 'Cobro a cliente',
    pago_proveedor: 'Pago a proveedor',
    pago_gasto: 'Pago de gasto',
    transferencia_entrada: 'Transferencia recibida',
    transferencia_salida: 'Transferencia enviada',
    otro_ingreso: 'Otro ingreso',
    otro_egreso: 'Otro egreso',
    ajuste: 'Ajuste / arqueo',
};

/** Movimientos que deberían tener soporte (comprobante) */
export const NEEDS_SUPPORT: TreasuryMovementType[] = ['pago_proveedor', 'pago_gasto', 'otro_egreso'];

export const SUPPORT_BUCKET = 'soportes';
export const MAX_SUPPORT_MB = 10;

/** Sube un soporte (imagen o PDF) y devuelve su ruta en Storage */
export async function uploadSupport(supabase: SupabaseClient<any>, file: File, folder: string): Promise<string> {
    if (file.size > MAX_SUPPORT_MB * 1024 * 1024) {
        throw new Error(`El archivo supera ${MAX_SUPPORT_MB} MB`);
    }
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(SUPPORT_BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
    });
    if (error) throw error;
    return path;
}

/** Abre un soporte privado con un enlace temporal (5 minutos) */
export async function openSupport(supabase: SupabaseClient<any>, path: string) {
    const { data, error } = await supabase.storage.from(SUPPORT_BUCKET).createSignedUrl(path, 300);
    if (error || !data?.signedUrl) throw error || new Error('No se pudo abrir el soporte');
    window.open(data.signedUrl, '_blank', 'noopener');
}

export const signedAmount = (direction: 'ingreso' | 'egreso', amount: number) =>
    direction === 'ingreso' ? Number(amount) : -Number(amount);
