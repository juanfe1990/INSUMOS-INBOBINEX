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

export async function POST(request: NextRequest) {
    if (!isFirebaseConfigured || !db || !storage) {
        return NextResponse.json(
            {
                error: 'Firebase no esta configurado. Por favor configura las variables de entorno.',
            },
            { status: 503 },
        );
    }

    try {
        const formData = await request.formData();
        const name = formData.get('name') as string;
        const description = formData.get('description') as string;
        const categoryId = formData.get('categoryId') as string; // Cambio: ahora recibimos el ID
        const images = formData.getAll('images') as File[];

        if (!name || !categoryId) {
            return NextResponse.json(
                { error: 'Name and categoryId are required' },
                { status: 400 },
            );
        }

        // NUEVO: Validar que la categoría exista y obtener su nombre
        const categoryDoc = await db.collection('categories').doc(categoryId).get();
        if (!categoryDoc.exists) {
            return NextResponse.json(
                { error: 'La categoría especificada no existe' },
                { status: 404 },
            );
        }
        const categoryName = categoryDoc.data()?.name;

        const bucket = storage.bucket();
        const imageUrls: string[] = [];

        if (images.length > 0) {
            for (const image of images) {
                if (image.size > 0) {
                    const buffer = Buffer.from(await image.arrayBuffer());
                    const fileName = `products/${Date.now()}-${image.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
                    const file = bucket.file(fileName);

                    await file.save(buffer, { metadata: { contentType: image.type } });
                    await file.makePublic();
                    imageUrls.push(`https://storage.googleapis.com/${bucket.name}/${fileName}`);
                }
            }
        }

        const countSnapshot = await db.collection('products').count().get();
        const order = countSnapshot.data().count;

        const docRef = await db.collection('products').add({
            name,
            description: description || '',
            categoryId, // Guardamos el ID para filtros y relaciones
            categoryName, // Guardamos el nombre para mostrarlo rápido en el frontend
            imageUrl: imageUrls[0] || '',
            gallery: imageUrls,
            order,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json({ id: docRef.id, message: 'Product created' }, { status: 201 });
    } catch (error) {
        console.error('Error creating product:', error);
        return NextResponse.json({ error: 'Error creating product' }, { status: 500 });
    }
}
