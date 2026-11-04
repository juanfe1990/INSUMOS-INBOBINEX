'use client';

import { useState } from 'react';
import { FileBarChart2, Gauge } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import FinancialDashboard from './financial-dashboard';
import IncomeStatement from './income-statement';

type View = 'indicadores' | 'resultados';

/** Indicadores financieros con alertas tempranas + estado de resultados */
export default function FinancePanel() {
    const { profile } = useAuth();
    const [view, setView] = useState<View>('indicadores');

    if (profile?.role !== 'admin') {
        return (
            <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center text-sm text-[#949E97]">
                Los indicadores financieros solo están disponibles para administradores.
            </div>
        );
    }

    const tab = (v: View, label: string, Icon: React.ComponentType<{ className?: string }>) => (
        <button
            onClick={() => setView(v)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                view === v ? 'bg-[#2E4040] text-white shadow-sm' : 'border border-[#C8CDC9] bg-white text-[#2E4040] hover:bg-[#C8CDC9]/20'
            }`}
        >
            <Icon className="h-3.5 w-3.5 text-[#3F8346]" />
            {label}
        </button>
    );

    return (
        <div className="space-y-6">
            <div className="print:hidden">
                <h2 className="font-heading text-2xl font-bold text-[#2E4040]">Indicadores Financieros</h2>
                <p className="text-sm text-[#949E97]">
                    Salud financiera de la empresa con alertas tempranas por proceso y estado de resultados con filtros.
                </p>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-[#C8CDC9]/80 pb-2 print:hidden">
                {tab('indicadores', 'Panel de indicadores y alertas', Gauge)}
                {tab('resultados', 'Estado de resultados', FileBarChart2)}
            </div>
            {view === 'indicadores' ? <FinancialDashboard /> : <IncomeStatement />}
        </div>
    );
}
