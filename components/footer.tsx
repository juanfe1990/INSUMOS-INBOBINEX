import Image from "next/image"
import Link from "next/link"

export function Footer() {
  return (
    <footer className="border-t border-[#C8CDC9] bg-[#2E4040]">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Brand */}
          <div>
            <Link href="/">
              <Image
                src="/logoInbobinex.jpeg"
                alt="Insumos INBOBINEX"
                width={160}
                height={48}
                className="h-10 w-auto rounded bg-[#FDFDFD] p-1"
              />
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-[#C8CDC9]">
              Industria protegida, futuro sostenible. Soluciones de embalaje de alta calidad
              para proteger tu mercancia.
            </p>
          </div>

          {/* Links */}
          <div>
            <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-[#FDFDFD]">
              Navegacion
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li>
                <Link href="/" className="text-sm text-[#C8CDC9] transition-colors hover:text-[#3F8346]">
                  Inicio
                </Link>
              </li>
              <li>
                <a href="#productos" className="text-sm text-[#C8CDC9] transition-colors hover:text-[#3F8346]">
                  Productos
                </a>
              </li>
              <li>
                <a href="#nosotros" className="text-sm text-[#C8CDC9] transition-colors hover:text-[#3F8346]">
                  Nosotros
                </a>
              </li>
              <li>
                <a href="#contacto" className="text-sm text-[#C8CDC9] transition-colors hover:text-[#3F8346]">
                  Contacto
                </a>
              </li>
            </ul>
          </div>

          {/* Categories */}
          <div>
            <h3 className="font-heading text-sm font-bold uppercase tracking-wide text-[#FDFDFD]">
              Categorias
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li><span className="text-sm text-[#C8CDC9]">Papel Burbuja</span></li>
              <li><span className="text-sm text-[#C8CDC9]">Cintas Adhesivas</span></li>
              <li><span className="text-sm text-[#C8CDC9]">Stretch / Vinipel</span></li>
              <li><span className="text-sm text-[#C8CDC9]">Cajas y Carton</span></li>
              <li><span className="text-sm text-[#C8CDC9]">Bolsas</span></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-[#949E97]/30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <p className="text-xs text-[#949E97]">
            Insumos INBOBINEX &copy; {new Date().getFullYear()}. Todos los derechos reservados.
          </p>
        </div>
      </div>
    </footer>
  )
}
