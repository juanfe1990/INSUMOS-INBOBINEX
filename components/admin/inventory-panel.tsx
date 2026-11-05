'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/lib/auth-context';
import type {
    RawMaterial,
    CoreSpecification,
    CoreMaterial,
    InventoryCategory,
    InventoryItem,
    InventoryTransaction,
    InventoryMovementType,
    Supplier,
} from '@/lib/types';
import GeneralInventory from '@/components/admin/inventory/general-inventory';
import FilmCutsManager from '@/components/admin/inventory/film-cuts-manager';
import WastePanel from '@/components/admin/inventory/waste-panel';
import InvoiceFormModal from '@/components/admin/suppliers/invoice-form-modal';
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
    Recycle,
    FileSpreadsheet,
    Calendar,
    User,
    CheckCircle2,
    X,
    Trash2,
    Boxes,
} from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/admin/confirm-dialog';

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
        label: 'Armado de Cores',
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
        label: 'Desperdicio',
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
    anulacion_compra: {
        label: 'Anulación Compra',
        bg: 'bg-red-50 border-red-200',
        text: 'text-red-700',
        icon: ArrowDownRight,
        isPositive: false,
    },
    consumo_armado_core: {
        label: 'Material a Armado',
        bg: 'bg-sky-50 border-sky-200',
        text: 'text-sky-700',
        icon: ArrowDownRight,
        isPositive: false,
    },
    salida_venta: {
        label: 'Venta / Salida',
        bg: 'bg-indigo-50 border-indigo-200',
        text: 'text-indigo-700',
        icon: ArrowDownRight,
        isPositive: false,
    },
    consumo_interno: {
        label: 'Consumo Interno',
        bg: 'bg-orange-50 border-orange-200',
        text: 'text-orange-700',
        icon: ArrowDownRight,
        isPositive: false,
    },
};

const fmtKg = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
const fmtCOP = (n: number) => '$' + Math.round(n).toLocaleString('es-CO');

/** Cuántos cores de esta medida alcanzan con los kg disponibles del material */
function coresFromKg(kg: number, core: CoreSpecification): number | null {
    const w = Number(core.weight_grams || 0);
    if (w <= 0) return null;
    return Math.floor((kg * 1000) / w);
}

/** Costo estimado de armar 1 core: material (kg x costo/kg) + mano de obra */
function estimateCoreUnitCost(core: CoreSpecification, material: CoreMaterial | null | undefined): number {
    const materialCost = material ? (Number(core.weight_grams || 0) / 1000) * Number(material.cost_per_kg || 0) : 0;
    return materialCost + Number(core.labor_cost_per_unit || 0);
}

const DELETE_NO_PERMISSION =
    'No se eliminó ningún registro: tu usuario no tiene permiso de borrado (se requiere rol admin y la política DELETE en Supabase).';

function deleteErrorMessage(err: any): string {
    if (err?.code === '23503') {
        return 'Tiene movimientos de Kardex asociados y la base de datos no permite desvincularlos. Aplica la migración de FKs (ON DELETE SET NULL).';
    }
    return err?.message || 'Error desconocido';
}

export default function InventoryPanel() {
    const supabase = createClient();
    const { user, profile } = useAuth();

    // Pestañas internas
    const [subTab, setSubTab] = useState<'raw' | 'cores' | 'general' | 'waste' | 'kardex'>('raw');
    const [loading, setLoading] = useState(true);

    // Datos principales
    const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
    const [cores, setCores] = useState<CoreSpecification[]>([]);
    const [coreMaterials, setCoreMaterials] = useState<CoreMaterial[]>([]);
    const [invCategories, setInvCategories] = useState<InventoryCategory[]>([]);
    const [invItems, setInvItems] = useState<InventoryItem[]>([]);
    const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);

    // Filtros Kardex
    const [kardexFilterType, setKardexFilterType] = useState<string>('all');
    const [kardexSearch, setKardexSearch] = useState<string>('');

    // Modales
    // Compra de bobina = factura de compra (proveedor + CxP + Kardex + costo promedio)
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [purchaseFor, setPurchaseFor] = useState<{ rawId: string } | null>(null);
    // Ajuste por conteo físico / inventario inicial (RPC adjust_raw_material_stock)
    const [showRawEntryModal, setShowRawEntryModal] = useState(false);
    const [selectedRawForEntry, setSelectedRawForEntry] = useState<RawMaterial | null>(null);
    const [rawEntryKg, setRawEntryKg] = useState<string>('');
    const [rawEntryCost, setRawEntryCost] = useState<string>('');
    const [rawEntryNotes, setRawEntryNotes] = useState<string>('');

    const [showNewRawModal, setShowNewRawModal] = useState(false);
    const [newRawName, setNewRawName] = useState('');
    const [newRawColor, setNewRawColor] = useState('transparente');
    const [newRawWidth, setNewRawWidth] = useState('50');
    const [newRawCaliber, setNewRawCaliber] = useState('17');
    const [newRawCost, setNewRawCost] = useState('9500');
    const [newRawMinStock, setNewRawMinStock] = useState('100');

    const [showCoreModal, setShowCoreModal] = useState(false);
    const [selectedCoreForEntry, setSelectedCoreForEntry] = useState<CoreSpecification | null>(null);
    const [coreEntryUnits, setCoreEntryUnits] = useState<string>('');
    const [coreEntryNotes, setCoreEntryNotes] = useState<string>('');

    // Material de cores (kg)
    const [materialForm, setMaterialForm] = useState<{
        id: string | null;
        name: string;
        cost: string;
        minKg: string;
    } | null>(null);
    const [adjustMaterial, setAdjustMaterial] = useState<CoreMaterial | null>(null);
    const [adjustKg, setAdjustKg] = useState('');
    const [adjustNotes, setAdjustNotes] = useState('');

    const [showEditCoreCostModal, setShowEditCoreCostModal] = useState(false);
    const [editingCore, setEditingCore] = useState<CoreSpecification | null>(null);
    const [editCoreCost, setEditCoreCost] = useState<string>('');
    const [editCoreWeight, setEditCoreWeight] = useState<string>('');
    const [editCoreLabor, setEditCoreLabor] = useState<string>('');
    const [editCoreMaterialId, setEditCoreMaterialId] = useState<string>('');

    const [showNewCoreModal, setShowNewCoreModal] = useState(false);
    const [newCoreName, setNewCoreName] = useState('');
    const [newCoreLength, setNewCoreLength] = useState('50');
    const [newCoreWeight, setNewCoreWeight] = useState('');
    const [newCoreLabor, setNewCoreLabor] = useState('');
    const [newCoreMaterialId, setNewCoreMaterialId] = useState('');
    const [newCoreMinStock, setNewCoreMinStock] = useState('30');

    const [saving, setSaving] = useState(false);
    const [confirmDialog, confirm] = useConfirm();

    // Cargar información completa de inventario
    const fetchInventoryData = async () => {
        try {
            setLoading(true);
            const [rawRes, coresRes, matRes, catRes, itemsRes, transRes, supRes] = await Promise.all([
                supabase.from('raw_materials').select('*').order('width_cm', { ascending: true }),
                supabase.from('core_specifications').select('*').order('length_cm', { ascending: true }),
                supabase.from('core_materials').select('*').order('created_at', { ascending: true }),
                supabase
                    .from('inventory_categories')
                    .select('*')
                    .order('display_order', { ascending: true })
                    .order('name', { ascending: true }),
                supabase.from('inventory_items').select('*').order('name', { ascending: true }),
                supabase
                    .from('inventory_transactions')
                    .select(`
                        *,
                        raw_material:raw_materials(*),
                        core:core_specifications(*),
                        core_material:core_materials(*),
                        inventory_item:inventory_items(*),
                        creator:profiles(id, full_name, email)
                    `)
                    .order('created_at', { ascending: false })
                    .limit(100),
                supabase.from('suppliers').select('*').order('business_name'),
            ]);
            if (supRes.data) setSuppliers(supRes.data as Supplier[]);

            if (rawRes.data) setRawMaterials(rawRes.data as RawMaterial[]);
            if (coresRes.data) setCores(coresRes.data as CoreSpecification[]);
            if (matRes.data) setCoreMaterials(matRes.data as CoreMaterial[]);
            if (catRes.data) setInvCategories(catRes.data as InventoryCategory[]);
            if (itemsRes.data) setInvItems(itemsRes.data as InventoryItem[]);
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
            .on('postgres_changes', { event: '*', schema: 'public', table: 'core_materials' }, () => {
                fetchInventoryData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () => {
                fetchInventoryData();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_categories' }, () => {
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

    const totalCoreMaterialKg = useMemo(
        () => coreMaterials.reduce((acc, m) => acc + Number(m.current_stock_kg || 0), 0),
        [coreMaterials]
    );

    const totalCoreMaterialValue = useMemo(
        () => coreMaterials.reduce((acc, m) => acc + Number(m.current_stock_kg || 0) * Number(m.cost_per_kg || 0), 0),
        [coreMaterials]
    );

    const totalGeneralValue = useMemo(
        () =>
            invItems.reduce((acc, i) => acc + Number(i.current_stock || 0) * Number(i.avg_cost || 0), 0),
        [invItems]
    );

    const lowStockAlerts = useMemo(() => {
        const rawAlerts = rawMaterials.filter((m) => Number(m.current_stock_kg) <= Number(m.min_stock_alert_kg || 50));
        const coreAlerts = cores.filter((c) => Number(c.current_stock_units) <= Number(c.min_stock_alert_units || 30));
        const materialAlerts = coreMaterials.filter(
            (m) => Number(m.current_stock_kg) <= Number(m.min_stock_alert_kg || 0)
        );
        const itemAlerts = invItems.filter(
            (i) => i.is_active && Number(i.current_stock) <= Number(i.min_stock_alert || 0)
        );
        return {
            count: rawAlerts.length + coreAlerts.length + materialAlerts.length + itemAlerts.length,
            rawAlerts,
            coreAlerts,
            materialAlerts,
            itemAlerts,
        };
    }, [rawMaterials, cores, coreMaterials, invItems]);

    // Filtrar Kardex
    const filteredTransactions = useMemo(() => {
        return transactions.filter((t) => {
            if (kardexFilterType !== 'all' && t.movement_type !== kardexFilterType) {
                return false;
            }
            if (kardexSearch.trim() !== '') {
                const q = kardexSearch.toLowerCase();
                const matName = t.raw_material?.name?.toLowerCase() || '';
                const coreName = (t.core?.name || t.core_material?.name || t.inventory_item?.name || '').toLowerCase();
                const creator = t.creator?.full_name?.toLowerCase() || '';
                const notes = t.notes?.toLowerCase() || '';
                return matName.includes(q) || coreName.includes(q) || creator.includes(q) || notes.includes(q);
            }
            return true;
        });
    }, [transactions, kardexFilterType, kardexSearch]);

    // Ajuste por conteo físico / inventario inicial de una bobina (atómico en la base)
    const handleSaveRawEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedRawForEntry) return;
        if (rawEntryKg === '' || Number(rawEntryKg) < 0) {
            toast.error('Ingresa los kilos contados (0 o más)');
            return;
        }
        const newKg = Number(rawEntryKg);
        const current = Number(selectedRawForEntry.current_stock_kg || 0);
        if (newKg === current) {
            toast.info('El conteo coincide con el stock registrado: no hay nada que ajustar');
            return;
        }
        try {
            setSaving(true);
            const { error } = await supabase.rpc('adjust_raw_material_stock', {
                p_raw_id: selectedRawForEntry.id,
                p_new_stock_kg: newKg,
                p_unit_cost: newKg > current && rawEntryCost !== '' ? Number(rawEntryCost) : undefined,
                p_notes: rawEntryNotes.trim() || undefined,
            });
            if (error) throw error;
            const diff = newKg - current;
            toast.success(
                `${selectedRawForEntry.name}: ${current.toLocaleString('es-CO')} → ${newKg.toLocaleString('es-CO')} kg (${
                    diff > 0 ? '+' : ''
                }${diff.toLocaleString('es-CO', { maximumFractionDigits: 2 })} kg en Kardex)`
            );
            setShowRawEntryModal(false);
            setRawEntryKg('');
            setRawEntryCost('');
            setRawEntryNotes('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al ajustar: ' + (err.message || 'Error'));
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
        if (!(Number(newRawCaliber) > 0)) {
            toast.error('Ingresa el calibre de la bobina en micras');
            return;
        }

        try {
            setSaving(true);
            const { error } = await supabase.from('raw_materials').insert({
                name: newRawName.trim(),
                material_type: 'stretch',
                color: newRawColor,
                width_cm: Number(newRawWidth),
                caliber_microns: Number(newRawCaliber),
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

    // Armado de cores: descuenta kg del material y suma unidades (RPC atómica)
    const handleSaveCoreEntry = async (e: React.FormEvent) => {
        e.preventDefault();
        const units = Math.floor(Number(coreEntryUnits));
        if (!selectedCoreForEntry || !(units > 0)) {
            toast.error('Ingresa una cantidad válida de cores armados');
            return;
        }
        if (!(Number(selectedCoreForEntry.weight_grams) > 0)) {
            toast.error('Define primero el peso promedio del core armado de esta medida');
            return;
        }

        try {
            setSaving(true);
            const { data, error } = await supabase.rpc('register_core_assembly', {
                p_core_id: selectedCoreForEntry.id,
                p_units: units,
                ...(coreEntryNotes.trim() ? { p_notes: coreEntryNotes.trim() } : {}),
            });
            if (error) throw error;

            const r = (data || {}) as { kg_used?: number; unit_cost?: number };
            toast.success(
                `+${units} cores de ${selectedCoreForEntry.length_cm} cm · ${fmtKg(Number(r.kg_used || 0))} kg de material · ${fmtCOP(Number(r.unit_cost || 0))} c/u`
            );
            setShowCoreModal(false);
            setCoreEntryUnits('');
            setCoreEntryNotes('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error registrando armado: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Editar peso, mano de obra, material y costo promedio de una medida de core
    const handleUpdateCoreCost = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingCore || editCoreCost === '' || Number(editCoreCost) < 0) {
            toast.error('Ingresa un costo válido');
            return;
        }
        if (editCoreWeight === '' || Number(editCoreWeight) < 0) {
            toast.error('Ingresa un peso promedio válido en gramos');
            return;
        }
        if (Number(editCoreLabor || 0) < 0) {
            toast.error('La mano de obra no puede ser negativa');
            return;
        }

        if (findDuplicateCore(editCoreMaterialId || null, Number(editingCore.length_cm), editingCore.id)) {
            toast.error(duplicateCoreMessage(editCoreMaterialId || null, Number(editingCore.length_cm)));
            return;
        }
        try {
            setSaving(true);
            const weight = Number(editCoreWeight);
            const { data, error } = await supabase
                .from('core_specifications')
                .update({
                    standard_cost: Number(editCoreCost),
                    weight_grams: weight,
                    labor_cost_per_unit: Number(editCoreLabor || 0),
                    core_material_id: editCoreMaterialId || null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', editingCore.id)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) throw new Error('No tienes permiso para editar esta medida');

            toast.success(`${editingCore.name} actualizado · ${weight.toLocaleString('es-CO')} g por core`);
            setShowEditCoreCostModal(false);
            fetchInventoryData();
        } catch (err: any) {
            toast.error(
                err?.code === '23505'
                    ? duplicateCoreMessage(editCoreMaterialId || null, Number(editingCore.length_cm))
                    : 'Error actualizando core: ' + (err.message || 'Error')
            );
        } finally {
            setSaving(false);
        }
    };

    // Una medida es única por material: 45 cm cartón y 45 cm color pueden coexistir, dos 45 cm cartón no
    const findDuplicateCore = (materialId: string | null, length: number, exceptId?: string) =>
        cores.find(
            (c) =>
                c.id !== exceptId &&
                (c.core_material_id || null) === (materialId || null) &&
                Math.abs(Number(c.length_cm) - length) < 0.001
        );
    const duplicateCoreMessage = (materialId: string | null, length: number) => {
        const mat = coreMaterials.find((m) => m.id === materialId);
        return `Ya existe un core de ${length} cm ${mat ? `de "${mat.name}"` : 'sin material'}. Cada medida solo puede existir una vez por material.`;
    };

    // Crear Nueva Medida de Core
    const handleCreateCore = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCoreName.trim()) {
            toast.error('Ingresa el nombre del core');
            return;
        }
        if (!(Number(newCoreWeight) > 0)) {
            toast.error('Ingresa el peso promedio del core armado en gramos');
            return;
        }
        if (!newCoreMaterialId) {
            toast.error('Selecciona el material de cores con el que se arma esta medida');
            return;
        }
        const newLength = Number(newCoreLength) || 50;
        if (findDuplicateCore(newCoreMaterialId, newLength)) {
            toast.error(duplicateCoreMessage(newCoreMaterialId, newLength));
            return;
        }
        try {
            setSaving(true);
            const material = coreMaterials.find((m) => m.id === newCoreMaterialId);
            const labor = Number(newCoreLabor || 0);
            const draft = { weight_grams: Number(newCoreWeight), labor_cost_per_unit: labor } as CoreSpecification;
            const { error } = await supabase.from('core_specifications').insert({
                name: newCoreName.trim(),
                length_cm: newLength,
                weight_grams: Number(newCoreWeight),
                labor_cost_per_unit: labor,
                core_material_id: newCoreMaterialId,
                // Costo inicial estimado; cada armado lo recalcula por promedio ponderado
                standard_cost: Math.round(estimateCoreUnitCost(draft, material)),
                current_stock_units: 0,
                min_stock_alert_units: Number(newCoreMinStock) || 30,
            });
            if (error) throw error;
            toast.success('Nueva medida de core creada con éxito');
            setShowNewCoreModal(false);
            setNewCoreName('');
            setNewCoreWeight('');
            setNewCoreLabor('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error(
                err?.code === '23505'
                    ? duplicateCoreMessage(newCoreMaterialId, newLength)
                    : 'Error al registrar core: ' + (err.message || 'Error')
            );
        } finally {
            setSaving(false);
        }
    };

    // Crear / editar material de cores (nombre, costo/kg, alerta)
    const handleSaveMaterial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!materialForm) return;
        if (!materialForm.name.trim()) {
            toast.error('Ingresa el nombre del material');
            return;
        }
        if (Number(materialForm.cost) < 0 || Number(materialForm.minKg) < 0) {
            toast.error('Los valores no pueden ser negativos');
            return;
        }
        try {
            setSaving(true);
            const payload = {
                name: materialForm.name.trim(),
                cost_per_kg: Number(materialForm.cost || 0),
                min_stock_alert_kg: Number(materialForm.minKg || 0),
                updated_at: new Date().toISOString(),
            };
            const { data, error } = materialForm.id
                ? await supabase.from('core_materials').update(payload).eq('id', materialForm.id).select('id')
                : await supabase.from('core_materials').insert(payload).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error('Solo un administrador puede gestionar el material de cores');
            toast.success(materialForm.id ? 'Material actualizado' : 'Material de cores creado');
            setMaterialForm(null);
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error guardando material: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Ajuste por conteo físico (kg reales en bodega)
    const handleAdjustMaterial = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!adjustMaterial) return;
        const kg = Number(adjustKg);
        if (adjustKg.trim() === '' || !(kg >= 0)) {
            toast.error('Ingresa los kilos contados (0 o más)');
            return;
        }
        try {
            setSaving(true);
            const { error } = await supabase.rpc('adjust_core_material_stock', {
                p_material_id: adjustMaterial.id,
                p_new_stock_kg: kg,
                ...(adjustNotes.trim() ? { p_notes: adjustNotes.trim() } : {}),
            });
            if (error) throw error;
            toast.success(`${adjustMaterial.name}: stock ajustado a ${fmtKg(kg)} kg`);
            setAdjustMaterial(null);
            setAdjustKg('');
            setAdjustNotes('');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error ajustando stock: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteMaterial = async (m: CoreMaterial) => {
        const linked = cores.filter((c) => c.core_material_id === m.id).length;
        const ok = await confirm({
            title: `¿Eliminar el material "${m.name}"?`,
            description: (
                <>
                    Tiene <b>{fmtKg(Number(m.current_stock_kg || 0))} kg</b> en bodega
                    {linked > 0 ? <> y {linked} medida(s) de core quedarán sin material asignado</> : null}. El Kardex se
                    conserva como historial.
                </>
            ),
            confirmLabel: 'Eliminar material',
        });
        if (!ok) return;
        try {
            setSaving(true);
            const { data, error } = await supabase.from('core_materials').delete().eq('id', m.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(DELETE_NO_PERMISSION);
            toast.success(`Material "${m.name}" eliminado`);
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al eliminar material: ' + deleteErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    // Eliminar Bobina Madre Registrada
    const handleDeleteRawMaterial = async (m: RawMaterial) => {
        const ok = await confirm({
            title: `¿Eliminar la bobina madre "${m.name}" (${m.width_cm} cm)?`,
            description: (
                <>
                    Se borrará la materia prima con sus{' '}
                    <b>{Number(m.current_stock_kg || 0).toLocaleString('es-CO')} kg</b> registrados. Los movimientos
                    del Kardex se conservan como historial.
                </>
            ),
            confirmLabel: 'Eliminar bobina',
        });
        if (!ok) return;

        try {
            setSaving(true);
            // Las FKs del Kardex son ON DELETE SET NULL: el historial se conserva
            const { data, error } = await supabase.from('raw_materials').delete().eq('id', m.id).select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(DELETE_NO_PERMISSION);

            toast.success(`Bobina madre "${m.name}" eliminada del inventario`);
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al eliminar materia prima: ' + deleteErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    // Eliminar Core Registrado
    const handleDeleteCore = async (c: CoreSpecification) => {
        const ok = await confirm({
            title: `¿Eliminar el core "${c.name}" (${c.length_cm} cm)?`,
            description: (
                <>
                    Se borrará la medida con sus{' '}
                    <b>{Number(c.current_stock_units || 0).toLocaleString('es-CO')} tubos</b> en stock y dejará de
                    aparecer al crear pedidos. Los movimientos del Kardex se conservan como historial.
                </>
            ),
            confirmLabel: 'Eliminar core',
        });
        if (!ok) return;

        try {
            setSaving(true);
            const { data, error } = await supabase
                .from('core_specifications')
                .delete()
                .eq('id', c.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(DELETE_NO_PERMISSION);

            toast.success(`Core "${c.name}" eliminado del inventario`);
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al eliminar core: ' + deleteErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    // Ajustar / Vaciar stock de Cores a 0 unidades
    const handleResetCoreStock = async (c: CoreSpecification) => {
        const currentUnits = Number(c.current_stock_units || 0);
        if (currentUnits === 0) {
            toast.info('El stock de este core ya está en 0 unidades');
            return;
        }

        const ok = await confirm({
            title: `¿Vaciar a 0 unidades el stock de "${c.name}"?`,
            description: `Actualmente hay ${currentUnits.toLocaleString('es-CO')} tubos registrados. Se creará un ajuste manual en el Kardex.`,
            confirmLabel: 'Vaciar stock',
        });
        if (!ok) return;

        try {
            setSaving(true);
            const { error } = await supabase.rpc('adjust_core_stock', {
                p_core_id: c.id,
                p_new_units: 0,
                p_notes: 'Vaciado / reajuste manual de cores a 0',
            });
            if (error) throw error;

            toast.success(`Stock de "${c.name}" ajustado a 0 unidades`);
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al ajustar stock: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    // Eliminar Movimiento de Kardex
    const handleDeleteTransaction = async (t: InventoryTransaction) => {
        if ((t as any).waste_record_id) {
            toast.error('Este movimiento pertenece a un registro de desperdicio: anúlalo desde la pestaña "Desperdicios".');
            return;
        }
        const label = MOVEMENT_CONFIG[t.movement_type as InventoryMovementType]?.label || t.movement_type;
        const ok = await confirm({
            title: '¿Eliminar este movimiento del Kardex?',
            description: (
                <>
                    {label} · {new Date(t.created_at).toLocaleString('es-CO')}
                    <br />
                    Solo se borra el registro histórico; el stock actual no se modifica.
                </>
            ),
            confirmLabel: 'Eliminar registro',
        });
        if (!ok) return;

        try {
            setSaving(true);
            const { data, error } = await supabase
                .from('inventory_transactions')
                .delete()
                .eq('id', t.id)
                .select('id');
            if (error) throw error;
            if (!data || data.length === 0) throw new Error(DELETE_NO_PERMISSION);

            toast.success('Registro de movimiento eliminado del Kardex');
            fetchInventoryData();
        } catch (err: any) {
            toast.error('Error al eliminar registro: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            {confirmDialog}
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
                                    if (rawMaterials.length === 0) {
                                        toast.error('Crea primero la bobina madre con "Nueva Medida"');
                                        return;
                                    }
                                    setPurchaseFor({ rawId: rawMaterials[0].id });
                                }}
                                className="flex items-center gap-2 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-[#FDFDFD] shadow-sm transition hover:bg-[#2d6332]"
                                title="Factura de compra: proveedor, cuenta por pagar, Kardex y costo promedio"
                            >
                                <Plus className="h-4 w-4" />
                                Registrar Compra (Factura)
                            </button>
                        </>
                    )}
                    {subTab === 'cores' && (
                        <>
                            <button
                                onClick={() => setMaterialForm({ id: null, name: '', cost: '', minKg: '20' })}
                                className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-4 py-2 text-xs font-semibold text-[#2E4040] shadow-sm transition hover:bg-[#C8CDC9]/20"
                            >
                                <Plus className="h-4 w-4" />
                                Nuevo Material (Kg)
                            </button>
                            <button
                                onClick={() => {
                                    setNewCoreMaterialId(coreMaterials[0]?.id || '');
                                    setShowNewCoreModal(true);
                                }}
                                className="flex items-center gap-1.5 rounded-lg border border-[#C8CDC9] bg-white px-4 py-2 text-xs font-semibold text-[#2E4040] shadow-sm transition hover:bg-[#C8CDC9]/20"
                            >
                                <Plus className="h-4 w-4" />
                                Nueva Medida Core
                            </button>
                            <button
                                onClick={() => {
                                    setSelectedCoreForEntry(cores[0] || null);
                                    setCoreEntryUnits('');
                                    setShowCoreModal(true);
                                }}
                                disabled={cores.length === 0}
                                className="flex items-center gap-2 rounded-lg bg-[#3F8346] px-4 py-2 text-xs font-semibold text-[#FDFDFD] shadow-sm transition hover:bg-[#2d6332] disabled:opacity-50"
                            >
                                <Plus className="h-4 w-4" />
                                Registrar Armado de Cores
                            </button>
                        </>
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
                            {totalCoresCount.toLocaleString()} <span className="text-sm font-medium text-gray-500">armados</span>
                        </div>
                        <div className="mt-1 text-xs text-[#949E97] font-medium">
                            + {fmtKg(totalCoreMaterialKg)} kg de material sin armar
                        </div>
                        <div className="mt-0.5 text-xs text-blue-600 font-medium">
                            Valoración: {fmtCOP(totalCoresValue + totalCoreMaterialValue)} COP
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
                            {fmtCOP(totalRawValue + totalCoresValue + totalCoreMaterialValue + totalGeneralValue)}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 font-medium">
                            Película + cores + otros inventarios ({fmtCOP(totalGeneralValue)})
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
                            {lowStockAlerts.count > 0
                                ? `Requieren compra o armado${lowStockAlerts.itemAlerts.length ? ` · ${lowStockAlerts.itemAlerts.length} en otros inventarios` : ''}`
                                : 'Niveles óptimos de stock'}
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
                    Cores (Material en Kg → Unidades por Medida)
                </button>
                <button
                    onClick={() => setSubTab('general')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                        subTab === 'general'
                            ? 'bg-[#2E4040] text-white shadow-sm'
                            : 'bg-white text-[#2E4040] border border-[#C8CDC9] hover:bg-[#C8CDC9]/20'
                    }`}
                >
                    <Boxes className="h-3.5 w-3.5 text-[#3F8346]" />
                    Otros Inventarios (Cintas, Cartón...)
                    {lowStockAlerts.itemAlerts.length > 0 && (
                        <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                            {lowStockAlerts.itemAlerts.length}
                        </span>
                    )}
                </button>
                <button
                    onClick={() => setSubTab('waste')}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                        subTab === 'waste'
                            ? 'bg-[#2E4040] text-white shadow-sm'
                            : 'bg-white text-[#2E4040] border border-[#C8CDC9] hover:bg-[#C8CDC9]/20'
                    }`}
                >
                    <Recycle className="h-3.5 w-3.5 text-[#3F8346]" />
                    Desperdicios
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
                    <FilmCutsManager
                        rawWidths={rawMaterials.map((m) => Number(m.width_cm))}
                        canEdit={profile?.role === 'admin'}
                    />
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
                                        <th className="px-4 py-3.5 font-semibold">Ancho / Calibre</th>
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
                                                    <div className="text-[11px] font-medium text-[#949E97]">
                                                        {Number(m.caliber_microns)} µ
                                                    </div>
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
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={() => setPurchaseFor({ rawId: m.id })}
                                                            className="inline-flex items-center gap-1 rounded-md bg-[#3F8346] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] transition"
                                                            title="Registrar factura de compra de esta bobina (proveedor + cuenta por pagar)"
                                                        >
                                                            <Plus className="h-3.5 w-3.5" />
                                                            Compra
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedRawForEntry(m);
                                                                setRawEntryKg(String(Number(m.current_stock_kg || 0)));
                                                                setRawEntryCost(String(Number(m.cost_per_kg || 0) || ''));
                                                                setRawEntryNotes('');
                                                                setShowRawEntryModal(true);
                                                            }}
                                                            disabled={saving}
                                                            className="rounded-md border border-[#C8CDC9] bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300 transition disabled:opacity-40"
                                                            title="Ajustar por conteo físico, inventario inicial o vaciar"
                                                        >
                                                            Ajustar
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteRawMaterial(m)}
                                                            disabled={saving}
                                                            className="rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 hover:text-red-700 transition disabled:opacity-40"
                                                            title="Eliminar esta bobina madre del inventario"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
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
                <div className="space-y-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                        </div>
                    ) : (
                        <>
                            {/* ---------- 1. Material de cores en kg ---------- */}
                            <div>
                                <div className="mb-2 flex items-end justify-between">
                                    <div>
                                        <h3 className="text-sm font-bold text-[#2E4040]">1. Material de cores en bodega (kg)</h3>
                                        <p className="text-[11px] text-[#949E97]">
                                            Se compra por kg con factura de proveedor. Al armar cores se descuenta según el peso
                                            de cada medida.
                                        </p>
                                    </div>
                                </div>
                                {coreMaterials.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-8 text-center">
                                        <Weight className="mx-auto h-10 w-10 text-[#949E97]" />
                                        <p className="mt-2 text-xs text-[#949E97]">
                                            No hay material de cores. Crea uno con &quot;Nuevo Material (Kg)&quot;.
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                        {coreMaterials.map((m) => {
                                            const kg = Number(m.current_stock_kg || 0);
                                            const isLow = kg <= Number(m.min_stock_alert_kg || 0);
                                            const linked = cores.filter((c) => c.core_material_id === m.id);
                                            return (
                                                <div
                                                    key={m.id}
                                                    className="rounded-xl border border-[#C8CDC9]/70 bg-white p-5 shadow-sm"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <h4 className="text-base font-bold text-[#2E4040]">{m.name}</h4>
                                                            <div className="text-[11px] text-[#949E97]">
                                                                Costo promedio: {fmtCOP(Number(m.cost_per_kg || 0))} / kg · Alerta ≤{' '}
                                                                {fmtKg(Number(m.min_stock_alert_kg || 0))} kg
                                                            </div>
                                                        </div>
                                                        <span
                                                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                                                isLow ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                                                            }`}
                                                        >
                                                            {isLow ? 'Stock Bajo' : 'Disponible'}
                                                        </span>
                                                    </div>

                                                    <div className="mt-3 flex items-baseline gap-3">
                                                        <div className="text-2xl font-bold text-[#2E4040]">
                                                            {fmtKg(kg)} <span className="text-sm font-medium text-gray-500">kg</span>
                                                        </div>
                                                        <div className="text-xs font-semibold text-[#3F8346]">
                                                            {fmtCOP(kg * Number(m.cost_per_kg || 0))} COP
                                                        </div>
                                                    </div>

                                                    <div className="mt-3 rounded-lg bg-[#F8F9FA] p-3">
                                                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#949E97]">
                                                            Alcanza para armar aprox.
                                                        </div>
                                                        {linked.length === 0 ? (
                                                            <div className="text-[11px] text-[#949E97]">
                                                                Ninguna medida usa este material todavía.
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {linked.map((c) => {
                                                                    const n = coresFromKg(kg, c);
                                                                    return (
                                                                        <span
                                                                            key={c.id}
                                                                            className="rounded-md border border-[#C8CDC9] bg-white px-2 py-0.5 text-[11px] text-[#2E4040]"
                                                                        >
                                                                            <b>{n === null ? '—' : n.toLocaleString('es-CO')}</b> de{' '}
                                                                            {Number(c.length_cm)} cm
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                        <div className="mt-1.5 text-[10px] text-[#949E97]">
                                                            Es una alternativa por medida: el mismo kilo sirve para una u otra.
                                                        </div>
                                                    </div>

                                                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#C8CDC9]/50 pt-3">
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                onClick={() =>
                                                                    setMaterialForm({
                                                                        id: m.id,
                                                                        name: m.name,
                                                                        cost: String(Number(m.cost_per_kg || 0)),
                                                                        minKg: String(Number(m.min_stock_alert_kg || 0)),
                                                                    })
                                                                }
                                                                className="text-xs font-semibold text-gray-600 underline hover:text-[#2E4040]"
                                                            >
                                                                Editar
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setAdjustMaterial(m);
                                                                    setAdjustKg(String(kg));
                                                                    setAdjustNotes('');
                                                                }}
                                                                className="text-xs font-semibold text-amber-700 hover:underline"
                                                                title="Ajustar al peso real contado en bodega"
                                                            >
                                                                Ajustar conteo
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-[#949E97]">
                                                                Compras: Proveedores → Factura (línea &quot;Core&quot;)
                                                            </span>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteMaterial(m)}
                                                                disabled={saving}
                                                                className="rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 transition hover:bg-red-100 disabled:opacity-40"
                                                                title="Eliminar material"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* ---------- 2. Cores armados por medida ---------- */}
                            <div>
                                <div className="mb-2">
                                    <h3 className="text-sm font-bold text-[#2E4040]">2. Cores armados por medida (unidades)</h3>
                                    <p className="text-[11px] text-[#949E97]">
                                        Costo por core = peso × costo/kg del material + mano de obra. Se descuenta 1 core por
                                        rollo al despachar un pedido.
                                    </p>
                                </div>
                                {cores.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-[#C8CDC9] bg-white p-12 text-center">
                                        <Layers className="mx-auto h-12 w-12 text-[#949E97]" />
                                        <h3 className="mt-3 text-base font-semibold text-[#2E4040]">No hay medidas de core</h3>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                        {cores.map((c) => {
                                            const stock = Number(c.current_stock_units || 0);
                                            const cost = Number(c.standard_cost || 0);
                                            const weight = Number(c.weight_grams || 0);
                                            const isLow = stock <= Number(c.min_stock_alert_units || 30);
                                            const material = coreMaterials.find((m) => m.id === c.core_material_id);
                                            const estimate = estimateCoreUnitCost(c, material);
                                            const canBuild = material ? coresFromKg(Number(material.current_stock_kg || 0), c) : null;

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
                                                            <div className="text-[11px] text-[#949E97]">
                                                                Material:{' '}
                                                                {material ? (
                                                                    material.name
                                                                ) : (
                                                                    <span className="font-semibold text-amber-700">sin asignar</span>
                                                                )}
                                                            </div>
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
                                                            <div className="text-[#949E97]">Armados:</div>
                                                            <div className="text-xl font-bold text-[#2E4040]">
                                                                {stock.toLocaleString('es-CO')}{' '}
                                                                <span className="text-xs font-normal text-gray-500">und</span>
                                                            </div>
                                                            {weight > 0 && (
                                                                <div className="text-[11px] text-[#949E97]">
                                                                    ≈ {fmtKg((stock * weight) / 1000)} kg
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="text-[#949E97]">Costo promedio:</div>
                                                            <div className="text-sm font-bold text-[#3F8346]">{fmtCOP(cost)} c/u</div>
                                                            <div className="text-[11px] text-[#949E97]">Próximo armado ≈ {fmtCOP(estimate)}</div>
                                                        </div>
                                                        <div className="col-span-2 grid grid-cols-2 gap-2 border-t border-[#C8CDC9]/60 pt-2">
                                                            <div>
                                                                <span className="text-[#949E97]">Peso: </span>
                                                                {weight > 0 ? (
                                                                    <span className="font-bold text-[#2E4040]">
                                                                        {weight.toLocaleString('es-CO')} g
                                                                    </span>
                                                                ) : (
                                                                    <span className="font-semibold text-amber-700">sin definir</span>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <span className="text-[#949E97]">Mano de obra: </span>
                                                                <span className="font-bold text-[#2E4040]">
                                                                    {fmtCOP(Number(c.labor_cost_per_unit || 0))}
                                                                </span>
                                                            </div>
                                                            <div className="col-span-2 text-[11px] text-[#949E97]">
                                                                Con el material disponible se pueden armar{' '}
                                                                <b className="text-[#2E4040]">
                                                                    {canBuild === null ? '—' : canBuild.toLocaleString('es-CO')}
                                                                </b>{' '}
                                                                más.
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#C8CDC9]/50 pt-2">
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingCore(c);
                                                                    setEditCoreCost(String(cost));
                                                                    setEditCoreWeight(String(weight));
                                                                    setEditCoreLabor(String(Number(c.labor_cost_per_unit || 0)));
                                                                    setEditCoreMaterialId(c.core_material_id || '');
                                                                    setShowEditCoreCostModal(true);
                                                                }}
                                                                className="text-xs font-semibold text-gray-600 underline hover:text-[#2E4040]"
                                                            >
                                                                Editar
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleResetCoreStock(c)}
                                                                disabled={saving || stock === 0}
                                                                className="text-[11px] font-semibold text-amber-700 hover:underline disabled:opacity-40"
                                                                title="Vaciar stock a 0 unidades"
                                                            >
                                                                Vaciar
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                onClick={() => {
                                                                    setSelectedCoreForEntry(c);
                                                                    setCoreEntryUnits('');
                                                                    setShowCoreModal(true);
                                                                }}
                                                                className="inline-flex items-center gap-1 rounded-md bg-[#3F8346] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#2d6332]"
                                                            >
                                                                <Plus className="h-3 w-3" />
                                                                Armar
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteCore(c)}
                                                                disabled={saving}
                                                                className="rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 transition hover:bg-red-100 hover:text-red-700 disabled:opacity-40"
                                                                title="Eliminar esta medida de core"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* ============================================================== */}
            {/* SUBTAB: OTROS INVENTARIOS (cintas, cartón industrial, ...)      */}
            {/* ============================================================== */}
            {subTab === 'waste' && (
                <WastePanel
                    rawMaterials={rawMaterials}
                    cores={cores}
                    coreMaterials={coreMaterials}
                    invItems={invItems}
                    isAdmin={profile?.role === 'admin'}
                    onChanged={fetchInventoryData}
                />
            )}

            {subTab === 'general' && (
                <GeneralInventory
                    categories={invCategories}
                    items={invItems}
                    loading={loading}
                    isAdmin={profile?.role === 'admin'}
                    onChanged={fetchInventoryData}
                />
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
                                Armado Cores
                            </button>
                            <button
                                onClick={() => setKardexFilterType('consumo_armado_core')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                                    kardexFilterType === 'consumo_armado_core'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Material a Armado
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
                            <button
                                onClick={() => setKardexFilterType('salida_venta')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                                    kardexFilterType === 'salida_venta'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Ventas / Salidas
                            </button>
                            <button
                                onClick={() => setKardexFilterType('ajuste_manual')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition whitespace-nowrap ${
                                    kardexFilterType === 'ajuste_manual'
                                        ? 'bg-[#3F8346] text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                            >
                                Ajustes
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
                                        <th className="px-4 py-3.5 text-right font-semibold">Acción</th>
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
                                            : t.core_material
                                            ? `${t.core_material.name} (material cores)`
                                            : t.inventory_item
                                            ? t.inventory_item.name
                                            : 'Material eliminado / general';

                                        const unitDesc = t.core_id
                                            ? 'cores'
                                            : t.inventory_item
                                            ? t.inventory_item.unit
                                            : 'kg';
                                        const qty = Number(t.quantity);
                                        // Los ajustes manuales guardan el signo en la cantidad
                                        const isPositive =
                                            t.movement_type === 'ajuste_manual' || t.movement_type === 'merma_desperdicio'
                                                ? t.movement_type === 'ajuste_manual'
                                                    ? qty >= 0
                                                    : qty < 0
                                                : config.isPositive;

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
                                                        className={isPositive ? 'text-emerald-700' : 'text-purple-700'}
                                                    >
                                                        {isPositive ? '+' : '-'}
                                                        {fmtKg(Math.abs(qty))} {unitDesc}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 font-medium text-gray-700">
                                                    {fmtCOP(Math.abs(Number(t.total_cost || 0)))}
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
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteTransaction(t)}
                                                        disabled={saving}
                                                        className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition disabled:opacity-40"
                                                        title="Eliminar este registro de inventario del Kardex"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
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
            {/* MODAL: AJUSTE POR CONTEO / INVENTARIO INICIAL DE BOBINA         */}
            {/* ============================================================== */}
            {showRawEntryModal && selectedRawForEntry && (() => {
                const current = Number(selectedRawForEntry.current_stock_kg || 0);
                const newKg = rawEntryKg === '' ? current : Number(rawEntryKg);
                const diff = newKg - current;
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
                            <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                                <div>
                                    <h3 className="font-heading text-lg font-bold text-[#2E4040]">Ajustar conteo</h3>
                                    <p className="text-[11px] text-[#949E97]">
                                        {selectedRawForEntry.name} · {Number(selectedRawForEntry.width_cm)} cm ·{' '}
                                        {Number(selectedRawForEntry.caliber_microns)} µ
                                    </p>
                                </div>
                                <button
                                    onClick={() => setShowRawEntryModal(false)}
                                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="mt-3 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                <span>
                                    Solo para conteo físico, inventario inicial o vaciar. Las <b>compras</b> se registran con
                                    el botón <b>Compra</b> (factura del proveedor) para que queden la cuenta por pagar y el
                                    costo real.
                                </span>
                            </div>

                            <form onSubmit={handleSaveRawEntry} className="mt-4 space-y-4">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <span className="block text-[10px] font-semibold text-[#949E97] mb-1">En sistema</span>
                                        <div className="rounded border border-dashed border-[#C8CDC9] bg-slate-50 px-2.5 py-1.5 text-sm font-bold text-[#2E4040]">
                                            {current.toLocaleString('es-CO', { maximumFractionDigits: 2 })} kg
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-semibold text-[#949E97] mb-1">Kilos contados *</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            required
                                            value={rawEntryKg}
                                            onChange={(e) => setRawEntryKg(e.target.value)}
                                            className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                </div>

                                {diff !== 0 && (
                                    <p className={`text-[11px] font-semibold ${diff > 0 ? 'text-[#3F8346]' : 'text-red-700'}`}>
                                        Ajuste en Kardex: {diff > 0 ? '+' : ''}
                                        {diff.toLocaleString('es-CO', { maximumFractionDigits: 2 })} kg
                                    </p>
                                )}

                                {diff > 0 && (
                                    <div>
                                        <label className="block text-[10px] font-semibold text-[#949E97] mb-1">
                                            Costo por kg de lo que entra ($)
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={rawEntryCost}
                                            onChange={(e) => setRawEntryCost(e.target.value)}
                                            className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                                        />
                                        <span className="text-[10px] text-[#949E97]">
                                            Para inventario inicial. El costo promedio se recalcula ponderado.
                                        </span>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-[10px] font-semibold text-[#949E97] mb-1">Motivo</label>
                                    <input
                                        type="text"
                                        value={rawEntryNotes}
                                        onChange={(e) => setRawEntryNotes(e.target.value)}
                                        placeholder={current === 0 ? 'Inventario inicial' : 'Conteo físico'}
                                        className="w-full rounded border border-[#C8CDC9] px-2.5 py-1.5 text-xs focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>

                                <div className="flex items-center justify-between gap-3 border-t border-[#C8CDC9] pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setRawEntryKg('0')}
                                        className="text-[11px] font-semibold text-amber-700 hover:underline"
                                    >
                                        Vaciar (0 kg)
                                    </button>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setShowRawEntryModal(false)}
                                            className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={saving || diff === 0}
                                            className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar ajuste'}
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                );
            })()}

            {/* Compra de bobina madre = factura de compra */}
            {purchaseFor && (
                <InvoiceFormModal
                    suppliers={suppliers}
                    rawMaterials={rawMaterials}
                    coreMaterials={coreMaterials}
                    inventoryItems={invItems}
                    initialLine={{ type: 'bobina', refId: purchaseFor.rawId }}
                    onClose={() => setPurchaseFor(null)}
                    onSaved={() => {
                        setPurchaseFor(null);
                        fetchInventoryData();
                    }}
                />
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

                            <div className="grid grid-cols-3 gap-3">
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
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040] mb-1">
                                        Calibre (micras) *:
                                    </label>
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        step="0.1"
                                        value={newRawCaliber}
                                        onChange={(e) => setNewRawCaliber(e.target.value)}
                                        placeholder="17"
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
            {/* MODAL: REGISTRAR ARMADO DE CORES                                */}
            {/* ============================================================== */}
            {showCoreModal && selectedCoreForEntry && (() => {
                const c = selectedCoreForEntry;
                const material = coreMaterials.find((m) => m.id === c.core_material_id) || null;
                const units = Math.floor(Number(coreEntryUnits) || 0);
                const weight = Number(c.weight_grams || 0);
                // kg a descontar = unidades x peso promedio del core armado
                const kgUsed = (units * weight) / 1000;
                const available = Number(material?.current_stock_kg || 0);
                const materialCost = kgUsed * Number(material?.cost_per_kg || 0);
                const laborCost = units * Number(c.labor_cost_per_unit || 0);
                const unitCost = units > 0 ? (materialCost + laborCost) / units : 0;
                const missingWeight = weight <= 0;
                const insufficient = !!material && kgUsed > available;
                const blocked = !material || missingWeight || insufficient || units <= 0;

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                            <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                                <h3 className="font-heading text-lg font-bold text-[#2E4040]">Registrar Armado de Cores</h3>
                                <button
                                    onClick={() => setShowCoreModal(false)}
                                    className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <form onSubmit={handleSaveCoreEntry} className="mt-4 space-y-4">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Medida armada:</label>
                                    <select
                                        value={c.id}
                                        onChange={(e) => {
                                            const found = cores.find((x) => x.id === e.target.value);
                                            if (found) setSelectedCoreForEntry(found);
                                        }}
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    >
                                        {cores.map((x) => (
                                            <option key={x.id} value={x.id}>
                                                {x.name} ({x.length_cm} cm) — Stock: {x.current_stock_units} und
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                            Cores armados (und) *:
                                        </label>
                                        <input
                                            type="number"
                                            required
                                            min="1"
                                            step="1"
                                            value={coreEntryUnits}
                                            onChange={(e) => setCoreEntryUnits(e.target.value)}
                                            placeholder="Ej: 100"
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <p className="-mt-2 text-[11px] text-[#949E97]">
                                    Kg a descontar = cores armados × peso promedio del core armado (
                                    {weight > 0 ? `${weight.toLocaleString('es-CO')} g` : 'sin definir'}).
                                </p>

                                <div
                                    className={`rounded-lg border p-3 text-xs ${
                                        blocked && units > 0 ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-100 bg-blue-50 text-blue-900'
                                    }`}
                                >
                                    {!material ? (
                                        <span className="font-semibold">
                                            Esta medida no tiene material asignado. Usa &quot;Editar&quot; en la medida para asignarlo.
                                        </span>
                                    ) : (
                                        <div className="space-y-1">
                                            <div className="flex justify-between">
                                                <span>
                                                    Material ({units} × {weight.toLocaleString('es-CO')} g):
                                                </span>
                                                <span className="font-semibold">
                                                    {fmtKg(kgUsed)} kg de {fmtKg(available)} kg
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Costo material:</span>
                                                <span>{fmtCOP(materialCost)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Mano de obra:</span>
                                                <span>{fmtCOP(laborCost)}</span>
                                            </div>
                                            <div className="flex justify-between border-t border-current/20 pt-1 font-bold">
                                                <span>Costo por core:</span>
                                                <span>{fmtCOP(unitCost)}</span>
                                            </div>
                                            {insufficient && (
                                                <div className="pt-1 font-semibold text-red-700">
                                                    Material insuficiente: faltan {fmtKg(kgUsed - available)} kg. Registra la compra
                                                    o ajusta el conteo del material.
                                                </div>
                                            )}
                                            {missingWeight && units > 0 && (
                                                <div className="pt-1 font-semibold text-red-700">
                                                    La medida no tiene peso promedio del core armado: defínelo con
                                                    &quot;Editar&quot;.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Notas:</label>
                                    <input
                                        type="text"
                                        value={coreEntryNotes}
                                        onChange={(e) => setCoreEntryNotes(e.target.value)}
                                        placeholder="Ej: Turno de la mañana - Lote 1"
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowCoreModal(false)}
                                        className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving || blocked}
                                        className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Registrar Armado'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                );
            })()}

            {/* ============================================================== */}
            {/* MODAL: EDITAR MEDIDA DE CORE                                    */}
            {/* ============================================================== */}
            {showEditCoreCostModal && editingCore && (() => {
                const material = coreMaterials.find((m) => m.id === editCoreMaterialId) || null;
                const estimate = estimateCoreUnitCost(
                    {
                        ...editingCore,
                        weight_grams: Number(editCoreWeight || 0),
                        labor_cost_per_unit: Number(editCoreLabor || 0),
                    },
                    material
                );
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                            <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                                <h3 className="font-heading text-base font-bold text-[#2E4040]">
                                    Editar {editingCore.name} ({editingCore.length_cm} cm)
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
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Material de cores:</label>
                                    <select
                                        value={editCoreMaterialId}
                                        onChange={(e) => setEditCoreMaterialId(e.target.value)}
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs font-semibold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    >
                                        <option value="">— Sin asignar —</option>
                                        {coreMaterials.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.name} ({fmtKg(Number(m.current_stock_kg || 0))} kg)
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                            Peso core armado (g):
                                        </label>
                                        <input
                                            type="number"
                                            required
                                            min="0"
                                            step="1"
                                            value={editCoreWeight}
                                            onChange={(e) => setEditCoreWeight(e.target.value)}
                                            placeholder="Ej: 120"
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                            Mano de obra / core ($):
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={editCoreLabor}
                                            onChange={(e) => setEditCoreLabor(e.target.value)}
                                            placeholder="Ej: 150"
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <p className="-mt-2 text-[11px] text-[#949E97]">
                                    El peso convierte kg de material en unidades y se resta del peso del rollo para calcular la
                                    película. Los pedidos ya creados conservan el peso que tenían.
                                </p>

                                <div className="rounded-lg bg-[#F8F9FA] p-3 text-xs text-[#2E4040]">
                                    Costo estimado del próximo armado: <b>{fmtCOP(estimate)}</b> por core
                                    {material ? ` (${fmtCOP(Number(material.cost_per_kg || 0))}/kg)` : ''}.
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                        Costo promedio en stock ($ por core):
                                    </label>
                                    <input
                                        type="number"
                                        required
                                        min="0"
                                        value={editCoreCost}
                                        onChange={(e) => setEditCoreCost(e.target.value)}
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                    <p className="mt-1 text-[11px] text-[#949E97]">
                                        Se recalcula solo en cada armado. Cámbialo únicamente para corregir el valor de los cores
                                        que ya están en stock.
                                    </p>
                                </div>

                                <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
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
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar Cambios'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                );
            })()}

            {/* ============================================================== */}
            {/* MODAL: CREAR NUEVA MEDIDA DE CORE                               */}
            {/* ============================================================== */}
            {showNewCoreModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-base font-bold text-[#2E4040]">Nueva Medida de Core</h3>
                            <button
                                onClick={() => setShowNewCoreModal(false)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {coreMaterials.length === 0 ? (
                            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                                Primero crea un material de cores con &quot;Nuevo Material (Kg)&quot;.
                            </div>
                        ) : (
                            <form onSubmit={handleCreateCore} className="mt-4 space-y-4">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Nombre Identificador:</label>
                                    <input
                                        type="text"
                                        required
                                        value={newCoreName}
                                        onChange={(e) => setNewCoreName(e.target.value)}
                                        placeholder="Ej: Core Cartón 50 cm"
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Medida (cm):</label>
                                        <input
                                            type="number"
                                            required
                                            min="1"
                                            step="1"
                                            value={newCoreLength}
                                            onChange={(e) => setNewCoreLength(e.target.value)}
                                            placeholder="15, 30, 45, 50, 60..."
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Material:</label>
                                        <select
                                            value={newCoreMaterialId}
                                            onChange={(e) => setNewCoreMaterialId(e.target.value)}
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        >
                                            {coreMaterials.map((m) => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                            Peso core armado (g) *:
                                        </label>
                                        <input
                                            type="number"
                                            required
                                            min="1"
                                            step="1"
                                            value={newCoreWeight}
                                            onChange={(e) => setNewCoreWeight(e.target.value)}
                                            placeholder="Ej: 120"
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                            Mano de obra / core ($):
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={newCoreLabor}
                                            onChange={(e) => setNewCoreLabor(e.target.value)}
                                            placeholder="Ej: 150"
                                            className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                        />
                                    </div>
                                </div>
                                <p className="-mt-2 text-[11px] text-[#949E97]">
                                    Pesa varios cores ya armados de esta medida y saca el promedio. Ese peso convierte los kg de
                                    material en unidades.
                                </p>

                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">
                                        Alerta Stock Mínimo (unidades):
                                    </label>
                                    <input
                                        type="number"
                                        required
                                        min="1"
                                        value={newCoreMinStock}
                                        onChange={(e) => setNewCoreMinStock(e.target.value)}
                                        placeholder="30"
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowNewCoreModal(false)}
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
                        )}
                    </div>
                </div>
            )}

            {/* ============================================================== */}
            {/* MODAL: CREAR / EDITAR MATERIAL DE CORES                         */}
            {/* ============================================================== */}
            {materialForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-base font-bold text-[#2E4040]">
                                {materialForm.id ? 'Editar Material de Cores' : 'Nuevo Material de Cores'}
                            </h3>
                            <button onClick={() => setMaterialForm(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={handleSaveMaterial} className="mt-4 space-y-4">
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Nombre:</label>
                                <input
                                    type="text"
                                    required
                                    value={materialForm.name}
                                    onChange={(e) => setMaterialForm({ ...materialForm, name: e.target.value })}
                                    placeholder="Ej: Cartón para cores 3 pulgadas"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Costo / kg ($):</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={materialForm.cost}
                                        onChange={(e) => setMaterialForm({ ...materialForm, cost: e.target.value })}
                                        placeholder="Ej: 3800"
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Alerta mínimo (kg):</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={materialForm.minKg}
                                        onChange={(e) => setMaterialForm({ ...materialForm, minKg: e.target.value })}
                                        className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>
                            <p className="text-[11px] text-[#949E97]">
                                El costo/kg se recalcula por promedio ponderado con cada factura de compra. Edítalo aquí solo para
                                fijar el valor inicial o corregirlo.
                            </p>
                            <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
                                <button
                                    type="button"
                                    onClick={() => setMaterialForm(null)}
                                    className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============================================================== */}
            {/* MODAL: AJUSTE POR CONTEO FÍSICO DEL MATERIAL                    */}
            {/* ============================================================== */}
            {adjustMaterial && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] pb-3">
                            <h3 className="font-heading text-base font-bold text-[#2E4040]">Ajustar conteo: {adjustMaterial.name}</h3>
                            <button onClick={() => setAdjustMaterial(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={handleAdjustMaterial} className="mt-4 space-y-4">
                            <div className="text-xs text-[#949E97]">
                                Stock en sistema: <b className="text-[#2E4040]">{fmtKg(Number(adjustMaterial.current_stock_kg || 0))} kg</b>
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Kg reales contados en bodega *:</label>
                                <input
                                    type="number"
                                    required
                                    min="0"
                                    step="0.01"
                                    value={adjustKg}
                                    onChange={(e) => setAdjustKg(e.target.value)}
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-sm font-bold text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                                {adjustKg.trim() !== '' && (
                                    <p className="mt-1 text-[11px] text-[#949E97]">
                                        Diferencia:{' '}
                                        <b>
                                            {Number(adjustKg) - Number(adjustMaterial.current_stock_kg || 0) >= 0 ? '+' : ''}
                                            {fmtKg(Number(adjustKg) - Number(adjustMaterial.current_stock_kg || 0))} kg
                                        </b>{' '}
                                        (queda en el Kardex como ajuste manual)
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-semibold text-[#2E4040]">Motivo:</label>
                                <input
                                    type="text"
                                    value={adjustNotes}
                                    onChange={(e) => setAdjustNotes(e.target.value)}
                                    placeholder="Ej: Inventario inicial / conteo mensual"
                                    className="w-full rounded-lg border border-[#C8CDC9] bg-white px-3 py-2 text-xs text-[#2E4040] focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>
                            <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-3">
                                <button
                                    type="button"
                                    onClick={() => setAdjustMaterial(null)}
                                    className="rounded-lg border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-1.5 rounded-lg bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar Ajuste'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
