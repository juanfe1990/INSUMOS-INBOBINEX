import { db, isFirebaseConfigured, storage } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
    if (!isFirebaseConfigured || !db) {
        return NextResponse.json([]);
    }
    try {
        const snapshot = await db.collection('products').orderBy('order', 'asc').get();
        const products = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
        return NextResponse.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        return NextResponse.json({ error: 'Error fetching products' }, { status: 500 });
    }
}

const createSlug = (text: string) => {
    return text
        .toLowerCase()
        .normalize('NFD') // Separa las letras de sus tildes (ej: á -> a)
        .replace(/[\u0300-\u036f]/g, '') // Elimina las tildes
        .replace(/[^a-z0-9]+/g, '-') // Reemplaza espacios y caracteres raros por guiones
        .replace(/(^-|-$)+/g, ''); // Elimina guiones al principio o al final
};

export async function POST(request: NextRequest) {
    if (!isFirebaseConfigured || !db || !storage) {
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });
    }

    try {
        const formData = await request.formData();
        const name = formData.get('name') as string;
        const description = formData.get('description') as string;
        const categoryId = formData.get('categoryId') as string;
        const orderStr = formData.get('order') as string;
        const images = formData.getAll('images') as File[];

        if (!name || !categoryId) {
            return NextResponse.json(
                { error: 'Nombre y categoría son obligatorios' },
                { status: 400 },
            );
        }

        // 1. GENERAR Y VALIDAR SLUG ÚNICO
        let baseSlug = createSlug(name);
        let slug = baseSlug;
        let counter = 1;
        let slugExists = true;

        while (slugExists) {
            const snapshot = await db.collection('products').where('slug', '==', slug).get();
            if (snapshot.empty) {
                slugExists = false; // El slug está libre
            } else {
                slug = `${baseSlug}-${counter}`; // Si existe, le añadimos un número
                counter++;
            }
        }

        // 2. Obtener nombre de la categoría
        const categoryDoc = await db.collection('categories').doc(categoryId).get();
        if (!categoryDoc.exists) {
            return NextResponse.json(
                { error: 'La categoría especificada no existe' },
                { status: 404 },
            );
        }
        const categoryName = categoryDoc.data()?.name;

        // 3. Subir Imágenes
        const bucket = storage.bucket();
        const imageUrls: string[] = [];
        const validImages = images.filter((image) => image && image.size > 0);

        if (validImages.length > 0) {
            for (const image of validImages) {
                const buffer = Buffer.from(await image.arrayBuffer());
                const fileName = `products/${Date.now()}-${image.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                const file = bucket.file(fileName);

                await file.save(buffer, { metadata: { contentType: image.type } });
                await file.makePublic();
                imageUrls.push(`https://storage.googleapis.com/${bucket.name}/${fileName}`);
            }
        }

        // 4. Guardar en Firestore con el SLUG
        const docRef = await db.collection('products').add({
            name,
            slug, // <-- Nuevo campo para SEO
            description: description || '',
            categoryId,
            categoryName,
            order: orderStr ? Number(orderStr) : 0,
            imageUrl: imageUrls[0] || '',
            gallery: imageUrls,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json(
            { id: docRef.id, slug, message: 'Product created' },
            { status: 201 },
        );
    } catch (error) {
        console.error('Error creating product:', error);
        return NextResponse.json({ error: 'Error creating product' }, { status: 500 });
    }
}
