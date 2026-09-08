export type Product = {
    id: string;
    name: string;
    description: string;
    categoryId: string;
    slug: string; // Para URLs amigables
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

export interface PostData {
    id: string;
    title: string;
    date: string;
    description: string;
    image?: string;
    contentHtml?: string;
}

export type UserRole = 'admin' | 'vendedor' | 'operario';
export type OrderPriority = 'baja' | 'normal' | 'alta' | 'urgente';
export type OrderStatus =
    | 'pendiente'
    | 'en_cola'
    | 'en_embobinado'
    | 'listo_despacho'
    | 'enviado'
    | 'entregado'
    | 'cancelado';
export type FilmType = 'manual' | 'maquina' | 'preestirado' | 'color_negro' | 'color_azul' | 'otro';

export type Client = {
    id: string;
    business_name: string;
    nit_rut?: string | null;
    contact_name: string;
    phone: string;
    email?: string | null;
    delivery_address: string;
    city: string;
    notes?: string | null;
    created_by?: string | null;
    created_at: string;
    updated_at: string;
};

export type OrderItem = {
    id: string;
    order_id: string;
    product_id: string;
    quantity: number;
    completed_quantity: number;
    custom_width_inches?: number | null;
    custom_length_meters?: number | null;
    custom_caliber_microns?: number | null;
    unit_price: number;
    subtotal: number;
    notes?: string | null;
    created_at: string;
    product?: Product;
};

export type Order = {
    id: string;
    order_number: number;
    client_id: string;
    created_by: string;
    assigned_operator_id?: string | null;
    status: OrderStatus;
    priority: OrderPriority;
    delivery_date: string;
    delivery_address: string;
    notes?: string | null;
    total_amount: number;
    started_at?: string | null;
    completed_at?: string | null;
    shipped_at?: string | null;
    created_at: string;
    updated_at: string;
    client?: Client;
    items?: OrderItem[];
    operator?: {
        id: string;
        full_name: string;
        email: string;
    };
};

export type ProductionLog = {
    id: string;
    order_id: string;
    operator_id: string;
    previous_status: OrderStatus;
    new_status: OrderStatus;
    quantity_processed: number;
    waste_kg: number;
    notes?: string | null;
    created_at: string;
};

