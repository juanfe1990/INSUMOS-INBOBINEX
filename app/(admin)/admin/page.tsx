'use client';

import type { Category, Product } from '@/lib/types';
import {
    Image as ImageIcon,
    Loader2,
    Package,
    Pencil,
    Plus,
    Tags,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type ProductFormState = {
    name: string;
    description: string;
    categoryId: string;
    order: number;
    images: File[];
    gallery: string[];
};

const emptyProductForm: ProductFormState = {
    name: '',
    description: '',
    categoryId: '',
    order: 0,
    images: [],
    gallery: [],
};

export default function AdminPage() {
    // --- Estados Generales ---
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterCategory, setFilterCategory] = useState('all');

    // --- Estados de Productos ---
    const [savingProduct, setSavingProduct] = useState(false);
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProductId, setEditingProductId] = useState<string | null>(null);
    const [productForm, setProductForm] = useState<ProductFormState>(emptyProductForm);

    const fileRef = useRef<HTMLInputElement>(null);

    // --- Estados de Categorías ---
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [savingCategory, setSavingCategory] = useState(false);
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [categoryForm, setCategoryForm] = useState({ name: '', description: '' });

    // --- Fetch de Datos ---
    const fetchCategories = async () => {
        const toastId = toast.loading('Actualizando categorías...');
        try {
            const res = await fetch('/api/categories');
            const data = await res.json();
            if (Array.isArray(data)) setCategories(data);
            toast.success('Categorías actualizadas', { id: toastId });
        } catch (error) {
            toast.error('Error al cargar categorías', { id: toastId });
        }
    };

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

    // ==========================================
    // LÓGICA DE CATEGORÍAS
    // ==========================================
    const closeCategoryModal = () => {
        setShowCategoryModal(false);
        setEditingCategoryId(null);
        setCategoryForm({ name: '', description: '' });
    };

    const openEditCategory = (cat: Category) => {
        setEditingCategoryId(cat.id);
        setCategoryForm({ name: cat.name, description: cat.description || '' });
    };

    const handleCategorySubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!categoryForm.name.trim()) {
            toast.error('El nombre de la categoría es obligatorio');
            return;
        }

        const toastId = toast.loading(
            editingCategoryId ? 'Actualizando categoría...' : 'Creando categoría...',
        );
        setSavingCategory(true);

        try {
            const url = editingCategoryId
                ? `/api/categories/${editingCategoryId}`
                : '/api/categories';
            const method = editingCategoryId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: categoryForm.name.trim(),
                    description: categoryForm.description.trim(),
                }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `Error ${res.status}`);
            }

            toast.success(
                editingCategoryId
                    ? 'Categoría actualizada con éxito'
                    : 'Categoría creada con éxito',
                { id: toastId },
            );

            setEditingCategoryId(null);
            setCategoryForm({ name: '', description: '' });
            fetchCategories();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error al guardar la categoría';
            toast.error(message, { id: toastId });
        } finally {
            setSavingCategory(false);
        }
    };

    const handleDeleteCategory = async (id: string, name: string) => {
        if (
            !confirm(
                `¿Eliminar la categoría "${name}"? Los productos pasarán a estar "Sin categoría".`,
            )
        )
            return;

        const toastId = toast.loading(`Eliminando categoría "${name}"...`);
        try {
            const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error al eliminar');

            toast.success('Categoría eliminada con éxito', { id: toastId });
            fetchData();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error al eliminar la categoría';
            toast.error(message, { id: toastId });
        }
    };

    // ==========================================
    // LÓGICA DE PRODUCTOS
    // ==========================================
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        const newFiles = Array.from(files);
        setProductForm((prev) => ({ ...prev, images: [...prev.images, ...newFiles] }));
        if (fileRef.current) fileRef.current.value = '';
    };

    const removeNewImage = (indexToRemove: number) => {
        setProductForm((prev) => ({
            ...prev,
            images: prev.images.filter((_, index) => index !== indexToRemove),
        }));
    };

    const removeExistingImage = (urlToRemove: string) => {
        setProductForm((prev) => ({
            ...prev,
            gallery: prev.gallery.filter((url) => url !== urlToRemove),
        }));
    };

    const openCreateProduct = () => {
        setEditingProductId(null);
        setProductForm({ ...emptyProductForm, categoryId: categories[0]?.id || '' });
        setShowProductModal(true);
    };

    const openEditProduct = (product: Product) => {
        setEditingProductId(product.id);
        setProductForm({
            name: product.name,
            description: product.description || '',
            categoryId: product.categoryId || '',
            order: product.order || 0,
            images: [],
            gallery:
                product.gallery?.length > 0
                    ? product.gallery
                    : product.imageUrl
                      ? [product.imageUrl]
                      : [],
        });
        setShowProductModal(true);
    };

    const closeProductModal = () => {
        setShowProductModal(false);
        setEditingProductId(null);
        setProductForm(emptyProductForm);
    };

    const handleProductSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!productForm.name.trim() || !productForm.categoryId) {
            toast.error('Nombre y categoría son obligatorios');
            return;
        }

        const toastId = toast.loading(
            editingProductId ? 'Actualizando producto...' : 'Creando producto...',
        );
        setSavingProduct(true);

        try {
            const formData = new FormData();
            formData.append('name', productForm.name.trim());
            formData.append('description', productForm.description.trim());
            formData.append('categoryId', productForm.categoryId);
            formData.append('order', productForm.order.toString());
            formData.append('keptGallery', JSON.stringify(productForm.gallery));

            productForm.images.forEach((image) => formData.append('images', image));

            const url = editingProductId ? `/api/products/${editingProductId}` : '/api/products';
            const method = editingProductId ? 'PUT' : 'POST';

            const res = await fetch(url, { method, body: formData });
            if (!res.ok) throw new Error('Error al guardar el producto');

            toast.success(
                editingProductId ? 'Producto actualizado con éxito' : 'Producto creado con éxito',
                { id: toastId },
            );
            closeProductModal();
            fetchData();
        } catch (err) {
            toast.error('Error al guardar el producto', { id: toastId });
        } finally {
            setSavingProduct(false);
        }
    };

    const handleDeleteProduct = async (id: string, name: string) => {
        if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;

        const toastId = toast.loading(`Eliminando producto "${name}"...`);
        try {
            const res = await fetch(`/api/products/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Error');

            toast.success('Producto eliminado con éxito', { id: toastId });
            fetchData();
        } catch {
            toast.error('Error al eliminar el producto', { id: toastId });
        }
    };

    const filtered =
        filterCategory === 'all'
            ? products
            : products.filter((p) => p.categoryId === filterCategory);
    const sortedAndFiltered = [...filtered].sort((a, b) => (a.order || 0) - (b.order || 0));

    return (
        <div>
            {/* --- HEADER --- */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="font-heading text-2xl font-bold text-[#2E4040]">
                        Gestionar Inventario
                    </h1>
                    <p className="mt-1 text-sm text-[#949E97]">
                        {products.length} productos registrados
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowCategoryModal(true)}
                        className="flex items-center gap-2 rounded-md border border-[#C8CDC9] bg-[#FDFDFD] px-5 py-2.5 text-sm font-semibold text-[#2E4040] transition-colors hover:bg-[#C8CDC9]/20"
                    >
                        <Tags className="h-4 w-4" /> Categorías
                    </button>
                    <button
                        onClick={openCreateProduct}
                        className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                    >
                        <Plus className="h-4 w-4" /> Agregar producto
                    </button>
                </div>
            </div>

            {/* --- FILTROS --- */}
            <div className="mt-6 flex flex-wrap gap-2">
                <button
                    onClick={() => setFilterCategory('all')}
                    className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${filterCategory === 'all' ? 'bg-[#3F8346] text-[#FDFDFD]' : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'}`}
                >
                    Todos
                </button>
                {categories.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => setFilterCategory(cat.id)}
                        className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${filterCategory === cat.id ? 'bg-[#3F8346] text-[#FDFDFD]' : 'bg-[#C8CDC9]/30 text-[#2E4040] hover:bg-[#C8CDC9]/50'}`}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            {/* --- TABLA DE PRODUCTOS --- */}
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
                </div>
            ) : (
                <div className="mt-6 overflow-hidden rounded-lg border border-[#C8CDC9]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-[#C8CDC9] bg-[#C8CDC9]/20">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-[#2E4040]">
                                        Imagen
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-[#2E4040]">
                                        Nombre
                                    </th>
                                    <th className="hidden px-4 py-3 font-semibold text-[#2E4040] md:table-cell">
                                        Categoría
                                    </th>
                                    <th className="hidden px-4 py-3 font-semibold text-[#2E4040] lg:table-cell">
                                        Posición
                                    </th>
                                    <th className="px-4 py-3 text-right font-semibold text-[#2E4040]">
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
                                                        unoptimized
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
                                                    onClick={() => openEditProduct(product)}
                                                    className="rounded-md p-2 text-[#949E97] transition-colors hover:bg-[#3F8346]/10 hover:text-[#3F8346]"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDeleteProduct(
                                                            product.id,
                                                            product.name,
                                                        )
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

            {/* ========================================== */}
            {/* MODAL DE CATEGORÍAS                        */}
            {/* ========================================== */}
            {showCategoryModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2E4040]/60 p-4">
                    <div className="w-full max-w-md rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                            <h2 className="font-heading text-lg font-bold text-[#2E4040]">
                                Gestionar Categorías
                            </h2>
                            <button
                                onClick={closeCategoryModal}
                                className="rounded-md p-1 text-[#949E97] transition-colors hover:bg-[#C8CDC9]/30 hover:text-[#2E4040]"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6">
                            {/* Formulario de Categoría */}
                            <form
                                onSubmit={handleCategorySubmit}
                                className="mb-6 rounded-lg bg-[#C8CDC9]/10 p-4 border border-[#C8CDC9]/50"
                            >
                                <h3 className="mb-3 text-sm font-semibold text-[#2E4040]">
                                    {editingCategoryId ? 'Editar Categoría' : 'Nueva Categoría'}
                                </h3>
                                <div className="space-y-3">
                                    <input
                                        type="text"
                                        placeholder="Nombre de categoría"
                                        value={categoryForm.name}
                                        onChange={(e) =>
                                            setCategoryForm({
                                                ...categoryForm,
                                                name: e.target.value,
                                            })
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                        required
                                    />
                                    <input
                                        type="text"
                                        placeholder="Descripción (opcional)"
                                        value={categoryForm.description}
                                        onChange={(e) =>
                                            setCategoryForm({
                                                ...categoryForm,
                                                description: e.target.value,
                                            })
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            type="submit"
                                            disabled={savingCategory}
                                            className="flex-1 rounded-md bg-[#3F8346] px-3 py-2 text-sm font-semibold text-[#FDFDFD] hover:bg-[#2d6332] disabled:opacity-50"
                                        >
                                            {savingCategory
                                                ? 'Guardando...'
                                                : editingCategoryId
                                                  ? 'Actualizar'
                                                  : 'Crear'}
                                        </button>
                                        {editingCategoryId && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setEditingCategoryId(null);
                                                    setCategoryForm({ name: '', description: '' });
                                                }}
                                                className="rounded-md border border-[#C8CDC9] px-3 py-2 text-sm font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                            >
                                                Cancelar
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </form>

                            {/* Lista de Categorías con Hover */}
                            <h3 className="mb-2 text-sm font-semibold text-[#2E4040]">
                                Categorías Existentes
                            </h3>
                            <div className="max-h-60 overflow-y-auto rounded-md border border-[#C8CDC9] divide-y divide-[#C8CDC9]/50">
                                {categories.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-[#949E97]">
                                        No hay categorías.
                                    </div>
                                ) : (
                                    categories.map((cat) => (
                                        <div
                                            key={cat.id}
                                            className="group flex items-center justify-between p-3 transition-colors hover:bg-[#C8CDC9]/10"
                                        >
                                            <div>
                                                <p className="text-sm font-semibold text-[#2E4040]">
                                                    {cat.name}
                                                </p>
                                                {cat.description && (
                                                    <p className="text-xs text-[#949E97] truncate max-w-[200px]">
                                                        {cat.description}
                                                    </p>
                                                )}
                                            </div>
                                            {/* Botones invisibles que aparecen en hover */}
                                            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                <button
                                                    onClick={() => openEditCategory(cat)}
                                                    className="rounded-md p-1.5 text-[#949E97] hover:bg-[#3F8346]/10 hover:text-[#3F8346]"
                                                    title="Editar"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() =>
                                                        handleDeleteCategory(cat.id, cat.name)
                                                    }
                                                    className="rounded-md p-1.5 text-[#949E97] hover:bg-red-50 hover:text-red-600"
                                                    title="Eliminar"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ========================================== */}
            {/* MODAL DE PRODUCTOS                         */}
            {/* ========================================== */}
            {showProductModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#2E4040]/60 p-4 pt-20">
                    <div className="w-full max-w-lg rounded-xl border border-[#C8CDC9] bg-[#FDFDFD] shadow-2xl my-8">
                        <div className="flex items-center justify-between border-b border-[#C8CDC9] px-6 py-4">
                            <h2 className="font-heading text-lg font-bold text-[#2E4040]">
                                {editingProductId ? 'Editar producto' : 'Nuevo producto'}
                            </h2>
                            <button
                                onClick={closeProductModal}
                                className="rounded-md p-1 text-[#949E97] transition-colors hover:bg-[#C8CDC9]/30 hover:text-[#2E4040]"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleProductSubmit} className="space-y-5 px-6 py-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="mb-1.5 block text-sm font-semibold text-[#2E4040]">
                                        Nombre *
                                    </label>
                                    <input
                                        type="text"
                                        value={productForm.name}
                                        onChange={(e) =>
                                            setProductForm((p) => ({ ...p, name: e.target.value }))
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="mb-1.5 block text-sm font-semibold text-[#2E4040]">
                                        Categoría *
                                    </label>
                                    <select
                                        value={productForm.categoryId ? productForm.categoryId : ''}
                                        onChange={(e) =>
                                            setProductForm((p) => ({
                                                ...p,
                                                categoryId: e.target.value,
                                            }))
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
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
                                <div>
                                    <label className="mb-1.5 block text-sm font-semibold text-[#2E4040]">
                                        Posición
                                    </label>
                                    <input
                                        type="number"
                                        value={productForm.order}
                                        onChange={(e) =>
                                            setProductForm((p) => ({
                                                ...p,
                                                order: Number(e.target.value),
                                            }))
                                        }
                                        className="w-full rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-semibold text-[#2E4040]">
                                    Descripción
                                </label>
                                <textarea
                                    value={productForm.description}
                                    onChange={(e) =>
                                        setProductForm((p) => ({
                                            ...p,
                                            description: e.target.value,
                                        }))
                                    }
                                    rows={3}
                                    className="w-full resize-none rounded-md border border-[#C8CDC9] px-3 py-2 text-sm focus:border-[#3F8346] focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="mb-1.5 flex items-center justify-between text-sm font-semibold text-[#2E4040]">
                                    <span>Galería de Imágenes</span>
                                    <span className="text-xs font-normal text-[#949E97]">
                                        Opcional
                                    </span>
                                </label>
                                {(productForm.gallery.length > 0 ||
                                    productForm.images.length > 0) && (
                                    <div className="mb-3 grid grid-cols-4 gap-2">
                                        {productForm.gallery.map((url, idx) => (
                                            <div
                                                key={`exist-${idx}`}
                                                className="relative aspect-square overflow-hidden rounded-md border border-[#C8CDC9]"
                                            >
                                                <Image
                                                    src={url}
                                                    alt={`Guardada ${idx}`}
                                                    fill
                                                    className="object-cover"
                                                    unoptimized
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
                                        {productForm.images.map((file, idx) => (
                                            <div
                                                key={`new-${idx}`}
                                                className="relative aspect-square overflow-hidden rounded-md border border-green-300"
                                            >
                                                <Image
                                                    src={URL.createObjectURL(file)}
                                                    alt={`Nueva ${idx}`}
                                                    fill
                                                    className="object-cover"
                                                    unoptimized
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

                            <div className="flex items-center justify-end gap-3 border-t border-[#C8CDC9] pt-5">
                                <button
                                    type="button"
                                    onClick={closeProductModal}
                                    className="rounded-md border border-[#C8CDC9] px-5 py-2.5 text-sm font-semibold text-[#2E4040] hover:bg-[#C8CDC9]/20"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingProduct}
                                    className="flex items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] hover:bg-[#2d6332] disabled:opacity-50"
                                >
                                    {savingProduct && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {editingProductId ? 'Guardar cambios' : 'Crear producto'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
