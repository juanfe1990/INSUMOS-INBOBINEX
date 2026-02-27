export type Product = {
    id: string;
    name: string;
    description: string;
    categoryId: string;
    categoryName?: string; // Lo guardamos en Firebase para lectura rápida
    imageUrl: string; // URL de la imagen principal (portada)
    gallery: string[]; // Array con todas las URLs de las imágenes
    order: number; // Posición para ordenar los productos
    createdAt?: string; // Fecha de creación (ISO string)
    updatedAt?: string; // Fecha de última modificación (ISO string)

    // Opcional: mantenemos 'category' por compatibilidad si tienes
    // productos antiguos creados antes de este cambio
    category?: string;
};

export type Category = {
    id: string;
    name: string;
    slug: string;
    description?: string;
    createdAt?: string;
    updatedAt?: string;
};

export const CATEGORIES = [
    { name: 'Papel Burbuja', slug: 'papel-burbuja' },
    { name: 'Cintas Adhesivas', slug: 'cintas-adhesivas' },
    { name: 'Stretch / Vinipel', slug: 'stretch-vinipel' },
    { name: 'Cajas y Carton', slug: 'cajas-carton' },
    { name: 'Bolsas', slug: 'bolsas' },
    { name: 'Espumas y Proteccion', slug: 'espumas-proteccion' },
    { name: 'Zuncho y Grapas', slug: 'zuncho-grapas' },
    { name: 'Otros Insumos', slug: 'otros-insumos' },
] as const;
