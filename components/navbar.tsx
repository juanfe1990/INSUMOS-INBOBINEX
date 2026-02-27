"use client"

import { Mail, Menu, Phone, X } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useState } from "react"

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full">
      {/* Top bar */}
      <div className="bg-[#2E4040] text-[#FDFDFD]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-sm">
          <div className="flex items-center gap-6">
            <a href="tel:+573001234567" className="flex items-center gap-1.5 transition-colors hover:text-[#3F8346]">
              <Phone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">+57 300 123 4567</span>
            </a>
            <a href="mailto:ventas@inbobinex.com" className="flex items-center gap-1.5 transition-colors hover:text-[#3F8346]">
              <Mail className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">ventas@inbobinex.com</span>
            </a>
          </div>
          <span className="text-xs text-[#C8CDC9]">Industria protegida, futuro sostenible</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="border-b border-[#C8CDC9] bg-[#FDFDFD]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image
              src="/logoInbobinex.jpeg"
              alt="Insumos INBOBINEX - Industria protegida, futuro sostenible"
              width={200}
              height={60}
              className="h-12 w-auto"
              priority
            />
          </Link>

          {/* Desktop nav */}
          <ul className="hidden items-center gap-8 font-heading text-sm font-semibold uppercase tracking-wide text-[#2E4040] md:flex">
            <li>
              <Link href="/" className="transition-colors hover:text-[#3F8346]">Inicio</Link>
            </li>
            <li>
              <a href="#productos" className="transition-colors hover:text-[#3F8346]">Productos</a>
            </li>
            <li>
              <a href="#nosotros" className="transition-colors hover:text-[#3F8346]">Nosotros</a>
            </li>
            <li>
              <a href="#contacto" className="transition-colors hover:text-[#3F8346]">Contacto</a>
            </li>
          </ul>

          {/* WhatsApp CTA */}
          <a
            href="https://wa.me/573001234567"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-2 rounded-md bg-[#3F8346] px-5 py-2.5 text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2E4040] md:flex"
          >
            Cotizar ahora
          </a>

          {/* Mobile toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="text-[#2E4040] md:hidden"
            aria-label={mobileOpen ? "Cerrar menu" : "Abrir menu"}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="border-t border-[#C8CDC9] bg-[#FDFDFD] px-4 pb-4 md:hidden">
            <ul className="flex flex-col gap-4 pt-4 font-heading text-sm font-semibold uppercase tracking-wide text-[#2E4040]">
              <li>
                <Link href="/" onClick={() => setMobileOpen(false)} className="block py-1 transition-colors hover:text-[#3F8346]">Inicio</Link>
              </li>
              <li>
                <a href="#productos" onClick={() => setMobileOpen(false)} className="block py-1 transition-colors hover:text-[#3F8346]">Productos</a>
              </li>
              <li>
                <a href="#nosotros" onClick={() => setMobileOpen(false)} className="block py-1 transition-colors hover:text-[#3F8346]">Nosotros</a>
              </li>
              <li>
                <a href="#contacto" onClick={() => setMobileOpen(false)} className="block py-1 transition-colors hover:text-[#3F8346]">Contacto</a>
              </li>
            </ul>
            <a
              href="https://wa.me/573001234567"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 block rounded-md bg-[#3F8346] px-5 py-2.5 text-center text-sm font-semibold text-[#FDFDFD] transition-colors hover:bg-[#2E4040]"
            >
              Cotizar ahora
            </a>
          </div>
        )}
      </nav>
    </header>
  )
}
