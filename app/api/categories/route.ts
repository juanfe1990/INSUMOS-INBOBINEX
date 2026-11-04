import { createClient } from '@/lib/supabase/server';
import { CATEGORIES } from '@/lib/types';
import { slugify } from '@/lib/slugify';
import { NextRequest, NextResponse } from 'next/server';

function errorResponse(error: { message?: string; code?: string } | null, fallback: string) {
    const message =
        error?.code === '23505'
            ? 'Ya existe una categoría con ese nombre'
            : error?.message || fallback;
    return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('name', { ascending: true });

    if (error) return errorResponse(error, 'Error al obtener categorías');
    return NextResponse.json(data ?? [], { status: 200 });
}

/**
 * POST { name, description }  -> crea una categoría
 * POST { seed: true }         -> carga las categorías predeterminadas (solo si no existen)
 */
export async function POST(request: NextRequest) {
    const supabase = await createClient();
    const body = await request.json().catch(() => ({}));

    if (body?.seed === true) {
        const defaults = CATEGORIES.map((c) => ({
            name: c.name,
            slug: c.slug,
            description: `Categoría de ${c.name}`,
        }));
        const { data, error } = await supabase
            .from('categories')
            .upsert(defaults, { onConflict: 'slug', ignoreDuplicates: true })
            .select();
        if (error) return errorResponse(error, 'No se pudieron cargar las categorías predeterminadas');
        return NextResponse.json({ data, message: 'Categorías predeterminadas cargadas' }, { status: 201 });
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
        return NextResponse.json({ error: 'El nombre de la categoría es obligatorio' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('categories')
        .insert([{ name, slug: slugify(name), description: body.description?.trim() || null }])
        .select()
        .single();

    if (error) return errorResponse(error, 'Error al crear la categoría');
    return NextResponse.json({ id: data.id, data, message: 'Categoría creada exitosamente' }, { status: 201 });
}
