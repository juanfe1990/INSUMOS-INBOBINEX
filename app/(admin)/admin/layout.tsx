'use client';

import AdminLogin from '@/components/admin-login';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ArrowLeft, LayoutDashboard, Loader2, LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Toaster } from 'sonner';

function AdminShell({ children }: { children: React.ReactNode }) {
    const { user, loading, signOut } = useAuth();

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#2E4040]">
                <Loader2 className="h-10 w-10 animate-spin text-[#3F8346]" />
            </div>
        );
    }

    if (!user) {
        return <AdminLogin />;
    }

    return (
        <div className="flex min-h-screen flex-col bg-[#FDFDFD]">
            <Toaster position="bottom-right" richColors />
            {/* Admin header */}
            <header className="sticky top-0 z-40 border-b border-[#C8CDC9] bg-[#2E4040]">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-4">
                        <Link href="/">
                            <Image
                                src="/logo.avif"
                                alt="INBOBINEX"
                                width={140}
                                height={40}
                                className="h-9 w-auto rounded bg-[#FDFDFD] p-0.5"
                                unoptimized
                            />
                        </Link>
                        <div className="hidden items-center gap-2 rounded-md bg-[#3F8346]/20 px-3 py-1 sm:flex">
                            <LayoutDashboard className="h-4 w-4 text-[#3F8346]" />
                            <span className="text-sm font-semibold text-[#3F8346]">
                                Panel Admin
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="hidden text-xs text-[#949E97] sm:block">{user.email}</span>
                        <button
                            onClick={signOut}
                            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-[#C8CDC9] transition-colors hover:bg-[#FDFDFD]/10 hover:text-[#FDFDFD]"
                            aria-label="Cerrar sesion"
                        >
                            <LogOut className="h-4 w-4" />
                            <span className="hidden sm:inline">Salir</span>
                        </button>
                        <Link
                            href="/"
                            className="flex items-center gap-1.5 text-sm text-[#C8CDC9] transition-colors hover:text-[#FDFDFD]"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span className="hidden sm:inline">Volver al sitio</span>
                        </Link>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="flex-1">
                <div className="mx-auto max-w-7xl px-4 py-8">{children}</div>
            </main>
        </div>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <AdminShell>{children}</AdminShell>
        </AuthProvider>
    );
}
