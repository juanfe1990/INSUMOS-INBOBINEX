import { Clock, Mail, MapPin, Phone } from 'lucide-react';

export function ContactSection() {
    return (
        <section id="contacto" className="bg-[#FDFDFD] py-20">
            <div className="mx-auto max-w-7xl px-4">
                <div className="text-center">
                    <h2 className="font-heading text-3xl font-bold text-[#2E4040] md:text-4xl">
                        <span className="text-[#3F8346]">Contactanos</span>
                    </h2>
                    <p className="mx-auto mt-4 max-w-2xl text-[#949E97]">
                        Estamos listos para atenderte. Solicita tu cotizacion sin compromiso.
                    </p>
                </div>

                <div className="mt-14 grid gap-8 md:grid-cols-2">
                    {/* Contact info */}
                    <div className="space-y-8">
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[#3F8346]/10 text-[#3F8346]">
                                <Phone className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                    Telefono
                                </h3>
                                <a
                                    href="https://wa.me/573004093658"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1 text-[#949E97] transition-colors hover:text-[#3F8346]"
                                >
                                    +57 300 409 3658
                                </a>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[#3F8346]/10 text-[#3F8346]">
                                <Mail className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                    Correo
                                </h3>
                                <a
                                    href="mailto:gerencia@insumosinbobinex.com"
                                    className="mt-1 text-[#949E97] transition-colors hover:text-[#3F8346]"
                                >
                                    gerencia@insumosinbobinex.com
                                </a>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[#3F8346]/10 text-[#3F8346]">
                                <MapPin className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                    Ubicacion
                                </h3>
                                <p className="mt-1 text-[#949E97]">Colombia</p>
                            </div>
                        </div>

                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-[#3F8346]/10 text-[#3F8346]">
                                <Clock className="h-5 w-5" />
                            </div>
                            <div>
                                <h3 className="font-heading text-lg font-bold text-[#2E4040]">
                                    Horario
                                </h3>
                                <p className="mt-1 text-[#949E97]">
                                    Lunes a Viernes: 8:00 AM - 6:00 PM
                                </p>
                                <p className="text-[#949E97]">Sabados: 8:00 AM - 1:00 PM</p>
                            </div>
                        </div>
                    </div>

                    {/* CTA Card */}
                    <div className="flex flex-col items-center justify-center rounded-xl border border-[#C8CDC9] bg-[#C8CDC9]/10 p-8 text-center">
                        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#3F8346] text-[#FDFDFD]">
                            <svg className="h-10 w-10" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.638l4.716-1.244A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.327 0-4.542-.663-6.476-1.876l-.252-.156-3.426.904.946-3.264-.181-.271A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                            </svg>
                        </div>
                        <h3 className="font-heading text-2xl font-bold text-[#2E4040]">
                            Escríbenos por WhatsApp
                        </h3>
                        <p className="mt-3 max-w-sm text-[#949E97]">
                            Recibe atencion inmediata y cotizaciones personalizadas para tu negocio.
                        </p>
                        <a
                            href="https://wa.me/573004093658?text=Hola, me interesa cotizar productos de embalaje"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#3F8346] px-8 py-3.5 font-heading text-sm font-semibold uppercase tracking-wide text-[#FDFDFD] transition-colors hover:bg-[#2d6332]"
                        >
                            Iniciar conversacion
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
}
