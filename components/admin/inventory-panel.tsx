'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import type { RawMaterial, CoreSpecification, InventoryTransaction, InventoryMovementType } from '@/lib/types';
import {
    Package,
    Layers,
    History,
    Plus,
    Loader2,
    Search,
    AlertTriangle,
    ArrowDownRight,
    ArrowUpRight,
    RefreshCw,
    SlidersHorizontal,
    DollarSign,
    Weight,
    FileSpreadsheet,
    Calendar,
    User,
    CheckCircle2,
    X,
} from 'lucide-react';
import { toast } from 'sonner';

const MOVEMENT_CONFIG: Record<
    InventoryMovementType,
    { label: string; bg: string; text: string; icon: any; isPositive: boolean }
> = {
    entrada_compra: {
        label: 'Entrada / Compra',
        bg: 'bg-emerald-50 border-emerald-200',
        text: 'text-emerald-700',
        icon: ArrowUpRight,
        isPositive: true,
    },
    produccion_core: {
        label: 'Corte de Core',
        bg: 'bg-blue-50 border-blue-200',
        text: 'text-blue-700',
        icon: ArrowUpRight,
        isPositive: true,
    },
    consumo_pedido: {
        label: 'Consumo Pedido',
        bg: 'bg-purple-50 border-purple-200',
        text: 'text-purple-700',
        icon: ArrowDownRight,
        isPositive: false,
    },
    merma_desperdicio: {
        label: 'Merma / Scrap',
        bg: 'bg-amber-50 border-amber-200',
        text: 'text-amber-700',
        icon: ArrowDownRight,
        isPositive: false,
    },
    ajuste_manual: {
        label: 'Ajuste Manual',
        bg: 'bg-gray-100 border-gray-200',
        text: 'text-gray-700',
        icon: SlidersHorizontal,
        isPositive: true,
    },
};

export default function InventoryPanel() {
    const supabase = createClient();
    const { user, profile } = useAuth();

    // Pestañas internas
    const [subTab, setSubTab] = useState<'raw' | 'cores' | 'kardex'>('raw');
    const [loading, setLoading] = useState(true);

    // Datos principales
    const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
    const [cores, setCores] = useState<CoreSpecification[]>([]);
    const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);

    // Filtros Kardex
    const [kardexFilterType, setKardexFilterType] = useState<string>('all');
    const [kardexSearch, setKardexSearch] = useState<string>('');

    // Modales
    const [showRawEntryModal, setShowRawEntryModal] = useState(false);
    const [selectedRawForEntry, setSelectedRawForEntry] = useState<RawMaterial | null>(null);
    const [rawEntryKg, setRawEntryKg] = useState<string>('');
    const [rawEntryCost, setRawEntryCost] = useState<string>('');
    const [rawEntryNotes, setRawEntryNotes] = useState<string>('');

    const [showNewRawModal, setShowNewRawModal] = useState(false);
    const [newRawName, setNewRawName] = useState('');
    const [newRawColor, setNewRawColor] = useState('transparente');
    const [newRawWidth, setNewRawWidth] = useState('50');
    const [newRawCost, setNewRawCost] = useState('9500');
    const [newRawMinStock, setNewRawMinStock] = useState('100');

    const [showCoreModal, setShowCoreModal] = useState(false);
    const [selectedCoreForEntry, setSelectedCoreForEntry] = useState<CoreSpecification | null>(null);
    const [coreEntryUnits, setCoreEntryUnits] = useState<string>('');
    const [coreEntryNotes, setCoreEntryNotes] = useState<string>('');

    const [showEditCoreCostModal, setShowEditCoreCostModal] = useState(false);
    const [editingCore, setEditingCore] = useState<CoreSpecification | null>(null);
    const [editCoreCost, setEditCoreCost] = useState<string>('');

    const [saving, setSaving] = useState(false);

    // Cargar información completa de inventario
    const fetchInventoryData = async () => {
        try {
            setLoading(true);
            const [rawRes, coresRes, transRes] = await Promise.all([
                supabase.from('raw_materials').select('*').order('width_cm', { ascending: true }),
                supabase.from('core_specifications').select('*').order('length_cm', { ascending: true }),
                supabase
                    .from('inventory_transactions')
                    .select(`
                        *,
                        raw_material:raw_materials(*),
                        core:core_specifications(*),
                        creator:profiles(id, full_name, email)
                    `)
                    .order('created_at', { ascending: false })
                    .limit(100),
            ]);

            if (rawRes.data) setRawMaterials(rawRes.data as RawMaterial[]);
            if (coresRes.data) setCores(coresRes.data as CoreSpecification[]);
            if (transRes.data) setTransactions(transRes.data as unknown as InventoryTransaction[]);
        } catch (err: any) {
            toast.error('Error al cargar inventario: ' + (err.message || 'Error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInventoryData();

        // Realtime para transacciones de inventario
        const channel = supabase
            .channel('realtime-inventory')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_transactions' }, () => {
                fetchInventoryData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_materials' }, () => {
                fetchInventoryData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'core_specifications' }, () => {
                fetchInventoryData();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // KPIs calculados
    const totalRawKg = useMemo(() => {
        return rawMaterials.reduce((acc, m) => acc + Number(m.current_stock_kg || 0), 0);
    }, [rawMaterials]);

    const totalRawValue = useMemo(() => {
        return rawMaterials.reduce(
            (acc, m) => acc + Number(m.current_stock_kg || 0) * Number(m.cost_per_kg || 0),
            0
        );
    }, [rawMaterials]);

    const totalCoresCount = useMemo(() => {
        return cores.reduce((acc, c) => acc + Number(c.current_stock_units || 0), 0);
    }, [cores]);

    const totalCoresValue = useMemo(() => {
        return cores.reduce(
            (acc, c) => acc + Number(c.current_stock_units || 0) * Number(c.standard_cost || 0),
            0
        );
    }, [cores]);

    const lowStockAlerts = useMemo(() => {
        const rawAlerts = rawMaterials.filter((m) => Number(m.current_stock_kg) <= Number(m.min_stock_alert_kg || 50));
        const coreAlerts = cores.filter((c) => Number(c.current_stock_units) <= Number(c.min_stock_alert_units || 30));
        return {
            count: rawAlerts.length + coreAlerts.length,
            rawAlerts,
            coreAlerts,
        };
    }, [rawMaterials, cores]);

    // Filtrar Kardex
    const filteredTransactions = useMemo(() => {
        return transactions.filter((t) => {
            if (kardexFilterType !== 'all' && t.movement_type !== kardexFilterType) {
                return false;
            }
            if (kardexSearch.trim() !== '') {
                const q = kardexSearch.toLowerCase();
                const matName = t.raw_material?.name?.toLowerCase() || '';
                const coreName = t.core?.name?.toLowerCase() || '';
                const creator = t.creator?.full_name?.toLowerCase() || '';
                const notes = t.notes?.toLowerCase() || '';
                return matName.includes(q) || coreName.includes(q) || creator.includes(q) || notes.includes(q);
            }
            return true;
        });
    }, [transactions, kardexFilterType, kardexSearch]);

    // Registrar Entrada de Bobina Madre (Compra)
    const handleSaveRawEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRawForEntry || !rawEntryKg || Number(rawEntryKg) <= 0) {
            toast.error('Ingresa una cantidad válida en kilos');
            return;
        }

        try {
            setSaving(true);
            const kg = Number(rawEntryKg);
            const cost = rawEntryCost ? Number(rawEntryCost) : Number(selectedRawForEntry.cost_per_kg);
            const currentStock = Number(selectedRawForEntry.current_stock_kg);
            const newStock = currentStock + kg;

            // 1. Actualizar stock y costo en raw_materials
            const { error: updateError } = await supabase
                .from('raw_materials')
                .update({
                    current_stock_kg: newStock,
                    cost_per_kg: cost,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', selectedRawForEntry.id);

            if (updateError) throw updateError;

            const { data: authData } = await supabase.auth.getUser();
            const creatorId = authData?.user?.id || user?.id;
            if (!creatorId) {
                toast.error('Sesión de usuario requerida');
                return;
            }

            // 2. Registrar en Kardex (inventory_transactions)
            const { error: transError } = await supabase.from('inventory_transactions').insert({
                movement_type: 'entrada_compra',
                raw_material_id: selectedRawForEntry.id,
                quantity: kg,
                unit_cost: cost,
                total_cost: kg * cost,
                notes: rawEntryNotes || 'Ingreso / Compra de bobina madre',
                created_by: creatorId,
            });

            if (transError) throw transError;

            toast.success(`Se ingresaron +${kg.toLocaleString()} kg a ${selectedRawForEntry.name}`);
            setShowRawEntryModal(false);
            setRawEntryKg('');
            setRawEntryCost('');
            setRawEntryNotes('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al registrar entrada: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Crear Nueva Materia Prima (Bobina Madre)
    const handleCreateRawMaterial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRawName.trim()) {
            toast.error('Ingresa el nombre del material');
            return;
        }

        try {
            setSaving(true);
            const { error } = await supabase.from('raw_materials').insert({
                name: newRawName.trim(),
                material_type: 'stretch',
                color: newRawColor,
                width_cm: Number(newRawWidth),
                cost_per_kg: Number(newRawCost) || 0,
                min_stock_alert_kg: Number(newRawMinStock) || 50,
                current_stock_kg: 0,
            });

            if (error) throw error;

            toast.success('Nueva materia prima creada con éxito');
            setShowNewRawModal(false);
            setNewRawName('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al crear materia prima: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Registrar Entrada / Corte de Cores
    const handleSaveCoreEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCoreForEntry || !coreEntryUnits || Number(coreEntryUnits) <= 0) {
            toast.error('Ingresa una cantidad válida de unidades');
            return;
        }

        try {
            setSaving(true);
            const units = Math.floor(Number(coreEntryUnits));
            const cost = Number(selectedCoreForEntry.standard_cost || 0);
            const currentStock = Number(selectedCoreForEntry.current_stock_units || 0);
            const newStock = currentStock + units;

            // 1. Actualizar stock en core_specifications
            const { error: updateError } = await supabase
                .from('core_specifications')
                .update({
                    current_stock_units: newStock,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', selectedCoreForEntry.id);

            if (updateError) throw updateError;

            const { data: authData } = await supabase.auth.getUser();
            const creatorId = authData?.user?.id || user?.id;
            if (!creatorId) {
                toast.error('Sesión de usuario requerida');
                return;
            }

            // 2. Registrar en Kardex
            const { error: transError } = await supabase.from('inventory_transactions').insert({
                movement_type: 'produccion_core',
                core_id: selectedCoreForEntry.id,
                quantity: units,
                unit_cost: cost,
                total_cost: units * cost,
                notes: coreEntryNotes || 'Corte de cores registrado en administración',
                created_by: creatorId,
            });

            if (transError) throw transError;

            toast.success(`Se sumaron +${units} unidades de ${selectedCoreForEntry.name}`);
            setShowCoreModal(false);
            setCoreEntryUnits('');
            setCoreEntryNotes('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error registrando cores: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Actualizar Costo Estándar de Core
    const handleUpdateCoreCost = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingCore || !editCoreCost || Number(editCoreCost) < 0) {
            toast.error('Ingresa un costo válido');
            return;
        }

        try {
            setSaving(true);
            const cost = Number(editCoreCost);
            const { error } = await supabase
                .from('core_specifications')
                .update({
                    standard_cost: cost,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', editingCore.id);

            if (error) throw error;

            toast.success(`Costo unitario de ${editingCore.name} actualizado a $${cost.toLocaleString()} COP`);
            setShowEditCoreCostModal(false);
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error actualizando costo: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header del módulo */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">
                        Control de Inventarios & Costos (Kardex)
                    </h2>
                    <p className="text-sm text-[#949E97]">
                        Materia prima en kilos, cores cortados por operarios y auditoría de consumos
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchInventoryData}
                        className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-3.5 py-2 text-xs font-semibold text-[#2E4040] shadow-sm transition hover:bg-[#C8CDC9]/20"
                    >
                        <RefreshCw className="h-3.5 w-3.5 text-[#3F8346]" />
                        Refrescar
                    </button>
                    {subTab === 'raw' && (
                        <>
                            <button
                                onClick={() => setShowNewRawModal(true)}
                                className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-4 py-2 text-xs font-semibold text-[#2E4040] shadow-sm transition hover:bg-[#C8CDC9]/20"
                            >
                                <Plus className="h-4 w-4" />
                                Nueva Medida
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedRawForEntry(rawMaterials[0] || null);
                                    setShowRawEntryModal(true);
                                }}
                                className="flex items-center gap-2 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-[#FDFDFD] shadow-sm transition hover:bg-[#2d6332]"
                            >
                                <Plus className="h-4 w-4" />
                                Registrar Compra / Entrada (Kg)
                            </button>
                        </>
                    )}
                    {subTab === 'cores' && (
                        <button
                            onClick={() => {
                                setSelectedCoreForEntry(cores[0] || null);
                                setShowCoreModal(true);
                            }}
                            className="flex items-center gap-2 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-[#FDFDFD] shadow-sm transition hover:bg-[#2d6332]"
                        >
                            <Plus className="h-4 w-4" />
                            Ingresar Cores Cortados
                        </button>
                    )}
                </div>
            </div>

            {/* KPI Cards de Inventario */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* 1. Kilos Totales de Película */}
                <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">
                            Película en Bodega
                        </span>
                        <div className="rounded-lg bg-[#3F8346]/10 p-2 text-[#3F8346]">
                            <Weight className="h-5 w-5" />
                        </div>
                    </div>
                    <div className="mt-3">
                        <div className="text-2xl font-bold text-[#2E4040]">
                            {totalRawKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-sm font-medium text-gray-500">kg</span>
                        </div>
                        <div className="mt-1 text-xs text-[#3F8346] font-medium">
                            Valoración: ${totalRawValue.toLocaleString('es-CO')} COP
                        </div>
                    </div>
                </div>

                {/* 2. Cores en Stock */}
                <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">
                            Cores en Stock
                        </span>
                        <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                            <Layers className="h-5 w-5" />
                        </div>
                    </div>
                    <div className="mt-3">
                        <div className="text-2xl font-bold text-[#2E4040]">
                            {totalCoresCount.toLocaleString()} <span className="text-sm font-medium text-gray-500">tubos</span>
                        </div>
                        <div className="mt-1 text-xs text-blue-600 font-medium">
                            Valoración: ${totalCoresValue.toLocaleString('es-CO')} COP
                        </div>
                    </div>
                </div>

                {/* 3. Valor Total de Inventario */}
                <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">
                            Valor Total Inventario
                        </span>
                        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
                            <DollarSign className="h-5 w-5" />
                        </div>
                    </div>
                    <div className="mt-3">
                        <div className="text-2xl font-bold text-[#2E4040]">
                            ${(totalRawValue + totalCoresValue).toLocaleString('es-CO')}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 font-medium">
                            Película madre + tubos cartón
                        </div>
                    </div>
                </div>

                {/* 4. Alertas de Reorden */}
                <div className="rounded-xl border border-[#C8CDC9]/60 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-[#949E97]">
                            Alertas de Stock
                        </span>
                        <div
                            className={`rounded-lg p-2 ${
                                lowStockAlerts.count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-50 text-green-600'
                            }`}
                        >
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                    </div>
                    <div className="mt-3">
                        <div className="text-2xl font-bold text-[#2E4040]">
                            {lowStockAlerts.count}{' '}
                            <span className="text-sm font-medium text-gray-500">
                                {lowStockAlerts.count === 1 ? 'material bajo' : 'materiales bajos'}
                            </span>
                        </div>
                        <div className="mt-1 text-xs text-amber-600 font-medium">
                            {lowStockAlerts.count > 0 ? 'Requieren compra o corte' : 'Niveles óptimos de stock'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Sub-navegación de Inventario */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[#C8CDC9]/80 pb-2">
                <button
                    onClick={() => setSubTab('raw')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                        subTab === 'raw'
                            ? 'bg-[#2E4040] text-white shadow-sm'
                            : 'bg-white text-[#2E4040] border border-[#C8CDC9] hover:bg-[#C8CDC9]/20'
                    }`}
                >
                    <Weight className="h-3.5 w-3.5 text-[#3F8346]" />
                    Bobinas Madre (Película en Kg)
                </button>
                <button
                    onClick={() => setSubTab('cores')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                        subTab === 'cores'
                            ? 'bg-[#2E4040] text-white shadow-sm'
                            : 'bg-white text-[#2E4040] border border-[#C8CDC9] hover:bg-[#C8CDC9]/20'
                    }`}
                >
                    <Layers className="h-3.5 w-3.5 text-[#3F8346]" />
                    Cores / Tubos (Unidades por Medida)
                </button>
                <button
                    onClick={() => setSubTab('kardex')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                        subTab === 'kardex'
                            ? 'bg-[#2E4040] text-white shadow-sm'
                            : 'bg-white text-[#2E4040] border border-[#C8CDC9] hover:bg-[#C8CDC9]/20'
                    }`}
                >
                    <History className="h-3.5 w-3.5 text-[#3F8346]" />
                    Kardex & Auditoría ({transactions.length} registros)
                </button>
            </div>

            {/* ============================================================== */}
            {/* SUBTAB 1: BOBINAS MADRE                                         */}
            {/* ============================================================== */}
            {subTab === 'raw' && (
                <div className="space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : rawMaterials.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                            <Weight className="mx-auto h-12 w-12 text-[#949E97]" />
                            <h3 className="mt-3 text-base font-semibold text-[#2E4040]">No hay bobinas madre registradas</h3>
                            <p className="mt-1 text-xs text-[#949E97]">
                                Ejecuta el script SQL o presiona "Nueva Medida" para agregar bobinas de 45, 50 o 60 cm.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                            <table className="w-full text-left text-xs">
                                <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                                    <tr>
                                        <th className="px-5 py-3.5 font-semibold">Material / Color</th>
                                        <th className="px-4 py-3.5 font-semibold">Ancho</th>
                                        <th className="px-4 py-3.5 font-semibold">Stock Actual</th>
                                        <th className="px-4 py-3.5 font-semibold">Costo / Kg</th>
                                        <th className="px-4 py-3.5 font-semibold">Valor Total</th>
                                        <th className="px-4 py-3.5 font-semibold">Estado Stock</th>
                                        <th className="px-4 py-3.5 text-right font-semibold">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/40">
                                    {rawMaterials.map((m) => {
                                        const stock = Number(m.current_stock_kg || 0);
                                        const minAlert = Number(m.min_stock_alert_kg || 100);
                                        const isLow = stock <= minAlert;
                                        const isCritical = stock <= minAlert * 0.4;
                                        const totalVal = stock * Number(m.cost_per_kg || 0);

                                        return (
                                            <tr key={m.id} className="hover:bg-[#F9FBFA] transition-colors">
                                                <td className="px-5 py-4 font-medium text-[#2E4040]">
                                                    <div className="flex items-center gap-2.5">
                                                        <span
                                                            className={`h-3 w-3 rounded-full border ${
                                                                m.color === 'negro'
                                                                    ? 'bg-slate-900 border-slate-700'
                                                                    : m.color === 'azul'
                                                                    ? 'bg-blue-600 border-blue-700'
                                                                    : 'bg-emerald-100 border-emerald-400'
                                                            }`}
                                                        />
                                                        <div>
                                                            <div className="font-semibold text-sm">{m.name}</div>
                                                            <div className="text-[11px] text-[#949E97] capitalize">
                                                                Color: {m.color}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-[#2E4040] font-semibold text-sm">
                                                    {m.width_cm} cm
                                                </td>
                                                <td className="px-4 py-4 font-bold text-sm text-[#2E4040]">
                                                    {stock.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg
                                                </td>
                                                <td className="px-4 py-4 font-medium text-gray-700">
                                                    ${Number(m.cost_per_kg || 0).toLocaleString('es-CO')} COP
                                                </td>
                                                <td className="px-4 py-4 font-semibold text-[#3F8346]">
                                                    ${totalVal.toLocaleString('es-CO')} COP
                                                </td>
                                                <td className="px-4 py-4">
                                                    {isCritical ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
                                                            <AlertTriangle className="h-3 w-3" /> Crítico
                                                        </span>
                                                    ) : isLow ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                                                            <AlertTriangle className="h-3 w-3" /> Bajo
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                                                            <CheckCircle2 className="h-3 w-3" /> Óptimo
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 text-right">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedRawForEntry(m);
                                                            setRawEntryCost(String(m.cost_per_kg || ''));
                                                            setShowRawEntryModal(true);
                                                        }}
                                                        className="inline-flex items-center gap-1.5 rounded-md bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] transition"
                                                    >
                                                        <Plus className="h-3 w-3" />
                                                        + Entrada Kg
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ============================================================== */}
            {/* SUBTAB 2: CORES                                                 */}
            {/* ============================================================== */}
            {subTab === 'cores' && (
                <div className="space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : cores.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                            <Layers className="mx-auto h-12 w-12 text-[#949E97]" />
                            <h3 className="mt-3 text-base font-semibold text-[#2E4040]">No hay cores registrados</h3>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {cores.map((c) => {
                                const stock = Number(c.current_stock_units || 0);
                                const cost = Number(c.standard_cost || 0);
                                const isLow = stock <= Number(c.min_stock_alert_units || 30);

                                return (
                                    <div
                                        key={c.id}
                                        className="rounded-xl border border-[#C8CDC9]/70 bg-white p-5 shadow-sm transition hover:shadow-md"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <span className="inline-block rounded-md bg-[#2E4040]/10 px-2 py-0.5 text-xs font-bold text-[#2E4040]">
                                                    Medida: {c.length_cm} cm
                                                </span>
                                                <h4 className="mt-2 text-base font-bold text-[#2E4040]">{c.name}</h4>
                                            </div>
                                            <div
                                                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                                    isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                                                }`}
                                            >
                                                {isLow ? 'Stock Bajo' : 'Disponible'}
                                            </div>
                                        </div>

                                        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-[#F8F9FA] p-3 text-xs">
                                            <div>
                                                <div className="text-[#949E97]">Stock Actual:</div>
                                                <div className="text-xl font-bold text-[#2E4040]">
                                                    {stock} <span className="text-xs font-normal text-gray-500">tubos</span>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-[#949E97]">Costo Unitario:</div>
                                                <div className="text-sm font-bold text-[#3F8346]">
                                                    ${cost.toLocaleString('es-CO')} COP
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-center justify-between gap-2 pt-2 border-t border-[#C8CDC9]/50">
                                            <button
                                                onClick={() => {
                                                    setEditingCore(c);
                                                    setEditCoreCost(String(cost));
                                                    setShowEditCoreCostModal(true);
                                                }}
                                                className="text-xs font-semibold text-gray-600 hover:text-[#2E4040] underline"
                                            >
                                                Editar Costo
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setSelectedCoreForEntry(c);
                                                    setShowCoreModal(true);
                                                }}
                                                className="inline-flex items-center gap-1 rounded-md bg-[#3F8346] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] transition"
                                            >
                                                <Plus className="h-3 w-3" />
                                                Ingresar Cores
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ============================================================== */}
            {/* SUBTAB 3: KARDEX & AUDITORÍA                                   */}
            {/* ============================================================== */}
            {subTab === 'kardex' && (
                <div className="space-y-4">
                    {/* Filtros de Kardex */}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="relative flex-1 max-w-md">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                value={kardexSearch}
                                onChange={(e) => setKardexSearch(e.target.value)}
                                placeholder="Buscar por material, usuario, o notas..."
                                className="w-full rounded-lg border border-[#C8CDC9] bg-white py-2 pl-9 pr-3 text-xs focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                            />
                        </div>
                        <div className="flex items-center gap-2 overflow-x-auto">
                            <button
                                onClick={() => setKardexFilterType('all')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                    kardexFilterType === 'all'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Todos
                            </button>
                            <button
                                onClick={() => setKardexFilterType('entrada_compra')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                    kardexFilterType === 'entrada_compra'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Compras / Entradas
                            </button>
                            <button
                                onClick={() => setKardexFilterType('produccion_core')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                    kardexFilterType === 'produccion_core'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Corte Cores
                            </button>
                            <button
                                onClick={() => setKardexFilterType('consumo_pedido')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                                    kardexFilterType === 'consumo_pedido'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Despachos / Consumo
                            </button>
                        </div>
                    </div>

                    {/* Tabla de Kardex */}
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : filteredTransactions.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                            <History className="mx-auto h-12 w-12 text-[#949E97]" />
                            <h3 className="mt-3 text-base font-semibold text-[#2E4040]">No hay movimientos registrados</h3>
                            <p className="mt-1 text-xs text-[#949E97]">
                                Todas las compras, cortes de operarios y despachos aparecerán aquí de forma auditada.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-xl border border-[#C8CDC9]/70 bg-white shadow-sm">
                            <table className="w-full text-left text-xs">
                                <thead className="border-b border-[#C8CDC9] bg-[#F8F9FA] text-[#2E4040]">
                                    <tr>
                                        <th className="px-4 py-3.5 font-semibold">Fecha & Hora</th>
                                        <th className="px-4 py-3.5 font-semibold">Tipo Movimiento</th>
                                        <th className="px-4 py-3.5 font-semibold">Material / Core</th>
                                        <th className="px-4 py-3.5 font-semibold">Cantidad</th>
                                        <th className="px-4 py-3.5 font-semibold">Costo Total</th>
                                        <th className="px-4 py-3.5 font-semibold">Registrado Por</th>
                                        <th className="px-4 py-3.5 font-semibold">Detalle / Notas</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#C8CDC9]/40">
                                    {filteredTransactions.map((t) => {
                                        const config = MOVEMENT_CONFIG[t.movement_type] || MOVEMENT_CONFIG.ajuste_manual;
                                        const dateStr = new Date(t.created_at).toLocaleString('es-CO', {
                                            day: '2-digit',
                                            month: 'short',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        });

                                        const itemDesc = t.raw_material
                                            ? `${t.raw_material.name}`
                                            : t.core
                                            ? `${t.core.name}`
                                            : 'Material general';

                                        const unitDesc = t.raw_material ? 'kg' : 'tubos';

                                        return (
                                            <tr key={t.id} className="hover:bg-[#F9FBFA] transition-colors">
                                                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                                                    {dateStr}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span
                                                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${config.bg} ${config.text}`}
                                                    >
                                                        <config.icon className="h-3 w-3" />
                                                        {config.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 font-semibold text-[#2E4040]">
                                                    {itemDesc}
                                                </td>
                                                <td className="px-4 py-3 font-bold text-sm">
                                                    <span
                                                        className={config.isPositive ? 'text-emerald-700' : 'text-purple-700'}
                                                    >
                                                        {config.isPositive ? '+' : '-'}
                                                        {Number(t.quantity).toLocaleString()} {unitDesc}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 font-medium text-gray-700">
                                                    ${Number(t.total_cost || 0).toLocaleString('es-CO')}
                                                </td>
                                                <td className="px-4 py-3 text-gray-600">
                                                    <div className="flex items-center gap-1.5">
                                                        <User className="h-3.5 w-3.5 text-gray-400" />
                                                        <span className="truncate max-w-[140px]">
                                                            {t.creator?.full_name || t.creator?.email || 'Sistema'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 text-[11px] max-w-[200px] truncate">
                                                    {t.notes || '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* ============================================================== */}
            {/* MODAL: REGISTRAR ENTRADA DE BOBINA MADRE (COMPRA)               */}
            {/* ============================================================== */}
            {showRawEntryModal && selectedRawForEntry && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                Registrar Entrada / Compra
                            </h3>
                            <button
                                onClick={() => setShowRawEntryModal(false)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveRawEntry} className="mt-4 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Materia Prima:
                                </label>
                                <select
                                    value={selectedRawForEntry.id}
                                    onChange={(e) => {
                                        const found = rawMaterials.find((m) => m.id === e.target.value);
                                        if (found) {
                                            setSelectedRawForEntry(found);
                                            setRawEntryCost(String(found.cost_per_kg || ''));
                                        }
                                    }}
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                >
                                    {rawMaterials.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.name} ({m.width_cm} cm) — Stock actual: {Number(m.current_stock_kg).toLocaleString()} kg
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Kilos Recibidos (Kg) *:
                                </label>
                                <input
                                    type="number"
                                    step="0.1"
                                    required
                                    value={rawEntryKg}
                                    onChange={(e) => setRawEntryKg(e.target.value)}
                                    placeholder="Ej: 500"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Costo por Kilo ($ COP):
                                </label>
                                <input
                                    type="number"
                                    step="100"
                                    value={rawEntryCost}
                                    onChange={(e) => setRawEntryCost(e.target.value)}
                                    placeholder="Ej: 9500"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                                <span className="text-[11px] text-gray-500">
                                    Si el precio de compra cambió, actualízalo aquí para calcular costos financieros.
                                </span>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Proveedor / Factura / Notas:
                                </label>
                                <input
                                    type="text"
                                    value={rawEntryNotes}
                                    onChange={(e) => setRawEntryNotes(e.target.value)}
                                    placeholder="Ej: Factura 4591 - Petroquímica S.A."
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#C8CDC9]">
                                <button
                                    type="button"
                                    onClick={() => setShowRawEntryModal(false)}
                                    className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar en Kardex'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============================================================== */}
            {/* MODAL: NUEVA MEDIDA / BOBINA MADRE                              */}
            {/* ============================================================== */}
            {showNewRawModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                Nueva Medida de Bobina Madre
                            </h3>
                            <button
                                onClick={() => setShowNewRawModal(false)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateRawMaterial} className="mt-4 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Nombre Descriptivo *:
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={newRawName}
                                    onChange={(e) => setNewRawName(e.target.value)}
                                    placeholder="Ej: Bobina Madre Stretch Azul 50cm"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040] mb-1">Color:</label>
                                    <select
                                        value={newRawColor}
                                        onChange={(e) => setNewRawColor(e.target.value)}
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    >
                                        <option value="transparente">Transparente</option>
                                        <option value="negro">Negro</option>
                                        <option value="azul">Azul</option>
                                        <option value="blanco">Blanco</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                        Ancho (cm) *:
                                    </label>
                                    <input
                                        type="number"
                                        required
                                        value={newRawWidth}
                                        onChange={(e) => setNewRawWidth(e.target.value)}
                                        placeholder="45, 50, 60..."
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                        Costo Base / Kg ($):
                                    </label>
                                    <input
                                        type="number"
                                        value={newRawCost}
                                        onChange={(e) => setNewRawCost(e.target.value)}
                                        placeholder="9500"
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                        Alerta Stock Mínimo (Kg):
                                    </label>
                                    <input
                                        type="number"
                                        value={newRawMinStock}
                                        onChange={(e) => setNewRawMinStock(e.target.value)}
                                        placeholder="100"
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#C8CDC9]">
                                <button
                                    type="button"
                                    onClick={() => setShowNewRawModal(false)}
                                    className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crear Medida'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============================================================== */}
            {/* MODAL: INGRESAR CORES CORTADOS                                  */}
            {/* ============================================================== */}
            {showCoreModal && selectedCoreForEntry && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                Ingresar Cores Cortados
                            </h3>
                            <button
                                onClick={() => setShowCoreModal(false)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSaveCoreEntry} className="mt-4 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Medida de Core:
                                </label>
                                <select
                                    value={selectedCoreForEntry.id}
                                    onChange={(e) => {
                                        const found = cores.find((c) => c.id === e.target.value);
                                        if (found) setSelectedCoreForEntry(found);
                                    }}
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                >
                                    {cores.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name} ({c.length_cm} cm) — Stock: {c.current_stock_units} unidades
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Cantidad de Unidades Cortadas *:
                                </label>
                                <input
                                    type="number"
                                    required
                                    min="1"
                                    value={coreEntryUnits}
                                    onChange={(e) => setCoreEntryUnits(e.target.value)}
                                    placeholder="Ej: 100"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                                <span className="font-semibold">Costo Prefijado:</span> $
                                {Number(selectedCoreForEntry.standard_cost || 0).toLocaleString('es-CO')} COP por unidad.
                                El operario no necesita ingresar precios; el sistema valoriza el lote automáticamente.
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">Notas:</label>
                                <input
                                    type="text"
                                    value={coreEntryNotes}
                                    onChange={(e) => setCoreEntryNotes(e.target.value)}
                                    placeholder="Ej: Turno de la mañana - Lote 1"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#C8CDC9]">
                                <button
                                    type="button"
                                    onClick={() => setShowCoreModal(false)}
                                    className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sumar al Stock'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============================================================== */}
            {/* MODAL: EDITAR COSTO ESTÁNDAR DE CORE                            */}
            {/* ============================================================== */}
            {showEditCoreCostModal && editingCore && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-base font-bold text-[#2E4040]">
                                Editar Costo Unitario de Core
                            </h3>
                            <button
                                onClick={() => setShowEditCoreCostModal(false)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleUpdateCoreCost} className="mt-4 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Medida: {editingCore.name} ({editingCore.length_cm} cm)
                                </label>
                                <div className="mt-2 text-xs text-gray-500">
                                    Este valor se usará para costear automáticamente la producción sin que los operarios tengan que ingresar precios.
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                    Nuevo Costo Estándar ($ COP):
                                </label>
                                <input
                                    type="number"
                                    required
                                    min="0"
                                    value={editCoreCost}
                                    onChange={(e) => setEditCoreCost(e.target.value)}
                                    placeholder="Ej: 1350"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#C8CDC9]">
                                <button
                                    type="button"
                                    onClick={() => setShowEditCoreCostModal(false)}
                                    className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Actualizar Costo'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
