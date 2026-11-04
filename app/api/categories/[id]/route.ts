import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { slugify } from '@/lib/slugify';

const NO_PERMISSION =
    'No tienes permiso para modificar categorías (se requiere rol admin) o la categoría ya no existe.';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const updateData: { name?: string; slug?: string; description?: string | null } = {};
    if (typeof body.name === 'string' && body.name.trim()) {
        updateData.name = body.name.trim();
        updateData.slug = slugify(body.name);
    }
    if (body.description !== undefined) {
        updateData.description = body.description?.trim() || null;
    }

    const supabase = await createClient();
    const { data, error } = await supabase.from('categories').update(updateData).eq('id', id).select();

    if (error) {
        const msg = error.code === '23505' ? 'Ya existe una categoría con ese nombre' : error.message;
        return NextResponse.json({ error: msg }, { status: 400 });
    }
    // RLS no lanza error: simplemente no afecta filas
    if (!data || data.length === 0) {
        return NextResponse.json({ error: NO_PERMISSION }, { status: 403 });
    }
    return NextResponse.json({ message: 'Categoría actualizada con éxito', data: data[0] }, { status: 200 });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();

    // Desvincular productos antes de borrar (la FK products.category_id no es SET NULL en todos los entornos)
    const { error: unlinkError } = await supabase
        .from('products')
        .update({ category_id: null })
        .eq('category_id', id);
    if (unlinkError) {
        return NextResponse.json({ error: unlinkError.message }, { status: 400 });
    }

    const { data, error } = await supabase.from('categories').delete().eq('id', id).select();

    if (error) {
        const msg =
            error.code === '23503'
                ? 'La categoría aún tiene productos asociados que no se pudieron desvincular.'
                : error.message;
        return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (!data || data.length === 0) {
        return NextResponse.json({ error: NO_PERMISSION }, { status: 403 });
    }
    return NextResponse.json({ message: 'Categoría eliminada exitosamente' }, { status: 200 });
}
