import ProductGallery from '@/components/productGallery';
import { db } from '@/lib/firebase-admin';
import type { Product } from '@/lib/types';
import { ArrowLeft, MessageCircle, PackageCheck, ShieldCheck, Truck } from 'lucide-react';
import { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

// Esto le dice a Next.js que regenere la página en el servidor cada 5 minutos
// si hay cambios en la base de datos (ISR)
export const revalidate = 300; // 5 minutos

type Props = {
    params: Promise<{ slug: string }>; // Cambiamos 'id' por 'slug'
};

// 1. Función para obtener el producto por su SLUG
async function getProductBySlug(slug: string): Promise<Product | null> {
    if (!db) return null;

    const snapshot = await db.collection('products').where('slug', '==', slug).limit(1).get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() } as Product;
}

// 2. Función auxiliar para obtener productos relacionados
async function getRelatedProducts(
    categoryId: string,
    currentProductId: string,
): Promise<Product[]> {
    if (!db || !categoryId) return [];
    const snapshot = await db
        .collection('products')
        .where('categoryId', '==', categoryId)
        .limit(5)
        .get();

    const products = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Product);
    return products.filter((p) => p.id !== currentProductId).slice(0, 4);
}

// 3. GENERACIÓN DE METADATOS PARA SEO
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const product = await getProductBySlug(slug);

    if (!product) {
        return { title: 'Producto no encontrado | Tienda de Embalajes' };
    }

    return {
        title: `${product.name} | Tienda de Embalajes`,
        description:
            product.description ||
            `Compra ${product.name}. Soluciones de embalaje de alta resistencia y venta al por mayor.`,
        openGraph: {
            title: product.name,
            description: product.description || `Adquiere ${product.name} con envíos nacionales.`,
            images: [product.imageUrl || '/images/default-product.jpg'],
            type: 'website',
        },
    };
}

// 4. COMPONENTE PRINCIPAL DE SERVIDOR
export default async function ProductDetailPage({ params }: Props) {
    const { slug } = await params;
    const product = await getProductBySlug(slug);

    if (!product) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                <h1 className="text-2xl font-bold text-[#2E4040]">Producto no encontrado</h1>
                <Link href="/#productos" className="mt-4 text-[#3F8346] hover:underline">
                    Volver al catálogo
                </Link>
            </div>
        );
    }

    // Obtenemos los productos relacionados en el servidor
    const relatedProducts = await getRelatedProducts(product.categoryId, product.id);

    // Preparamos el array de imágenes sin duplicados
    const allImages = Array.from(new Set([product.imageUrl, ...(product.gallery || [])])).filter(
        Boolean,
    );

    const whatsappMessage = `Hola, me interesa solicitar una cotización para el producto: *${product.name}*. ¿Me podrían brindar más información?`;
    const whatsappUrl = `https://wa.me/573001234567?text=${encodeURIComponent(whatsappMessage)}`;

    return (
        <main className="min-h-screen bg-[#FDFDFD] pb-24 pt-12 md:pt-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <nav className="mb-8">
                    <Link
                        href="/#productos"
                        className="inline-flex items-center gap-2 text-sm font-medium text-[#949E97] transition-colors hover:text-[#3F8346]"
                    >
                        <ArrowLeft className="h-4 w-4" /> Volver al catálogo
                    </Link>
                </nav>

                <div className="grid grid-cols-1 gap-y-10 lg:grid-cols-2 lg:gap-x-16">
                    {/* COLUMNA IZQUIERDA: Galería Cliente */}
                    <ProductGallery images={allImages} productName={product.name} />

                    {/* COLUMNA DERECHA: Información Servidor */}
                    <div className="flex flex-col lg:py-4">
                        <div className="mb-4">
                            <span className="inline-flex items-center rounded-full bg-[#3F8346]/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#3F8346]">
                                {product.categoryName || 'Embalaje'}
                            </span>
                        </div>

                        <h1 className="font-heading text-3xl font-bold tracking-tight text-[#2E4040] sm:text-4xl">
                            {product.name}
                        </h1>

                        <div className="mt-6 flex flex-wrap gap-4 border-y border-[#C8CDC9]/40 py-5">
                            <div className="flex items-center gap-2 text-sm font-medium text-[#2E4040]">
                                <ShieldCheck className="h-5 w-5 text-[#3F8346]" />
                                <span>Alta resistencia</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm font-medium text-[#2E4040]">
                                <PackageCheck className="h-5 w-5 text-[#3F8346]" />
                                <span>Venta al por mayor</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm font-medium text-[#2E4040]">
                                <Truck className="h-5 w-5 text-[#3F8346]" />
                                <span>Envíos nacionales</span>
                            </div>
                        </div>

                        <div className="mt-8">
                            <h3 className="font-heading text-lg font-semibold text-[#2E4040]">
                                Descripción detallada
                            </h3>
                            <div className="mt-4 prose prose-sm sm:prose-base text-[#949E97]">
                                <p className="whitespace-pre-wrap leading-relaxed">
                                    {product.description ||
                                        'Este producto ofrece una excelente solución para la protección y el manejo de tu mercancía. Contáctanos para conocer especificaciones técnicas detalladas y disponibilidad de inventario.'}
                                </p>
                            </div>
                        </div>

                        <div className="mt-10 lg:mt-auto lg:pt-10">
                            <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-8 py-4 text-base font-bold text-white transition-all duration-300 hover:bg-[#1DA851] hover:shadow-lg hover:shadow-[#25D366]/30 sm:w-auto"
                            >
                                <MessageCircle className="h-6 w-6 transition-transform group-hover:scale-110" />
                                Solicitar Cotización por WhatsApp
                            </a>
                            <p className="mt-3 text-center text-xs font-medium text-[#949E97] sm:text-left">
                                Atención inmediata. Te asesoramos con la cantidad que necesites.
                            </p>
                        </div>
                    </div>
                </div>

                {/* SECCIÓN: Productos Relacionados */}
                {relatedProducts.length > 0 && (
                    <div className="mt-24 border-t border-[#C8CDC9]/40 pt-16">
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="font-heading text-2xl font-bold text-[#2E4040]">
                                También podría interesarte
                            </h2>
                        </div>

                        <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
                            {relatedProducts.map((related) => (
                                <Link
                                    href={`/productos/${related.slug || related.id}`} // Usamos slug, o fallback al id si son productos antiguos
                                    key={related.id}
                                    className="group flex flex-col overflow-hidden rounded-xl border border-[#C8CDC9]/40 bg-white transition-all hover:border-[#3F8346] hover:shadow-xl hover:shadow-[#3F8346]/5"
                                >
                                    <div className="relative aspect-square overflow-hidden bg-[#F8F9FA] p-4">
                                        <Image
                                            src={related.imageUrl || '/images/default-product.jpg'}
                                            alt={related.name}
                                            fill
                                            className="object-contain transition-transform duration-500 group-hover:scale-110"
                                            unoptimized
                                        />
                                    </div>
                                    <div className="flex flex-col flex-grow p-4 sm:p-5">
                                        <h3 className="font-semibold text-[#2E4040] line-clamp-2 text-sm sm:text-base">
                                            {related.name}
                                        </h3>
                                        <div className="mt-auto pt-4">
                                            <span className="inline-flex items-center text-sm font-bold text-[#3F8346] group-hover:underline">
                                                Ver detalle &rarr;
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
