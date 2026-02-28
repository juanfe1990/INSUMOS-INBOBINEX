import type { Metadata } from 'next';

import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';

export const metadata: Metadata = {
    title: 'Insumos INBOBINEX | Embalaje Especializado',
    description:
        'Venta de embalaje especializado: papel burbuja, cinta transparente y mas. Industria protegida, futuro sostenible.',
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
