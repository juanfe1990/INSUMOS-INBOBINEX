'use client';

import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ConfirmOptions = {
    title: string;
    description?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 'danger' = botón rojo (borrados). 'default' = verde corporativo. */
    variant?: 'danger' | 'default';
};

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void };

/**
 * Reemplazo no bloqueante de window.confirm().
 *
 *   const [confirmDialog, confirm] = useConfirm();
 *   if (!(await confirm({ title: '¿Eliminar?' }))) return;
 *   ...
 *   return <>{confirmDialog}...</>
 */
export function useConfirm(): [React.ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback(
        (opts: ConfirmOptions) =>
            new Promise<boolean>((resolve) => {
                setPending({ ...opts, resolve });
            }),
        [],
    );

    const close = useCallback(
        (ok: boolean) => {
            pending?.resolve(ok);
            setPending(null);
        },
        [pending],
    );

    const dialog = pending ? <ConfirmDialog {...pending} onClose={close} /> : null;
    return [dialog, confirm];
}

function ConfirmDialog({
    title,
    description,
    confirmLabel = 'Confirmar',
    cancelLabel = 'Cancelar',
    variant = 'danger',
    onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
    const confirmRef = useRef<HTMLButtonElement>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        confirmRef.current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const isDanger = variant === 'danger';

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-[#2E4040]/50 p-4 backdrop-blur-[1px]"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose(false);
            }}
            role="presentation"
        >
            <div
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="confirm-dialog-title"
                className="w-full max-w-sm rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl"
            >
                <div className="flex items-start gap-3 p-5">
                    <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                            isDanger ? 'bg-red-100 text-red-600' : 'bg-[#3F8346]/10 text-[#3F8346]'
                        }`}
                    >
                        <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 id="confirm-dialog-title" className="text-sm font-bold text-[#2E4040]">
                            {title}
                        </h3>
                        {description && (
                            <div className="mt-1.5 text-xs leading-relaxed text-[#949E97]">{description}</div>
                        )}
                    </div>
                    <button
                        onClick={() => onClose(false)}
                        className="rounded-md p-1 text-[#949E97] hover:bg-[#C8CDC9]/30 hover:text-[#2E4040]"
                        aria-label="Cerrar"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex justify-end gap-2 border-t border-[#C8CDC9] px-5 py-3">
                    <button
                        onClick={() => onClose(false)}
                        className="rounded-md border border-[#C8CDC9] px-4 py-1.5 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        ref={confirmRef}
                        disabled={busy}
                        onClick={() => {
                            setBusy(true);
                            onClose(true);
                        }}
                        className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60 ${
                            isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-[#3F8346] hover:bg-[#2d6332]'
                        }`}
                    >
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
