'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Client } from '@/lib/types';
import { Building2, Plus, Search, Loader2, Phone, MapPin, Mail, UserCheck, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ClientsPanel() {
    const supabase = createClient();
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);

    const [form, setForm] = useState({
        business_name: '',
        nit_rut: '',
        contact_name: '',
        phone: '',
        email: '',
        delivery_address: '',
        city: 'Medellín',
        notes: '',
    });

    const fetchClients = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('clients')
                .select('*')
                .order('business_name', { ascending: true });

            if (error) throw error;
            setClients((data as Client[]) || []);
        } catch (err: any) {
            toast.error('Error al cargar clientes: ' + (err.message || 'Error desconocido'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchClients();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.business_name || !form.contact_name || !form.phone || !form.delivery_address) {
            toast.error('Por favor completa los campos obligatorios (*)');
            return;
        }

        try {
            setSaving(true);
            const clientData = {
                business_name: form.business_name.trim(),
                nit_rut: form.nit_rut.trim() || null,
                contact_name: form.contact_name.trim(),
                phone: form.phone.trim(),
                email: form.email.trim() || null,
                delivery_address: form.delivery_address.trim(),
                city: form.city.trim() || 'Medellín',
                notes: form.notes.trim() || null,
            };

            if (editingClient) {
                const { error } = await supabase
                    .from('clients')
                    .update(clientData)
                    .eq('id', editingClient.id);
                if (error) throw error;
                toast.success('Cliente actualizado con éxito');
            } else {
                const { error } = await supabase.from('clients').insert([clientData]);
                if (error) throw error;
                toast.success('Cliente registrado con éxito');
            }

            setShowModal(false);
            setEditingClient(null);
            setForm({
                business_name: '',
                nit_rut: '',
                contact_name: '',
                phone: '',
                email: '',
                delivery_address: '',
                city: 'Medellín',
                notes: '',
            });
            fetchClients();
        } catch (err: any) {
            toast.error('Error guardando cliente: ' + (err.message || 'Error'));
        } finally {
            setSaving(false);
        }
    };

    const filteredClients = clients.filter(
        (c) =>
            c.business_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (c.nit_rut && c.nit_rut.toLowerCase().includes(searchTerm.toLowerCase())) ||
            c.contact_name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6">
            {/* Header del módulo */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="font-heading text-2xl font-bold text-[#2E4040]">
                        Directorio de Clientes
                    </h2>
                    <p className="text-sm text-[#949E97]">
                        {clients.length} clientes registrados en el CRM (Supabase)
                    </p>
                </div>
                <button
                    onClick={() => {
                        setEditingClient(null);
                        setForm({
                            business_name: '',
                            nit_rut: '',
                            contact_name: '',
                            phone: '',
                            email: '',
                            delivery_address: '',
                            city: 'Medellín',
                            notes: '',
                        });
                        setShowModal(true);
                    }}
                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                >
                    <Plus className="h-4 w-4" /> Nuevo Cliente
                </button>
            </div>

            {/* Buscador */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949E97]" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar por Razón Social, NIT o Contacto..."
                    className="w-full rounded-md border border-[#C8CDC9] bg-white py-2 pl-9 pr-4 text-sm focus:border-[#3F8346] focus:outline-none"
                />
            </div>

            {/* Listado de Clientes */}
            {loading ? (
                <div className="flex justify-center py-16">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : filteredClients.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[#C8CDC9] bg-white/50 py-16 text-center">
                    <Building2 className="h-10 w-10 text-[#949E97]" />
                    <p className="mt-3 font-semibold text-[#2E4040]">No hay clientes encontrados</p>
                    <p className="text-xs text-[#949E97]">Agrega un nuevo cliente para gestionar sus pedidos</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredClients.map((client) => (
                        <div
                            key={client.id}
                            className="rounded-lg border border-[#C8CDC9] bg-white p-5 shadow-sm transition hover:shadow-md"
                        >
                            <div className="flex items-start justify-between">
                                <div>
                                    <h3 className="font-semibold text-[#2E4040]">{client.business_name}</h3>
                                    {client.nit_rut && (
                                        <span className="text-xs font-mono text-[#949E97]">
                                            NIT: {client.nit_rut}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            setEditingClient(client);
                                            setForm({
                                                business_name: client.business_name,
                                                nit_rut: client.nit_rut || '',
                                                contact_name: client.contact_name,
                                                phone: client.phone,
                                                email: client.email || '',
                                                delivery_address: client.delivery_address,
                                                city: client.city || 'Medellín',
                                                notes: client.notes || '',
                                            });
                                            setShowModal(true);
                                        }}
                                        className="rounded-md bg-[#C8CDC9]/20 p-1.5 text-[#2E4040] hover:bg-[#C8CDC9]/40"
                                        title="Editar Cliente"
                                    >
                                        <Edit2 className="h-4 w-4" />
                                    </button>
                                    <span className="rounded-full bg-[#3F8346]/10 px-2.5 py-0.5 text-xs font-semibold text-[#3F8346]">
                                        {client.city}
                                    </span>
                                </div>
                            </div>

                            <div className="mt-4 space-y-2 text-xs text-[#2E4040]">
                                <div className="flex items-center gap-2">
                                    <UserCheck className="h-3.5 w-3.5 text-[#949E97]" />
                                    <span>{client.contact_name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Phone className="h-3.5 w-3.5 text-[#949E97]" />
                                    <span>{client.phone}</span>
                                </div>
                                {client.email && (
                                    <div className="flex items-center gap-2">
                                        <Mail className="h-3.5 w-3.5 text-[#949E97]" />
                                        <span>{client.email}</span>
                                    </div>
                                )}
                                <div className="flex items-start gap-2">
                                    <MapPin className="h-3.5 w-3.5 shrink-0 text-[#949E97]" />
                                    <span className="truncate">{client.delivery_address}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modal de Alta de Cliente */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-lg rounded-xl bg-[#FDFDFD] p-6 shadow-xl">
                        <h3 className="text-lg font-bold text-[#2E4040]">
                            {editingClient ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}
                        </h3>
                        <p className="text-xs text-[#949E97]">
                            Ingresa los datos para registrar solicitudes y entregas
                        </p>

                        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Razón Social *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={form.business_name}
                                        onChange={(e) => setForm({ ...form, business_name: e.target.value })}
                                        placeholder="Ej: Embalajes del Valle SAS"
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">NIT / RUT</label>
                                    <input
                                        type="text"
                                        value={form.nit_rut}
                                        onChange={(e) => setForm({ ...form, nit_rut: e.target.value })}
                                        placeholder="Ej: 901.234.567-8"
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Contacto Principal *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={form.contact_name}
                                        onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                                        placeholder="Ej: Juan Pérez"
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">Teléfono *</label>
                                    <input
                                        type="text"
                                        required
                                        value={form.phone}
                                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                        placeholder="Ej: 3001234567"
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040]">
                                    Correo Electrónico
                                </label>
                                <input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                    placeholder="contacto@empresa.com"
                                    className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2">
                                    <label className="block text-xs font-semibold text-[#2E4040]">
                                        Dirección de Entrega *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        value={form.delivery_address}
                                        onChange={(e) => setForm({ ...form, delivery_address: e.target.value })}
                                        placeholder="Calle 10 # 20 - 30 Bodega 4"
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-[#2E4040]">Ciudad</label>
                                    <input
                                        type="text"
                                        value={form.city}
                                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                                        className="mt-1 w-full rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-[#2E4040]">Observaciones</label>
                                <textarea
                                    value={form.notes}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                    rows={2}
                                    placeholder="Horario de recepción, requerimiento de factura física, etc."
                                    className="mt-1 w-full resize-none rounded-md border border-[#C8CDC9] px-3 py-1.5 text-sm focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="rounded-md border border-[#C8CDC9] px-4 py-2 text-xs font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2 text-xs font-semibold text-white hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    {editingClient ? 'Actualizar Cliente' : 'Guardar Cliente'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
