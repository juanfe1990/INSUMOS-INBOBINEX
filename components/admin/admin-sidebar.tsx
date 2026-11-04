'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
    ArrowLeft,
    ClipboardList,
    Layers,
    LogOut,
    Menu,
    Package,
    PanelLeftClose,
    PanelLeftOpen,
    Receipt,
    Landmark,
    Gauge,
    Tags,
    Truck,
    Users,
    Wallet,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export type AdminTab =
    | 'orders'
    | 'receivables'
    | 'expenses'
    | 'treasury'
    | 'finance'
    | 'clients'
    | 'inventory'
    | 'suppliers'
    | 'catalog';

const NAV: { key: AdminTab; label: string; icon: LucideIcon; adminOnly?: boolean }[] = [
    { key: 'orders', label: 'Pedidos & Planta', icon: ClipboardList },
    { key: 'receivables', label: 'Cuentas por Cobrar', icon: Wallet },
    { key: 'expenses', label: 'Gastos Fijos', icon: Receipt, adminOnly: true },
    { key: 'treasury', label: 'Caja y Bancos', icon: Landmark, adminOnly: true },
    { key: 'finance', label: 'Indicadores y P&G', icon: Gauge, adminOnly: true },
    { key: 'clients', label: 'Clientes', icon: Users },
    { key: 'inventory', label: 'Inventarios & Kardex', icon: Layers },
    { key: 'suppliers', label: 'Proveedores & CxP', icon: Truck },
    { key: 'catalog', label: 'Catálogo Web', icon: Package },
];

const STORAGE_KEY = 'inbobinex.sidebar.collapsed';

type Props = {
    activeTab: AdminTab;
    onTabChange: (tab: AdminTab) => void;
    categoriesCount: number;
    onManageCategories: () => void;
    children: React.ReactNode;
};

/**
 * Panel lateral del administrador: navegación entre módulos, usuario y salida.
 * En escritorio se pliega a solo iconos (se recuerda la preferencia);
 * en pantallas pequeñas se abre como cajón sobre el contenido.
 */
export default function AdminSidebar({ activeTab, onTabChange, categoriesCount, onManageCategories, children }: Props) {
    const { user, role, signOut } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        setCollapsed(localStorage.getItem(STORAGE_KEY) === '1');
    }, []);

    const toggleCollapsed = () => {
        setCollapsed((c) => {
            localStorage.setItem(STORAGE_KEY, c ? '0' : '1');
            return !c;
        });
    };

    // En móvil el cajón siempre se muestra expandido
    const compact = collapsed && !mobileOpen;
    const activeLabel = NAV.find((n) => n.key === activeTab)?.label || '';

    const select = (tab: AdminTab) => {
        onTabChange(tab);
        setMobileOpen(false);
    };

    const itemCls = (active: boolean) =>
        `group flex w-full items-center gap-3 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
            compact ? 'justify-center px-0' : 'px-3'
        } ${active ? 'bg-[#3F8346] text-white shadow-sm' : 'text-[#C8CDC9] hover:bg-white/10 hover:text-white'}`;

    return (
        <div className="min-h-screen bg-[#FDFDFD]">
            {/* Barra mínima en móvil */}
            <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-[#C8CDC9] bg-[#2E4040] px-4 py-2.5 lg:hidden print:hidden">
                <button
                    onClick={() => setMobileOpen(true)}
                    className="rounded-md p-1.5 text-[#C8CDC9] hover:bg-white/10 hover:text-white"
                    aria-label="Abrir menú"
                >
                    <Menu className="h-5 w-5" />
                </button>
                <span className="text-sm font-semibold text-white">{activeLabel}</span>
            </div>

            {/* Fondo del cajón móvil */}
            {mobileOpen && (
                <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
            )}

            <aside
                className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r border-black/10 bg-[#2E4040] transition-all duration-200 print:hidden ${
                    compact ? 'w-16' : 'w-64'
                } ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
            >
                {/* Marca */}
                <div className={`flex items-center border-b border-white/10 py-4 ${compact ? 'justify-center px-2' : 'justify-between px-4'}`}>
                    {compact ? (
                        <button
                            onClick={toggleCollapsed}
                            className="rounded-md p-1.5 text-[#C8CDC9] hover:bg-white/10 hover:text-white"
                            title="Desplegar menú"
                            aria-label="Desplegar menú"
                        >
                            <PanelLeftOpen className="h-5 w-5" />
                        </button>
                    ) : (
                        <>
                            <Link href="/" className="shrink-0">
                                <Image
                                    src="/logo.avif"
                                    alt="INBOBINEX"
                                    width={140}
                                    height={40}
                                    className="h-9 w-auto rounded bg-[#FDFDFD] p-0.5"
                                    unoptimized
                                />
                            </Link>
                            <button
                                onClick={() => (mobileOpen ? setMobileOpen(false) : toggleCollapsed())}
                                className="rounded-md p-1.5 text-[#C8CDC9] hover:bg-white/10 hover:text-white"
                                title={mobileOpen ? 'Cerrar menú' : 'Plegar menú'}
                                aria-label={mobileOpen ? 'Cerrar menú' : 'Plegar menú'}
                            >
                                {mobileOpen ? <X className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
                            </button>
                        </>
                    )}
                </div>

                {/* Módulos */}
                <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
                    {!compact && (
                        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-[#949E97]">Panel admin</div>
                    )}
                    {NAV.filter((n) => !n.adminOnly || role === 'admin').map((n) => (
                        <button
                            key={n.key}
                            onClick={() => select(n.key)}
                            className={itemCls(activeTab === n.key)}
                            title={compact ? n.label : undefined}
                            aria-current={activeTab === n.key ? 'page' : undefined}
                        >
                            <n.icon className={`h-5 w-5 shrink-0 ${activeTab === n.key ? 'text-white' : 'text-[#3F8346]'}`} />
                            {!compact && <span className="truncate">{n.label}</span>}
                        </button>
                    ))}

                    <div className="my-3 border-t border-white/10" />
                    <button
                        onClick={() => {
                            onManageCategories();
                            setMobileOpen(false);
                        }}
                        className={itemCls(false)}
                        title={compact ? `Categorías del catálogo (${categoriesCount})` : undefined}
                    >
                        <Tags className="h-5 w-5 shrink-0 text-[#3F8346]" />
                        {!compact && (
                            <span className="truncate">
                                Categorías catálogo <span className="text-[#949E97]">({categoriesCount})</span>
                            </span>
                        )}
                    </button>
                </nav>

                {/* Usuario */}
                <div className="space-y-1 border-t border-white/10 px-2 py-3">
                    {!compact && user && (
                        <div className="px-3 pb-2">
                            <div className="truncate text-xs text-[#FDFDFD]" title={user.email || ''}>
                                {user.email}
                            </div>
                            {role && (
                                <span className="mt-1 inline-block rounded bg-[#3F8346]/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-300">
                                    Rol: {role}
                                </span>
                            )}
                        </div>
                    )}
                    <Link href="/" className={itemCls(false)} title={compact ? 'Volver al sitio' : undefined}>
                        <ArrowLeft className="h-5 w-5 shrink-0" />
                        {!compact && <span>Volver al sitio</span>}
                    </Link>
                    <button onClick={signOut} className={itemCls(false)} title={compact ? 'Cerrar sesión' : undefined}>
                        <LogOut className="h-5 w-5 shrink-0" />
                        {!compact && <span>Cerrar sesión</span>}
                    </button>
                </div>
            </aside>

            {/* Contenido */}
            <main className={`transition-all duration-200 print:pl-0 ${collapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
                <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">{children}</div>
            </main>
        </div>
    );
}
