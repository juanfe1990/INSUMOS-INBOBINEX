'use client';

import { ArrowRight, CheckCircle2, Layers, Ruler, Scale, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { useId, useState } from 'react';

interface StretchOption {
    id: string;
    widthCm: number;
    title: string;
    tagline: string;
    defaultWeight: number;
    suggestedWeights: number[];
    description: string;
    applications: string[];
    specs: {
        gauge: string;
        handling: string;
        elasticity: string;
    };
    image: string;
}

const STRETCH_OPTIONS: StretchOption[] = [
    {
        id: '12.5cm',
        widthCm: 12.5,
        title: 'Rollos Stretch 12.5 cm',
        tagline: 'Mini Roll / Bandeo de Piezas Pequeñas',
        defaultWeight: 0.5,
        suggestedWeights: [0.3, 0.5, 0.8, 1.0, 1.5],
        description:
            'Diseñado para el embalaje rápido y maniobrable de piezas pequeñas, cables, tubos delgados y perfiles. Ideal para uso manual continuo con una sola mano sin causar fatiga.',
        applications: [
            'Amarre de tubos, perfiles y molduras',
            'Agrupación de cables y accesorios eléctricos',
            'Protección de productos pequeños en envíos',
            'Sujeción de bordes y esquinas',
        ],
        specs: {
            gauge: 'Calibre 50 / 60 micras',
            handling: 'Uso manual ultraligero (1 mano)',
            elasticity: 'Elongación hasta 180%',
        },
        image: '/images/stretch/stretch-12-5cm.svg',
    },
    {
        id: '15cm',
        widthCm: 15,
        title: 'Rollos Stretch 15 cm',
        tagline: 'Bandeado Mediano y Protección de Bordes',
        defaultWeight: 1.0,
        suggestedWeights: [0.5, 1.0, 1.5, 2.0, 2.5],
        description:
            'Excelente equilibrio entre ancho y agilidad. Perfecto para agrupar paquetes medianos, fijar esquineros en estibas y proteger productos alargados durante su transporte.',
        applications: [
            'Agrupación de cajas y paquetes medianos',
            'Fijación de esquineros en paletizado',
            'Protección de telas, rollos y varillas',
            'Empaque de piezas repuesto y ferretería',
        ],
        specs: {
            gauge: 'Calibre 50 / 70 micras',
            handling: 'Uso manual con aplicador o directo',
            elasticity: 'Elongación hasta 200%',
        },
        image: '/images/stretch/stretch-15cm.svg',
    },
    {
        id: '30cm',
        widthCm: 30,
        title: 'Rollos Stretch 30 cm',
        tagline: 'Empaque General y Cajas Medianas/Grandes',
        defaultWeight: 2.0,
        suggestedWeights: [1.0, 1.5, 2.0, 2.5, 3.0, 4.0],
        description:
            'La opción más versátil para empaque diario en bodegas. Ofrece una cobertura óptima para cajas grandes, muebles, electrodomésticos y cargas medianas con alta adherencia.',
        applications: [
            'Empaque de cajas de medianas a grandes',
            'Protección de muebles y electrodomésticos',
            'Paletizado de cargas livianas y medianas',
            'Sellado hermético contra polvo y humedad',
        ],
        specs: {
            gauge: 'Calibre 60 / 80 micras',
            handling: 'Uso manual estándar de 2 manos',
            elasticity: 'Elongación hasta 220%',
        },
        image: '/images/stretch/stretch-30cm.svg',
    },
    {
        id: '45cm',
        widthCm: 45,
        title: 'Rollos Stretch 45 cm',
        tagline: 'Paletizado Manual de Alto Rendimiento',
        defaultWeight: 2.5,
        suggestedWeights: [1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
        description:
            'Medida estándar profesional para estibas completas. Permite envolver pallets enteros en pocas vueltas con máxima tensión, reteniendo cargas pesadas sin desgarrarse.',
        applications: [
            'Paletizado completo de estibas de mercancía',
            'Empaque industrial de alta exigencia',
            'Protección para almacenamiento prolongado',
            'Envolvente de carga pesada en camiones',
        ],
        specs: {
            gauge: 'Calibre 70 / 90 micras',
            handling: 'Uso manual paletizador profesional',
            elasticity: 'Elongación superior hasta 250%',
        },
        image: '/images/stretch/stretch-45cm.svg',
    },
    {
        id: '50cm',
        widthCm: 50,
        title: 'Rollos Stretch 50 cm',
        tagline: 'Cobertura Industrial Máxima',
        defaultWeight: 3.5,
        suggestedWeights: [2.0, 3.0, 3.5, 4.0, 5.0, 6.0],
        description:
            'Diseñado para cobertura total rápida en operaciones industriales intensivas y exportación. Ofrece el mayor rendimiento por metroenvuelto y máxima contención.',
        applications: [
            'Estibas industriales de gran altura y peso',
            'Empaque intensivo en centros de distribución',
            'Protección para transporte y exportación',
            'Sellado industrial de máxima seguridad',
        ],
        specs: {
            gauge: 'Calibre 80 / 100 micras ultra reforzado',
            handling: 'Uso manual / semi-industrial',
            elasticity: 'Elongación máxima hasta 280%',
        },
        image: '/images/stretch/stretch-50cm.svg',
    },
];

const WHATSAPP_PHONE = '573004093658';

export function StretchSection() {
    const [selectedSizeId, setSelectedSizeId] = useState<string>('30cm');
    const [weight, setWeight] = useState<number>(2.0);
    const sliderId = useId();

    const activeOption =
        STRETCH_OPTIONS.find((opt) => opt.id === selectedSizeId) || STRETCH_OPTIONS[2];

    const handleSelectSize = (opt: StretchOption) => {
        setSelectedSizeId(opt.id);
        setWeight(opt.defaultWeight);
    };

    // Estimar metros aproximados según peso y ancho (promedio 1kg en 50cm cal 50 = ~130m)
    const estimatedMeters = Math.round((weight * 6500) / activeOption.widthCm);

    // Mensaje dinámico para WhatsApp
    const whatsappMessage = `Hola Inbobinex, me interesa cotizar el Papel Stretch en medida de ${activeOption.widthCm} cm (${activeOption.title}) con un peso personalizado de ${weight.toFixed(1)} kg. ¿Me podrían brindar información de precio y disponibilidad?`;
    const whatsappUrl = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(whatsappMessage)}`;

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': activeOption.title,
        'image': `https://inbobinex.com${activeOption.image}`,
        'description': activeOption.description,
        'brand': {
            '@type': 'Brand',
            'name': 'Inbobinex',
        },
        'offers': {
            '@type': 'Offer',
            'priceCurrency': 'COP',
            'availability': 'https://schema.org/InStock',
            'seller': {
                '@type': 'Organization',
                'name': 'Inbobinex',
            },
        },
    };

    return (
        <section id="papel-stretch" className="relative overflow-hidden bg-[#F4F7F5] py-20">
            {/* JSON-LD Structured Data */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            {/* Background decorative glows */}
            <div className="pointer-events-none absolute -left-20 top-10 h-96 w-96 rounded-full bg-[#3F8346]/10 blur-3xl" />
            <div className="pointer-events-none absolute -right-20 bottom-10 h-96 w-96 rounded-full bg-[#2E4040]/10 blur-3xl" />

            <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                {/* Header */}
                <div className="text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#3F8346]/30 bg-[#3F8346]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-[#3F8346]">
                        <Sparkles className="h-4 w-4" /> Soluciones Personalizadas
                    </div>
                    <h2 className="font-heading mt-4 text-3xl font-extrabold text-[#2E4040] sm:text-4xl lg:text-5xl">
                        Papeles <span className="text-[#3F8346]">Stretch</span> a Tu Medida
                    </h2>
                    <p className="mx-auto mt-4 max-w-2xl text-base text-[#617064] sm:text-lg">
                        Selecciona el ancho del rollo y ajusta el peso según los requerimientos de tu
                        empresa. Cotiza directamente por WhatsApp en un solo clic.
                    </p>
                </div>

                {/* Size Selector Tabs */}
                <div className="mt-10 flex flex-wrap justify-center gap-2 sm:gap-3">
                    {STRETCH_OPTIONS.map((opt) => {
                        const isActive = opt.id === selectedSizeId;
                        return (
                            <button
                                key={opt.id}
                                onClick={() => handleSelectSize(opt)}
                                className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all duration-200 ${
                                    isActive
                                        ? 'scale-105 bg-[#3F8346] text-white shadow-lg shadow-[#3F8346]/30 ring-2 ring-[#3F8346]'
                                        : 'bg-white text-[#2E4040] border border-[#C8CDC9] hover:border-[#3F8346] hover:bg-[#3F8346]/5'
                                }`}
                            >
                                <Ruler className={`h-4 w-4 ${isActive ? 'text-white' : 'text-[#3F8346]'}`} />
                                <span>{opt.widthCm} cm</span>
                            </button>
                        );
                    })}
                </div>

                {/* Main Product Showcase Box */}
                <div className="mt-12 grid gap-8 rounded-3xl border border-[#C8CDC9]/70 bg-white p-6 shadow-xl lg:grid-cols-12 lg:p-10">
                    {/* Left Column: Interactive Image Preview */}
                    <div className="flex flex-col items-center justify-between rounded-2xl bg-[#F4F7F5] p-6 lg:col-span-5">
                        <div className="w-full flex items-center justify-between">
                            <span className="rounded-full bg-[#2E4040] px-3 py-1 text-xs font-semibold text-white">
                                Ancho: {activeOption.widthCm} cm
                            </span>
                            <span className="rounded-full bg-[#3F8346]/10 px-3 py-1 text-xs font-bold text-[#3F8346]">
                                Peso: {weight.toFixed(1)} kg
                            </span>
                        </div>

                        {/* Roll Visual */}
                        <div className="relative my-6 aspect-square w-full max-w-[340px] overflow-hidden transition-all duration-300">
                            <Image
                                key={activeOption.id}
                                src={activeOption.image}
                                alt={activeOption.title}
                                fill
                                className="object-contain transition-transform duration-300 hover:scale-105"
                                priority
                            />
                        </div>

                        {/* Estimated Metric Badges */}
                        <div className="grid w-full grid-cols-2 gap-3 pt-2">
                            <div className="rounded-xl border border-[#C8CDC9]/50 bg-white p-3 text-center shadow-sm">
                                <span className="block text-xs font-semibold text-[#617064]">
                                    Largo Est.
                                </span>
                                <span className="font-heading text-lg font-bold text-[#2E4040]">
                                    ~{estimatedMeters} m
                                </span>
                            </div>
                            <div className="rounded-xl border border-[#C8CDC9]/50 bg-white p-3 text-center shadow-sm">
                                <span className="block text-xs font-semibold text-[#617064]">
                                    Calibre
                                </span>
                                <span className="font-heading text-sm font-bold text-[#3F8346] truncate block">
                                    {activeOption.specs.gauge.split('/')[0]}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Customization Controls & Details */}
                    <div className="flex flex-col justify-between lg:col-span-7">
                        <div>
                            {/* Title & Tagline */}
                            <div className="border-b border-[#C8CDC9]/40 pb-4">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-heading text-2xl font-bold text-[#2E4040] sm:text-3xl">
                                        {activeOption.title}
                                    </h3>
                                </div>
                                <p className="mt-1 font-semibold text-[#3F8346]">
                                    {activeOption.tagline}
                                </p>
                                <p className="mt-3 text-sm leading-relaxed text-[#617064]">
                                    {activeOption.description}
                                </p>
                            </div>

                            {/* Weight Adjustment Controls */}
                            <div className="mt-6 rounded-2xl bg-[#F4F7F5]/80 p-5 border border-[#C8CDC9]/50">
                                <div className="flex items-center justify-between">
                                    <label htmlFor={sliderId} className="flex items-center gap-2 font-bold text-[#2E4040]">
                                        <Scale className="h-5 w-5 text-[#3F8346]" />
                                        <span>Ajustar Peso del Rollo:</span>
                                    </label>
                                    <span className="font-heading text-xl font-extrabold text-[#3F8346]">
                                        {weight.toFixed(1)} <span className="text-sm font-normal text-[#2E4040]">kg</span>
                                    </span>
                                </div>

                                {/* Slider */}
                                <div className="mt-4">
                                    <input
                                        id={sliderId}
                                        type="range"
                                        min="0.3"
                                        max="8.0"
                                        step="0.1"
                                        value={weight}
                                        onChange={(e) => setWeight(parseFloat(e.target.value))}
                                        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#C8CDC9] accent-[#3F8346]"
                                    />
                                    <div className="flex justify-between text-xs font-semibold text-[#617064] mt-1">
                                        <span>0.3 kg</span>
                                        <span>2.0 kg</span>
                                        <span>5.0 kg</span>
                                        <span>8.0 kg</span>
                                    </div>
                                </div>

                                {/* Quick Weight Chips */}
                                <div className="mt-4 flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-semibold text-[#617064]">
                                        Sugeridos:
                                    </span>
                                    {activeOption.suggestedWeights.map((w) => (
                                        <button
                                            key={w}
                                            onClick={() => setWeight(w)}
                                            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors ${
                                                weight === w
                                                    ? 'bg-[#3F8346] text-white'
                                                    : 'bg-white border border-[#C8CDC9] text-[#2E4040] hover:border-[#3F8346]'
                                            }`}
                                        >
                                            {w.toFixed(1)} kg
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Specs & Applications List */}
                            <div className="mt-6 grid gap-4 sm:grid-cols-2">
                                <div className="rounded-xl border border-[#C8CDC9]/40 p-4 bg-white">
                                    <h4 className="flex items-center gap-2 font-bold text-[#2E4040] text-sm">
                                        <Layers className="h-4 w-4 text-[#3F8346]" /> Usos Recomendados
                                    </h4>
                                    <ul className="mt-2 space-y-1.5 text-xs text-[#617064]">
                                        {activeOption.applications.map((app, idx) => (
                                            <li key={idx} className="flex items-start gap-1.5">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-[#3F8346] shrink-0 mt-0.5" />
                                                <span>{app}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="rounded-xl border border-[#C8CDC9]/40 p-4 bg-white">
                                    <h4 className="flex items-center gap-2 font-bold text-[#2E4040] text-sm">
                                        <Sparkles className="h-4 w-4 text-[#3F8346]" /> Ficha Técnica
                                    </h4>
                                    <div className="mt-2 space-y-2 text-xs">
                                        <div>
                                            <span className="font-semibold text-[#2E4040]">Espesor/Calibre: </span>
                                            <span className="text-[#617064]">{activeOption.specs.gauge}</span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-[#2E4040]">Manejo: </span>
                                            <span className="text-[#617064]">{activeOption.specs.handling}</span>
                                        </div>
                                        <div>
                                            <span className="font-semibold text-[#2E4040]">Rendimiento: </span>
                                            <span className="text-[#617064]">{activeOption.specs.elasticity}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* WhatsApp Action Button */}
                        <div className="mt-8 pt-4 border-t border-[#C8CDC9]/40">
                            <a
                                href={whatsappUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-[#25D366] px-6 py-4 text-center font-bold text-white shadow-lg shadow-[#25D366]/25 transition-all duration-300 hover:bg-[#1EBE57] hover:shadow-xl hover:scale-[1.01]"
                            >
                                <svg className="h-6 w-6 fill-current" viewBox="0 0 24 24">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.638l4.716-1.244A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.327 0-4.542-.663-6.476-1.876l-.252-.156-3.426.904.946-3.264-.181-.271A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                                </svg>
                                <span>Cotizar {activeOption.widthCm}cm ({weight.toFixed(1)} kg) por WhatsApp</span>
                                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
