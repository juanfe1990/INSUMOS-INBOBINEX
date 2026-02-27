'use client';

import type { Product } from '@/lib/types'; // Asegúrate de actualizar este type con gallery, categoryId, y order
import {
    Image as ImageIcon,
    Loader2,
    Package,
    Pencil,
    Plus,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// Definimos el tipo para las categorías dinámicas
type Category = {
    id: string;
    name: string;
    slug: string;
};

type FormState = {
    name: string;
    description: string;
    categoryId: string;
    order: number;
    images: File[]; // Nuevos archivos a subir
    gallery: string[]; // URLs de imágenes existentes (para edición)
};

const emptyForm: FormState = {
    name: '',
    description: '',
    categoryId: '',
    order: 0,
    images: [],
    gallery: [],
};

export default function AdminPage() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [filterCategory, setFilterCategory] = useState('all');
    const fileRef = useRef<HTMLInputElement>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [prodRes, catRes] = await Promise.all([
                fetch('/api/products'),
                fetch('/api/categories'),
            ]);

            const prodData = await prodRes.json();
            const catData = await catRes.json();

            if (Array.isArray(prodData)) setProducts(prodData);
            if (Array.isArray(catData)) setCategories(catData);
        } catch (error) {
            toast.error('Error al cargar los datos');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Manejar selección de múltiples archivos
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        const newFiles = Array.from(files);
        setForm((prev) => ({
            ...prev,
            images: [...prev.images, ...newFiles],
        }));

        // Reseteamos el input para permitir seleccionar el mismo archivo de nuevo si se borró
        if (fileRef.current) fileRef.current.value = '';
    };

    const removeNewImage = (indexToRemove: number) => {
        setForm((prev) => ({
            ...prev,
            images: prev.images.filter((_, index) => index !== indexToRemove),
        }));
    };

    const removeExistingImage = (urlToRemove: string) => {
        setForm((prev) => ({
            ...prev,
            gallery: prev.gallery.filter((url) => url !== urlToRemove),
        }));
    };

    const openCreate = () => {
        setEditingId(null);
        setForm({ ...emptyForm, categoryId: categories[0]?.id || '' });
        setShowForm(true);
    };

    const openEdit = (product: Product) => {
        setEditingId(product.id);
        setForm({
            name: product.name,
            description: product.description || '',
            categoryId: product.categoryId || '', // Asumimos que el producto ahora guarda categoryId
            order: product.order || 0,
            images: [],
            // Cargamos la galería existente. Si el producto es antiguo y solo tiene imageUrl, lo convertimos a array.
            gallery:
                product.gallery?.length > 0
                    ? product.gallery
                    : product.imageUrl
                      ? [product.imageUrl]
                      : [],
        });
        setShowForm(true);
    };

    const closeForm = () => {
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.categoryId) {
            toast.error('Nombre y categoría son obligatorios');
            return;
        }

        setSaving(true);
        try {
            const formData = new FormData();
            formData.append('name', form.name.trim());
            formData.append('description', form.description.trim());
            formData.append('categoryId', form.categoryId);
            formData.append('order', form.order.toString());

            // Adjuntamos las URLs que el usuario decidió mantener (útil para el endpoint PUT)
            formData.append('keptGallery', JSON.stringify(form.gallery));

            // Adjuntamos todas las imágenes nuevas
            form.images.forEach((image) => {
                formData.append('images', image);
            });

            const url = editingId ? `/api/products/${editingId}` : '/api/products';
            const method = editingId ? 'PUT' : 'POST';

            const res = await fetch(url, { method, body: formData });
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Error ${res.status}`);
            }

            toast.success(editingId ? 'Producto actualizado' : 'Producto creado');
            closeForm();
            fetchData(); // Recargamos productos para ver los cambios
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error al guardar el producto';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;

        try {
            const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error');
            toast.success('Producto eliminado');
            fetchData();
        } catch {
            toast.error('Error al eliminar el producto');
        }
    };

    // Filtrado ajustado para usar el ID de categoría o slug dependiendo de cómo lo guardes
    const filtered =
        filterCategory === 'all'
            ? products
            : products.filter((p) => p.categoryId === filterCategory);

    // Ordenamos los productos filtrados por su campo "order"
    const sortedAndFiltered = [...filtered].sort((a, b) => (a.order || 0) - (b.order || 0));

    return (
        <div>
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="font-heading text-2xl font-bold text-[#2E4040]">
                        Gestionar Productos
                    </h1>
                    <p className="mt-1 text-sm text-[#949E97]">
                        {products.length} productos registrados
                    </p>
                </div>
                <button
                    onClick={openCreate}
                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                >
                    <Plus className="h-4 w-4" /> Agregar producto
                </button>
            </div>

            {/* Filters Dinámicos */}
            <div className="mt-6 flex flex-wrap gap-2">
                <button
                    onClick={() => setFilterCategory('all')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                        filterCategory === 'all'
                            ? 'bg-[#3F8346] text-[#FDFDFD]'
                            : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'
                    }`}
                >
                    Todos
                </button>
                {categories.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => setFilterCategory(cat.id)}
                        className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                            filterCategory === cat.id
                                ? 'bg-[#3F8346] text-[#FDFDFD]'
                                : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'
                        }`}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            {/* Product table */}
            {loading ? (
                <div className="mt-10 flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-[#3F8346]" />
                </div>
            ) : sortedAndFiltered.length === 0 ? (
                <div className="mt-10 flex flex-col items-center justify-center rounded-lg border border-dashed border-[#C8CDC9] py-20">
                    <Package className="h-12 w-12 text-[#C8CDC9]" />
                    <p className="mt-4 font-heading text-lg font-semibold text-[#2E4040]">
                        No hay productos
                    </p>
                    <p className="mt-1 text-sm text-[#949E97]">
                        Agrega tu primer producto para comenzar
                    </p>
                    <button
                        onClick={openCreate}
                        className="mt-4 flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2 text-sm font-semibold text-[#FDFDFD] hover:bg-[#2d6332]"
                    >
                        <Plus className="h-4 w-4" /> Agregar producto
                    </button>
                </div>
            ) : (
                <div className="mt-6 overflow-hidden rounded-lg border border-[#C8CDC9]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-[#C8CDC9] bg-[#C8CDC9]/20">
                                <tr>
                                    <th className="px-4 py-3 font-heading font-semibold text-[#2E4040]">
                                        Imagen
                                    </th>
                                    <th className="px-4 py-3 font-heading font-semibold text-[#2E4040]">
                                        Nombre
                                    </th>
                                    <th className="hidden px-4 py-3 font-heading font-semibold text-[#2E4040] md:table-cell">
                                        Categoría
                                    </th>
                                    <th className="hidden px-4 py-3 font-heading font-semibold text-[#2E4040] lg:table-cell">
                                        Posición
                                    </th>
                                    <th className="px-4 py-3 text-right font-heading font-semibold text-[#2E4040]">
                                        Acciones
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#C8CDC9]/50">
                                {sortedAndFiltered.map((product) => (
                                    <tr
                                        key={product.id}
                                        className="transition-colors hover:bg-[#C8CDC9]/10"
                                    >
                                        <td className="px-4 py-3">
                                            <div className="relative h-12 w-12 overflow-hidden rounded-md bg-[#C8CDC9]/20">
                                                {product.imageUrl ? (
                                                    <Image
                                                        src={product.imageUrl}
                                                        alt={product.name}
                                                        fill
                                                        className="object-cover"
                                                    />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center">
                                                        <ImageIcon className="h-5 w-5 text-[#949E97]" />
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-semibold text-[#2E4040]">
                                            {product.name}
                                        </td>
                                        <td className="hidden px-4 py-3 text-[#949E97] md:table-cell">
                                            <span className="rounded-full bg-[#3F8346]/10 px-2.5 py-0.5 text-xs font-semibold text-[#3F8346]">
                                                {categories.find((c) => c.id === product.categoryId)
                                                    ?.name || 'Sin categoría'}
                                            </span>
                                        </td>
                                        <td className="hidden px-4 py-3 text-[#949E97] lg:table-cell">
                                            {product.order || 0}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    onClick={() => openEdit(product)}
                                                    className="rounded-md p-2 text-[#949E97] transition-colors hover:bg-[#3F8346]/10 hover:text-[#3F8346]"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDelete(product.id, product.name)
                                                    }
                                                    className="rounded-md p-2 text-[#949E97] transition-colors hover:bg-red-50 hover:text-red-600"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Modal form */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#2E4040]/60 p-4 pt-20">
                    <div className="w-full max-w-lg rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl my-8">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                            <h2 className="font-heading text-lg font-bold text-[#2E4040]">
                                {editingId ? 'Editar producto' : 'Nuevo producto'}
                            </h2>
                            <button
                                onClick={closeForm}
                                className="rounded-md p-1 text-[#949E97] transition-colors hover:bg-[#C8CDC9]/30 hover:text-[#2E4040]"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
                            <div className="grid grid-cols-2 gap-4">
                                {/* Name */}
                                <div className="col-span-2">
                                    <label
                                        htmlFor="name"
                                        className="mb-1.5 block text-sm font-semibold text-[#2E4040]"
                                    >
                                        Nombre *
                                    </label>
                                    <input
                                        id="name"
                                        type="text"
                                        value={form.name}
                                        onChange={(e) =>
                                            setForm((p) => ({ ...p, name: e.target.value }))
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                                        required
                                    />
                                </div>

                                {/* Category */}
                                <div>
                                    <label
                                        htmlFor="categoryId"
                                        className="mb-1.5 block text-sm font-semibold text-[#2E4040]"
                                    >
                                        Categoría *
                                    </label>
                                    <select
                                        id="categoryId"
                                        value={form.categoryId}
                                        onChange={(e) =>
                                            setForm((p) => ({ ...p, categoryId: e.target.value }))
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                                        required
                                    >
                                        <option value="" disabled>
                                            Selecciona una...
                                        </option>
                                        {categories.map((cat) => (
                                            <option key={cat.id} value={cat.id}>
                                                {cat.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Order */}
                                <div>
                                    <label
                                        htmlFor="order"
                                        className="mb-1.5 block text-sm font-semibold text-[#2E4040]"
                                    >
                                        Posición (Orden)
                                    </label>
                                    <input
                                        id="order"
                                        type="number"
                                        value={form.order}
                                        onChange={(e) =>
                                            setForm((p) => ({
                                                ...p,
                                                order: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                                    />
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label
                                    htmlFor="description"
                                    className="mb-1.5 block text-sm font-semibold text-[#2E4040]"
                                >
                                    Descripción
                                </label>
                                <textarea
                                    id="description"
                                    value={form.description}
                                    onChange={(e) =>
                                        setForm((p) => ({ ...p, description: e.target.value }))
                                    }
                                    rows={3}
                                    className="w-full resize-none rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                                />
                            </div>

                            {/* Galería de Imágenes */}
                            <div>
                                <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-[#2E4040]">
                                    <span>Galería de Imágenes</span>
                                    <span className="text-xs font-normal text-[#949E97]">
                                        Opcional
                                    </span>
                                </label>

                                {/* Cuadrícula de vistas previas */}
                                {(form.gallery.length > 0 || form.images.length > 0) && (
                                    <div className="mb-3 grid grid-cols-4 gap-2">
                                        {/* Imágenes existentes (en Firebase) */}
                                        {form.gallery.map((url, idx) => (
                                            <div
                                                key={`exist-${idx}`}
                                                className="relative aspect-square overflow-hidden rounded-md border border-[#C8CDC9]"
                                            >
                                                <Image
                                                    src={url}
                                                    alt={`Imagen guardada ${idx}`}
                                                    fill
                                                    className="object-cover"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeExistingImage(url)}
                                                    className="absolute right-1 top-1 rounded-full bg-red-500/80 p-1 text-white hover:bg-red-600"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {/* Imágenes nuevas (locales) */}
                                        {form.images.map((file, idx) => (
                                            <div
                                                key={`new-${idx}`}
                                                className="relative aspect-square overflow-hidden rounded-md border border-green-300"
                                            >
                                                <Image
                                                    src={URL.createObjectURL(file)}
                                                    alt={`Nueva imagen ${idx}`}
                                                    fill
                                                    className="object-cover"
                                                />
                                                <div className="absolute bottom-0 left-0 right-0 bg-green-500/80 py-0.5 text-center text-[10px] text-white">
                                                    Nueva
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => removeNewImage(idx)}
                                                    className="absolute right-1 top-1 rounded-full bg-red-500/80 p-1 text-white hover:bg-red-600"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handleImageChange}
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileRef.current?.click()}
                                    className="flex w-full flex-col items-center justify-center rounded-md border-2 border-dashed border-[#C8CDC9] px-4 py-6 text-[#949E97] transition-colors hover:border-[#3F8346] hover:text-[#3F8346]"
                                >
                                    <Upload className="mb-2 h-5 w-5" />
                                    <span className="text-sm font-medium">Añadir imágenes</span>
                                    <span className="mt-1 text-xs">
                                        Puedes seleccionar varias a la vez
                                    </span>
                                </button>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-5">
                                <button
                                    type="button"
                                    onClick={closeForm}
                                    className="rounded-md border border-[#C8CDC9] px-5 py-2.5 text-sm font-semibold text-[#2E4040] transition-colors hover:bg-[#C8CDC9]/20"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {editingId ? 'Guardar cambios' : 'Crear producto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
