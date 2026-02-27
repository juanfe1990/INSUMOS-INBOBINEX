"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { CATEGORIES, type Product } from "@/lib/types"

export function ProductsSection() {
  const [products, setProducts] = useState<Product[]>([])
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filteredProducts =
    activeCategory === "all"
      ? products
      : products.filter((p) => p.category === activeCategory)

  const getCategoryCount = (slug: string) =>
    products.filter((p) => p.category === slug).length

  return (
    <section id="productos" className="bg-[#C8CDC9]/20 py-20">
      <div className="mx-auto max-w-7xl px-4">
        <div className="text-center">
          <h2 className="font-heading text-3xl font-bold text-[#2E4040] md:text-4xl">
            Nuestros <span className="text-[#3F8346]">productos</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-[#949E97]">
            Importamos y distribuimos una amplia gama de soluciones de embalaje para proteger tu mercancia
          </p>
        </div>

        {/* Category filter */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setActiveCategory("all")}
            className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
              activeCategory === "all"
                ? "bg-[#3F8346] text-[#FDFDFD]"
                : "bg-[#FDFDFD] text-[#2E4040] hover:bg-[#3F8346]/10"
            }`}
          >
            Todos ({products.length})
          </button>
          {CATEGORIES.map((cat) => {
            const count = getCategoryCount(cat.slug)
            return (
              <button
                key={cat.slug}
                onClick={() => setActiveCategory(cat.slug)}
                className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                  activeCategory === cat.slug
                    ? "bg-[#3F8346] text-[#FDFDFD]"
                    : "bg-[#FDFDFD] text-[#2E4040] hover:bg-[#3F8346]/10"
                }`}
              >
                {cat.name} ({count})
              </button>
            )
          })}
        </div>

        {/* Product grid */}
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
              <svg className="h-10 w-10 text-[#949E97]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-[#2E4040]">
              {products.length === 0
                ? "Proximamente agregaremos productos"
                : "No hay productos en esta categoria"}
            </p>
            <p className="mt-1 text-sm text-[#949E97]">
              {products.length === 0
                ? "Estamos preparando nuestro catalogo. Contactanos para mas informacion."
                : "Intenta con otra categoria o contactanos."}
            </p>
          </div>
        ) : (
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="group overflow-hidden rounded-lg border border-[#C8CDC9] bg-[#FDFDFD] transition-all hover:border-[#3F8346] hover:shadow-lg"
              >
                <div className="relative aspect-square overflow-hidden bg-[#C8CDC9]/20">
                  {product.imageUrl ? (
                    <Image
                      src={product.imageUrl}
                      alt={product.name}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <Image
                      src="/images/default-product.jpg"
                      alt={product.name}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  )}
                  <div className="absolute left-3 top-3">
                    <span className="rounded-full bg-[#3F8346] px-3 py-1 text-xs font-semibold text-[#FDFDFD]">
                      {CATEGORIES.find((c) => c.slug === product.category)?.name || product.category}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-heading text-lg font-bold text-[#2E4040]">{product.name}</h3>
                  {product.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-[#949E97]">{product.description}</p>
                  )}
                  <a
                    href={`https://wa.me/573001234567?text=Hola, me interesa el producto: ${encodeURIComponent(product.name)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#3F8346] transition-colors hover:text-[#2d6332]"
                  >
                    Solicitar cotizacion
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
