import { db, isFirebaseConfigured } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }, // Solución al error de Next.js: params es una Promesa
) {
    if (!isFirebaseConfigured || !db)
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });

    try {
        const { id } = await params; // Ahora esperamos los params
        const body = await request.json();
        const { name, description } = body;

        const updateData: any = {
            updatedAt: new Date().toISOString(),
        };

        let nameChanged = false;

        if (name) {
            updateData.name = name;
            updateData.slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '');
            nameChanged = true;
        }
        if (description !== undefined) updateData.description = description;

        // Si el nombre de la categoría cambia, actualizamos también los productos asociados
        if (nameChanged) {
            const batch = db.batch();

            // 1. Actualizamos la categoría
            const categoryRef = db.collection('categories').doc(id);
            batch.update(categoryRef, updateData);

            // 2. Buscamos los productos con esta categoría y actualizamos su categoryName
            const productsSnapshot = await db
                .collection('products')
                .where('categoryId', '==', id)
                .get();
            productsSnapshot.forEach((doc) => {
                batch.update(doc.ref, { categoryName: name });
            });

            // Ejecutamos todos los cambios juntos
            await batch.commit();
        } else {
            // Si solo cambió la descripción, no hace falta actualizar productos
            await db.collection('categories').doc(id).update(updateData);
        }

        return NextResponse.json({ message: 'Categoría actualizada' }, { status: 200 });
    } catch (error) {
        console.error('Error updating category:', error);
        return NextResponse.json({ error: 'Error al actualizar la categoría' }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!isFirebaseConfigured || !db)
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });

    try {
        const { id } = await params;

        const batch = db.batch();

        // 1. Encontrar todos los productos que usan esta categoría
        const productsSnapshot = await db
            .collection('products')
            .where('categoryId', '==', id)
            .get();

        // 2. Desvincular la categoría de esos productos
        productsSnapshot.forEach((doc) => {
            batch.update(doc.ref, {
                categoryId: '', // ID vacío
                categoryName: 'Sin categoría', // Nombre por defecto
            });
        });

        // 3. Eliminar la categoría
        const categoryRef = db.collection('categories').doc(id);
        batch.delete(categoryRef);

        // 4. Ejecutar el lote completo
        await batch.commit();

        return NextResponse.json(
            {
                message: `Categoría eliminada y ${productsSnapshot.size} productos actualizados`,
            },
            { status: 200 },
        );
    } catch (error) {
        console.error('Error deleting category:', error);
        return NextResponse.json({ error: 'Error al eliminar la categoría' }, { status: 500 });
    }
}
