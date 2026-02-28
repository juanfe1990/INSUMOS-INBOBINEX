import Image from 'next/image';

export function HeroSection() {
    return (
        <section className="relative flex min-h-[520px] items-center overflow-hidden">
            {/* Background */}
            <Image
                src="/fondoInbobinex.avif"
                alt="Fondo del Hero, Inbobinex embalaje especializado"
                height={1566}
                width={520}
                priority
                unoptimized
                className="object-contain absolute max-w-lg lg:max-w-2xl w-full right-0 rotate-12 scale-150"
            />
            <div className="absolute inset-0 bg-[#2E4040]/80" />

            <div className="flex-1 relative z-10 grid place-items-center lg:place-items-start mx-auto max-w-7xl px-4 py-20 text-center lg:text-left">
                <h1 className="font-heading text-4xl font-bold leading-tight text-[#FDFDFD] md:text-5xl lg:text-6xl">
                    <span className="text-[#3F8346]">Embalaje</span> especializado{' '}
                    <br className="hidden md:block" />
                    para tu industria
                </h1>
                <p className="mx-auto lg:mx-0 mt-6 max-w-2xl text-lg text-[#C8CDC9]">
                    En Insumos INBOBINEX estamos comprometidos con ofrecer soluciones de embalaje
                    innovadoras y de alta calidad. Papel burbuja, cintas, stretch y mucho mas para
                    proteger tus productos.
                </p>
                <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                    <a
                        href="#productos"
                        className="rounded-md bg-[#3F8346] px-8 py-3.5 font-heading text-sm font-semibold uppercase tracking-wide text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                    >
                        Ver productos
                    </a>
                    <a
                        href="https://wa.me/573001234567"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border-2 border-[#FDFDFD] bg-transparent px-8 py-3.5 font-heading text-sm font-semibold uppercase tracking-wide text-[#FDFDFD] transition-colors hover:bg-[#FDFDFD] hover:text-[#2E4040]"
                    >
                        Contactanos
                    </a>
                </div>
            </div>
        </section>
    );
}
