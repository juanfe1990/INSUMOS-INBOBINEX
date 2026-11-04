'use client';

import { useRef, useState } from 'react';
import { FileCheck2, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { openSupport, uploadSupport } from './utils';

/**
 * Botón para adjuntar / ver el soporte (foto o PDF) de un movimiento de tesorería.
 * Guarda la ruta en `treasury_movements.support_path`.
 */
export default function SupportButton({
    movementId,
    path,
    onChanged,
    compact,
}: {
    movementId: string;
    path: string | null;
    onChanged: () => void;
    compact?: boolean;
}) {
    const [supabase] = useState(() => createClient());
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            setBusy(true);
            const newPath = await uploadSupport(supabase, file, 'movimientos');
            const { data, error } = await supabase
                .from('treasury_movements')
                .update({ support_path: newPath })
                .eq('id', movementId)
                .select('id');
            if (error) throw error;
            if (!data?.length) throw new Error('Sin permiso para adjuntar soportes');
            toast.success('Soporte adjuntado');
            onChanged();
        } catch (err: any) {
            toast.error('No se pudo adjuntar: ' + (err?.message || 'Error'));
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    if (path) {
        return (
            <button
                type="button"
                onClick={() => openSupport(supabase, path).catch((e) => toast.error(e.message))}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                title="Ver soporte"
            >
                <FileCheck2 className="h-3.5 w-3.5" />
                {!compact && 'Ver soporte'}
            </button>
        );
    }

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#949E97] px-2 py-1 text-[11px] font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20 disabled:opacity-50"
                title="Adjuntar soporte (foto o PDF)"
            >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                {!compact && 'Adjuntar'}
            </button>
        </>
    );
}
