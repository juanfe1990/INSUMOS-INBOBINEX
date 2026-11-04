'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { TreasuryAccount } from '@/lib/types';
import { formatCOP } from '@/components/admin/suppliers/utils';
import { ACCOUNT_TYPE_SHORT } from './utils';

/**
 * Selector de cuenta de tesorería (caja / banco / caja menor) para los formularios de pago.
 * Al elegir una cuenta, el pago genera automáticamente su movimiento de caja/banco.
 * `onLoaded` permite al padre preseleccionar según el medio de pago.
 */
export default function AccountSelect({
    value,
    onChange,
    className,
    excludeTypes = [],
    onLoaded,
}: {
    value: string;
    onChange: (id: string) => void;
    className?: string;
    excludeTypes?: TreasuryAccount['account_type'][];
    onLoaded?: (accounts: TreasuryAccount[]) => void;
}) {
    const [supabase] = useState(() => createClient());
    const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);

    useEffect(() => {
        supabase
            .from('treasury_accounts')
            .select('*')
            .eq('is_active', true)
            .order('account_type')
            .order('name')
            .then(({ data }) => {
                const list = ((data || []) as TreasuryAccount[]).filter((a) => !excludeTypes.includes(a.account_type));
                setAccounts(list);
                onLoaded?.(list);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supabase]);

    return (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
            <option value="">— Sin cuenta (no mueve caja/banco) —</option>
            {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                    {a.name} · {ACCOUNT_TYPE_SHORT[a.account_type]} · saldo {formatCOP(Number(a.current_balance))}
                </option>
            ))}
        </select>
    );
}

/** Cuenta sugerida según el medio de pago: efectivo → caja general; resto → primer banco */
export function suggestAccount(accounts: TreasuryAccount[], method: string): string {
    if (method === 'efectivo') return accounts.find((a) => a.account_type === 'caja_general')?.id || '';
    return accounts.find((a) => a.account_type === 'banco')?.id || '';
}
