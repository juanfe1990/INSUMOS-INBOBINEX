'use client';

import { useState } from 'react';
import { FileBarChart2, Gauge, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import FinancialDashboard from './financial-dashboard';
import IncomeStatement from './income-statement';
import ClientsDashboard from '@/components/admin/clients/clients-dashboard';

type View = 'indicadores' | 'resultados' | 'clientes';

/**
 * Dashboard unificado: indicadores financieros con alertas, estado de resultados
 * y estadísticas de clientes y ventas. Los vendedores solo ven Clientes y ventas
 * (lo financiero es solo para administradores).
 */
export default function FinancePanel() {
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'admin';
    const canSeeClients = isAdmin || profile?.role === 'vendedor';
    const [view, setView] = useState<View>(isAdmin ? 'indicadores' : 'clientes');

    if (!canSeeClients) {
        return (
            <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                El dashboard está disponible para administradores y vendedores.
            </div>
        );
    }

    // Si el rol cambia (o aún cargaba), no dejar a un vendedor en una vista financiera
    const current: View = isAdmin ? view : 'clientes';

    const tab = (v: View, label: string, Icon: React.ComponentType<{ className?: string }>) => (
        <button
            onClick={() => setView(v)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                current === v ? 'bg-[#2E4040] text-white shadow-sm' : 'border border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
            }`}
        >
            <Icon className="h-3.5 w-3.5 text-[#3F8346]" />
            {label}
        </button>
    );

    return (
        <div className="space-y-6">
            <div className="print:hidden">
                <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Dashboard</h2>
                <p className="text-sm text-[#949E97]">
                    {isAdmin
                        ? 'Salud financiera con alertas tempranas, estado de resultados y estadísticas de clientes y ventas.'
                        : 'Estadísticas de clientes y ventas por rango de fechas.'}
                </p>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-[#C8CDC9]/80 pb-2 print:hidden">
                {isAdmin && tab('indicadores', 'Indicadores y alertas', Gauge)}
                {isAdmin && tab('resultados', 'Estado de resultados', FileBarChart2)}
                {tab('clientes', 'Clientes y ventas', Users)}
            </div>
            {current === 'indicadores' && <FinancialDashboard />}
            {current === 'resultados' && <IncomeStatement />}
            {current === 'clientes' && <ClientsDashboard />}
        </div>
    );
}
