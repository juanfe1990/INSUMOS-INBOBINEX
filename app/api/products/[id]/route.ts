import { db, isFirebaseConfigured, storage } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

const createSlug = (text: string) => {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');
};

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!isFirebaseConfigured || !db || !storage) {
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });
    }

    try {
        const { id } = await params;
        const formData = await request.formData();

        const name = formData.get('name') as string;
        const description = formData.get('description') as string;
        const categoryId = formData.get('categoryId') as string;
        const orderStr = formData.get('order') as string;
        const keptGalleryStr = formData.get('keptGallery') as string;
        const newImages = formData.getAll('images') as File[];

        if (!name || !categoryId) {
            return NextResponse.json(
                { error: 'Nombre y categoría son obligatorios' },
                { status: 400 },
            );
        }

        // 1. GENERAR Y VALIDAR SLUG ÚNICO AL EDITAR
        let baseSlug = createSlug(name);
        let slug = baseSlug;
        let counter = 1;
        let slugExists = true;

        while (slugExists) {
            // Buscamos si existe el slug, PERO ignoramos el producto actual
            const snapshot = await db
                .collection('products')
                .where('slug', '==', slug)
                .where('__name__', '!=', id)
                .get();

            if (snapshot.empty) {
                slugExists = false;
            } else {
                slug = `${baseSlug}-${counter}`;
                counter++;
            }
        }

        let categoryName = '';
        const categoryDoc = await db.collection('categories').doc(categoryId).get();
        if (categoryDoc.exists) {
            categoryName = categoryDoc.data()?.name || '';
        }

        let keptGallery: string[] = [];
        try {
            if (keptGalleryStr) keptGallery = JSON.parse(keptGalleryStr);
        } catch (e) {
            console.error('Error parseando keptGallery:', e);
        }

        const productDoc = await db.collection('products').doc(id).get();
        if (!productDoc.exists) {
            return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
        }

        const currentData = productDoc.data();
        const currentGallery: string[] =
            currentData?.gallery || (currentData?.imageUrl ? [currentData?.imageUrl] : []);
        const bucket = storage.bucket();

        const imagesToDelete = currentGallery.filter((url) => !keptGallery.includes(url));

        for (const url of imagesToDelete) {
            if (url && url.includes('storage.googleapis.com')) {
                try {
                    const filePath = url.split(`${bucket.name}/`)[1];
                    if (filePath) await bucket.file(filePath).delete();
                } catch (error) {
                    // Ignoramos errores de borrado
                }
            }
        }

        const newImageUrls: string[] = [];
        const validNewImages = newImages.filter((img) => img && img.size > 0);

        for (const image of validNewImages) {
            const buffer = Buffer.from(await image.arrayBuffer());
            const fileName = `products/${Date.now()}-${image.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const file = bucket.file(fileName);

            await file.save(buffer, { metadata: { contentType: image.type } });
            await file.makePublic();
            newImageUrls.push(`https://storage.googleapis.com/${bucket.name}/${fileName}`);
        }

        const finalGallery = [...keptGallery, ...newImageUrls];

        const updateData: any = {
            name,
            slug, // <-- Actualizamos el slug si cambió el nombre
            description: description || '',
            categoryId,
            categoryName,
            order: orderStr ? Number(orderStr) : 0,
            gallery: finalGallery,
            imageUrl: finalGallery.length > 0 ? finalGallery[0] : '',
            updatedAt: new Date().toISOString(),
        };

        await db.collection('products').doc(id).update(updateData);
        return NextResponse.json({ message: 'Producto actualizado' });
    } catch (error) {
        console.error('Error actualizando producto:', error);
        return NextResponse.json({ error: 'Error actualizando producto' }, { status: 500 });
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!isFirebaseConfigured || !db || !storage) {
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });
    }

    try {
        const { id } = await params;
        const doc = await db.collection('products').doc(id).get();

        if (!doc.exists) {
            return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
        }

        const data = doc.data();

        if (!data) {
            return NextResponse.json(
                { error: 'Datos del producto no encontrados' },
                { status: 404 },
            );
        }
        // Obtener la galería o asegurar que borre la imageUrl si es un producto antiguo
        const allImages: string[] =
            data?.gallery?.length > 0 ? data.gallery : data?.imageUrl ? [data.imageUrl] : [];

        const bucket = storage.bucket();

        // Eliminar TODAS las imágenes asociadas al producto en Storage
        for (const url of allImages) {
            if (url && url.includes('storage.googleapis.com')) {
                try {
                    const filePath = url.split(`${bucket.name}/`)[1];
                    if (filePath) {
                        await bucket.file(filePath).delete();
                    }
                } catch (error) {
                    console.error(`Error borrando imagen ${url} durante la eliminación:`, error);
                }
            }
        }

        // Eliminar el documento en Firestore
        await db.collection('products').doc(id).delete();
        return NextResponse.json({ message: 'Producto y galería eliminados exitosamente' });
    } catch (error) {
        console.error('Error eliminando producto:', error);
        return NextResponse.json({ error: 'Error eliminando producto' }, { status: 500 });
    }
}
