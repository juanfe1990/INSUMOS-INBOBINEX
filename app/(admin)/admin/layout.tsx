'use client';

import AdminLogin from '@/components/admin-login';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { Toaster } from 'sonner';

function AdminShell({ children }: { children: React.ReactNode }) {
    const { user, role, loading } = useAuth();

    if (loading || (user && !role)) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#2E4040]">
                <Loader2 className="h-10 w-10 animate-spin text-[#3F8346]" />
            </div>
        );
    }

    // Los operarios o usuarios sin autenticar NUNCA pasan al dashboard; se quedan en login
    if (!user || role === 'operario') {
        return <AdminLogin />;
    }

    return (
        <>
            <Toaster position="bottom-right" richColors />
            {/* La navegación, el usuario y la salida viven en el panel lateral (components/admin/admin-sidebar.tsx) */}
            {children}
        </>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <AdminShell>{children}</AdminShell>
        </AuthProvider>
    );
}
