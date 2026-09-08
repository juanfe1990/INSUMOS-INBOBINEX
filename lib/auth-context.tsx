'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { Database, UserRole } from '@/lib/types/database.types';

export type Profile = Database['public']['Tables']['profiles']['Row'];

type AuthState = {
    user: User | null;
    profile: Profile | null;
    role: UserRole | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    const fetchProfile = async (userId: string): Promise<Profile | null> => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (!error && data) {
                return data as Profile;
            }
        } catch (err) {
            console.error('Error cargando perfil:', err);
        }
        return null;
    };

    const handleSession = async (sessionUser: User | null) => {
        if (!sessionUser) {
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
        }

        const prof = await fetchProfile(sessionUser.id);
        if (prof && prof.role === 'operario') {
            // Operario detectado: revocar sesión y no permitir acceso al panel web
            await supabase.auth.signOut();
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
        }

        if (prof) {
            setUser(sessionUser);
            setProfile(prof);
        } else {
            setUser(null);
            setProfile(null);
        }
        setLoading(false);
    };

    useEffect(() => {
        let mounted = true;

        const checkInitialSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (mounted) {
                    await handleSession(session?.user || null);
                }
            } catch (err) {
                console.error('Error verificando sesión:', err);
                if (mounted) setLoading(false);
            }
        };

        checkInitialSession();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (mounted) {
                await handleSession(session?.user || null);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [supabase]);

    const signIn = async (email: string, password: string) => {
        setLoading(true);
        try {
            const { error, data } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            if (data.user) {
                const profileData = await fetchProfile(data.user.id);

                if (profileData && profileData.role === 'operario') {
                    // Expulsar inmediatamente
                    await supabase.auth.signOut();
                    setUser(null);
                    setProfile(null);
                    throw new Error(
                        'Acceso no autorizado: Las cuentas de Operario solo pueden ingresar desde la aplicación móvil de planta.'
                    );
                }

                setUser(data.user);
                setProfile(profileData);
            }
        } finally {
            setLoading(false);
        }
    };

    const signOut = async () => {
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                profile,
                role: profile?.role || null,
                loading,
                signIn,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
