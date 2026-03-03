import type { Metadata } from 'next';

import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';

export const metadata: Metadata = {
    title: {
        // Esto es magia pura: si una página hija define un título, le agrega " | INBOBINEX" automáticamente
        template: '%s | INBOBINEX',
        default: 'INBOBINEX - Embalaje especializado para tu industria',
    },
    description: 'Soluciones de embalaje innovadoras y de alta calidad...',
    openGraph: {
        siteName: 'INBOBINEX',
        locale: 'es_CO',
        type: 'website',
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <main>
            <Navbar />
            {children}
            <Footer />
        </main>
    );
}
