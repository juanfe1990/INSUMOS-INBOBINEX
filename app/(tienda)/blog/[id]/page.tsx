import { getAllPostIds, getPostData } from '@/lib/post';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
    const paths = getAllPostIds();
    return paths;
}

interface BlogPostProps {
    params: Promise<{
        id: string;
    }>;
}

import { Metadata } from 'next'; // 1. Importa el tipo Metadata de Next

// ... (Aquí tienes tu import de getPostData y la función generateStaticParams) ...

// 2. Agrega esta función para generar el SEO dinámico
export async function generateMetadata({ params }: BlogPostProps): Promise<Metadata> {
    const { id } = await params;

    try {
        const postData = await getPostData(id);

        return {
            title: `${postData.title} | INBOBINEX`,
            description: postData.description,
            // OpenGraph es lo que lee WhatsApp, LinkedIn y Facebook para armar la tarjetita al compartir el link
            openGraph: {
                title: postData.title,
                description: postData.description,
                url: `https://tu-dominio.com/blog/${id}`,
                siteName: 'INBOBINEX',
                images: postData.image
                    ? [
                          {
                              url: postData.image,
                              width: 1200,
                              height: 630,
                              alt: postData.title,
                          },
                      ]
                    : [],
                type: 'article',
                publishedTime: postData.date,
            },
            // Twitter Cards
            twitter: {
                card: 'summary_large_image',
                title: postData.title,
                description: postData.description,
                images: postData.image ? [postData.image] : [],
            },
        };
    } catch (error) {
        return {
            title: 'Artículo no encontrado | INBOBINEX',
        };
    }
}

// ... (Aquí empieza tu export default async function BlogPost) ...

export default async function BlogPost({ params }: BlogPostProps) {
    const { id } = await params;

    try {
        const postData = await getPostData(id);

        return (
            <main className="min-h-screen bg-gray-50 pb-16">
                {/* Cabecera estilo Industrial (Fondo oscuro como el de Inbobinex) */}
                <div className="bg-[#2E4040] text-white py-16 md:py-24 px-4 relative overflow-hidden">
                    <div className="max-w-4xl mx-auto relative z-10 text-center">
                        <time className="text-sm font-bold text-[#7dc08c] uppercase tracking-wider">
                            {postData.date}
                        </time>
                        <h1 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight">
                            {postData.title}
                        </h1>
                    </div>
                </div>

                {/* Contenedor del artículo */}
                <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-20">
                    <div className="bg-white rounded-lg shadow-lg overflow-hidden border border-gray-100">
                        {/* Imagen principal del post */}
                        {postData.image && (
                            <div className="w-full h-64 md:h-96 bg-gray-200">
                                <img
                                    src={postData.image}
                                    alt={postData.title}
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        )}

                        <div className="p-8 md:p-12">
                            <Link
                                href="/"
                                className="inline-flex items-center text-sm font-medium text-[#4b5a59] hover:text-[#438b53] mb-8 transition-colors"
                            >
                                <svg
                                    className="w-4 h-4 mr-2"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M10 19l-7-7m0 0l7-7m-7 7h18"
                                    />
                                </svg>
                                Volver a la tienda
                            </Link>

                            {/* Contenido del Markdown 
                Usamos modificadores de Tailwind Typography (prose) para inyectar los colores de la marca en el HTML generado
              */}
                            <div
                                className="prose prose-lg max-w-none prose-headings:text-[#334155] prose-a:text-[#438b53] hover:prose-a:text-[#367243] prose-img:rounded-md"
                                dangerouslySetInnerHTML={{ __html: postData.contentHtml || '' }}
                            />
                        </div>
                    </div>
                </article>
            </main>
        );
    } catch (error) {
        notFound();
    }
}
