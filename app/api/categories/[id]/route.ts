import { db, isFirebaseConfigured } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
    if (!isFirebaseConfigured || !db)
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });

    try {
        const { id } = params;
        const body = await request.json();
        const { name, description } = body;

        const updateData: any = {
            updatedAt: new Date().toISOString(),
        };

        if (name) {
            updateData.name = name;
            updateData.slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '');
        }
        if (description !== undefined) updateData.description = description;

        await db.collection('categories').doc(id).update(updateData);

        return NextResponse.json({ message: 'Categoría actualizada' }, { status: 200 });
    } catch (error) {
        console.error('Error updating category:', error);
        return NextResponse.json({ error: 'Error al actualizar la categoría' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
    if (!isFirebaseConfigured || !db)
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });

    try {
        const { id } = params;

        // Opcional pero recomendado: Verificar si hay productos usando esta categoría antes de borrarla
        const productsUsingCategory = await db
            .collection('products')
            .where('categoryId', '==', id)
            .limit(1)
            .get();
        if (!productsUsingCategory.empty) {
            return NextResponse.json(
                { error: 'No puedes eliminar una categoría que tiene productos asociados' },
                { status: 409 },
            );
        }

        await db.collection('categories').doc(id).delete();

        return NextResponse.json({ message: 'Categoría eliminada' }, { status: 200 });
    } catch (error) {
        console.error('Error deleting category:', error);
        return NextResponse.json({ error: 'Error al eliminar la categoría' }, { status: 500 });
    }
}
