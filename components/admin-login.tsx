'use client';

import { useAuth } from '@/lib/auth-context';
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

export default function AdminLogin() {
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await signIn(email, password);
        } catch {
            setError('Correo o contraseña incorrectos');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#2E4040] px-4">
            <div className="w-full max-w-md">
                {/* Logo card */}
                <div className="mb-8 flex flex-col items-center">
                    <div className="rounded-xl bg-[#FDFDFD] p-3 shadow-lg">
                        <Image
                            src="/logo.avif"
                            alt="INBOBINEX"
                            width={180}
                            height={50}
                            className="h-12 w-auto"
                            loading="eager"
                            unoptimized
                        />
                    </div>
                    <p className="mt-4 text-sm text-[#C8CDC9]">Panel de Administracion</p>
                </div>

                {/* Login form */}
                <div className="rounded-xl border border-[#C8CDC9]/20 bg-[#FDFDFD] p-8 shadow-2xl">
                    <div className="mb-6 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#3F8346]/10">
                            <Lock className="h-6 w-6 text-[#3F8346]" />
                        </div>
                        <h1 className="font-heading text-xl font-bold text-[#2E4040]">
                            Iniciar Sesion
                        </h1>
                        <p className="mt-1 text-sm text-[#949E97]">
                            Ingresa tus credenciales para acceder
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Email */}
                        <div>
                            <label
                                htmlFor="email"
                                className="mb-1.5 block text-sm font-semibold text-[#2E4040]"
                            >
                                Correo electronico
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949E97]" />
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="admin@inbobinex.com"
                                    required
                                    className="w-full rounded-md border border-[#C8CDC9] bg-[#FDFDFD] py-2.5 pl-10 pr-3 text-sm text-[#2E4040] placeholder:text-[#949E97] focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <label
                                htmlFor="password"
                                className="mb-1.5 block text-sm font-semibold text-[#2E4040]"
                            >
                                Contraseña
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#949E97]" />
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Tu contraseña"
                                    required
                                    className="w-full rounded-md border border-[#C8CDC9] bg-[#FDFDFD] py-2.5 pl-10 pr-10 text-sm text-[#2E4040] placeholder:text-[#949E97] focus:border-[#3F8346] focus:outline-none focus:ring-1 focus:ring-[#3F8346]"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#949E97] transition-colors hover:text-[#2E4040]"
                                    aria-label={
                                        showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                                    }
                                >
                                    {showPassword ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Error message */}
                        {error && (
                            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                                {error}
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#3F8346] py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2d6332] disabled:opacity-50"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Ingresando...
                                </>
                            ) : (
                                'Ingresar'
                            )}
                        </button>
                    </form>
                </div>

                <p className="mt-6 text-center text-xs text-[#949E97]">
                    Acceso exclusivo para administradores
                </p>
            </div>
        </div>
    );
}
