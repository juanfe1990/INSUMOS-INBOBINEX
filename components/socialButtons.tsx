import { Instagram } from 'lucide-react';

function socialButtons() {
    return (
        <div className="fixed bottom-8 right-4 z-50 grid grid-cols-1 grid-rows-2 gap-4 place-content-center place-items-center">
            <a
                href="https://wa.me/573004093658?text=Hola, me interesa cotizar productos de embalaje"
                className="bg-green-500 hover:bg-green-600 text-white p-3 rounded-full"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contactanos por whatsapp"
            >
                <svg className="size-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.638l4.716-1.244A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.327 0-4.542-.663-6.476-1.876l-.252-.156-3.426.904.946-3.264-.181-.271A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z" />
                </svg>
            </a>

            <a
                href="https://www.instagram.com/insumosinbobinex"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ir a instragram de inbobinex"
                className="bg-green-500 hover:bg-green-600 text-white p-3 rounded-full"
            >
                <Instagram className="size-6" />
            </a>
        </div>
    );
}

export default socialButtons;
