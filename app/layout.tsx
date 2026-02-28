import './globals.css';

import { Inter, Montserrat } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="es"
            className={`${inter.variable} ${montserrat.variable} font-sans antialiased`}
        >
            <body>{children}</body>
        </html>
    );
}
