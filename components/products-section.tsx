'use client';

import type { Category, Product } from '@/lib/types';
import { ArrowBigRight, Package } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function ProductsSection() {
    const [products, setProducts] = useState<Product[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            fetch('/api/products').then((res) => res.json()),
            fetch('/api/categories').then((res) => res.json()),
        ])
            .then(([productsData, categoriesData]) => {
                if (Array.isArray(productsData)) {
                    // Ordenamos los productos según el campo "order"
                    setProducts(productsData.sort((a, b) => (a.order || 0) - (b.order || 0)));
                }
                if (Array.isArray(categoriesData)) {
                    setCategories(categoriesData);
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, []);

    // Filtramos usando el categoryId nuevo
    const filteredProducts =
        activeCategory === 'all'
            ? products
            : products.filter((p) => p.categoryId === activeCategory);

    const getCategoryCount = (id: string) => products.filter((p) => p.categoryId === id).length;

    return (
        <section id="productos" className="bg-[#C8CDC9]/20 py-20">
            <div className="mx-auto max-w-7xl px-4">
                <div className="text-center">
                    <h2 className="font-heading text-3xl font-bold text-[#2E4040] md:text-4xl">
                        Nuestros <span className="text-[#3F8346]">productos</span>
                    </h2>
                    <p className="mx-auto mt-4 max-w-2xl text-[#949E97]">
                        Importamos y distribuimos una amplia gama de soluciones de embalaje para
                        proteger tu mercancía
                    </p>
                </div>

                {/* Filtro Dinámico de Categorías */}
                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                    <button
                        onClick={() => setActiveCategory('all')}
                        className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                            activeCategory === 'all'
                                ? 'bg-[#3F8346] text-[#FDFDFD]'
                                : 'bg-[#FDFDFD] text-[#2E4040] hover:bg-[#3F8346]/10'
                        }`}
                    >
                        Todos ({products.length})
                    </button>
                    {categories.map((cat) => {
                        const count = getCategoryCount(cat.id);
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                                    activeCategory === cat.id
                                        ? 'bg-[#3F8346] text-[#FDFDFD]'
                                        : 'bg-[#FDFDFD] text-[#2E4040] hover:bg-[#3F8346]/10'
                                }`}
                            >
                                {cat.name} ({count})
                            </button>
                        );
                    })}
                </div>

                {/* Cuadrícula de productos */}
                {loading ? (
                    <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="animate-pulse rounded-lg bg-[#FDFDFD] p-4">
                                <div className="aspect-square rounded-md bg-[#C8CDC9]" />
                                <div className="mt-4 h-4 w-3/4 rounded bg-[#C8CDC9]" />
                                <div className="mt-2 h-3 w-1/2 rounded bg-[#C8CDC9]" />
                            </div>
                        ))}
                    </div>
                ) : filteredProducts.length === 0 ? (
                    <div className="mt-16 text-center">
                        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#C8CDC9]/30">
                            <Package className="h-10 w-10 text-[#949E97]" />{' '}
                            {/* Asume que importas icon Package */}
                        </div>
                        <p className="text-lg font-semibold text-[#2E4040]">
                            {products.length === 0
                                ? 'Próximamente agregaremos productos'
                                : 'No hay productos en esta categoría'}
                        </p>
                        <p className="mt-1 text-sm text-[#949E97]">
                            Intenta con otra categoría o contáctanos.
                        </p>
                    </div>
                ) : (
                    <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredProducts.map((product) => (
                            <Link
                                href={`/productos/${product.slug}`}
                                key={product.id}
                                onClick={() => {
                                    // Guardamos el producto actual y el catálogo completo para los "Relacionados"
                                    sessionStorage.setItem(
                                        'currentProduct',
                                        JSON.stringify(product),
                                    );
                                    sessionStorage.setItem('fullCatalog', JSON.stringify(products));
                                }}
                                className="group overflow-hidden rounded-lg border border-[#C8CDC9] bg-[#FDFDFD] transition-all hover:border-[#3F8346] hover:shadow-lg flex flex-col"
                            >
                                <div className="relative aspect-square overflow-hidden bg-[#C8CDC9]/20">
                                    {product.imageUrl ? (
                                        <Image
                                            src={product.imageUrl}
                                            alt={product.name}
                                            fill
                                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                                            unoptimized
                                        />
                                    ) : (
                                        <Image
                                            src="/images/default-product.jpg"
                                            alt={product.name}
                                            fill
                                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                                            unoptimized
                                        />
                                    )}
                                    <div className="absolute left-3 top-3">
                                        <span className="rounded-full bg-[#3F8346] px-3 py-1 text-xs font-semibold text-[#FDFDFD]">
                                            {product.categoryName || 'Sin categoría'}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex flex-col flex-grow p-4">
                                    <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                        {product.name}
                                    </h3>
                                    {product.description && (
                                        <p className="mt-1 line-clamp-2 text-sm text-[#949E97] flex-grow">
                                            {product.description}
                                        </p>
                                    )}
                                    <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#3F8346] transition-colors group-hover:text-[#2d6332]">
                                        Ver detalles del producto
                                        <ArrowBigRight className="size-4" />
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
