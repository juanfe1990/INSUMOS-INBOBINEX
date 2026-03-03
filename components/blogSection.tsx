import { PostData } from '@/lib/types';
import Link from 'next/link';

interface BlogSectionProps {
    posts: PostData[];
}

export default function BlogSection({ posts }: BlogSectionProps) {
    // Si no hay posts, no renderizamos la sección
    if (!posts || posts.length === 0) return null;

    return (
        <section className="py-16 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Encabezado con el estilo INBOBINEX */}
                <div className="text-center mb-12">
                    <h2 className="text-3xl font-extrabold text-[#334155] sm:text-4xl">
                        Nuestro <span className="text-[#438b53]">blog</span>
                    </h2>
                    <p className="mt-4 text-lg text-gray-500">
                        Novedades, consejos y soluciones sobre embalaje especializado para tu
                        industria.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {posts.map((post) => (
                        <article
                            key={post.id}
                            className="flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-xl transition-shadow duration-300"
                        >
                            {/* Contenedor de la imagen */}
                            <div className="relative h-56 w-full bg-gray-100 border-b border-gray-200">
                                <img
                                    src={post.image || '/api/placeholder/600/400'}
                                    alt={post.title}
                                    className="w-full h-full object-cover"
                                />
                            </div>

                            {/* Contenido de la tarjeta */}
                            <div className="p-6 flex-1 flex flex-col">
                                <time className="text-xs font-bold text-[#438b53] uppercase tracking-wider mb-2">
                                    {post.date}
                                </time>
                                <h3 className="text-xl font-bold text-[#334155] mb-3 leading-tight">
                                    {post.title}
                                </h3>
                                <p className="text-gray-600 text-sm line-clamp-3 mb-6 flex-1">
                                    {post.description}
                                </p>

                                {/* Botón estilo e-commerce */}
                                <Link
                                    href={`/blog/${post.id}`}
                                    className="mt-auto w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-[#438b53] hover:bg-[#367243] transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#438b53]"
                                >
                                    Leer artículo
                                </Link>
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
}
