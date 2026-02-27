import { db, isFirebaseConfigured } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
    if (!isFirebaseConfigured || !db)
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });

    try {
        const snapshot = await db.collection('categories').orderBy('createdAt', 'desc').get();
        const categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        return NextResponse.json(categories, { status: 200 });
    } catch (error) {
        console.error('Error fetching categories:', error);
        return NextResponse.json({ error: 'Error al obtener categorías' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    if (!isFirebaseConfigured || !db)
        return NextResponse.json({ error: 'Firebase no configurado' }, { status: 503 });

    try {
        const body = await request.json();
        const { name, description } = body;

        if (!name) {
            return NextResponse.json(
                { error: 'El nombre de la categoría es obligatorio' },
                { status: 400 },
            );
        }

        // Opcional: Crear un "slug" para URLs amigables (ej: "Cajas de Cartón" -> "cajas-de-carton")
        const slug = name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');

        const docRef = await db.collection('categories').add({
            name,
            slug,
            description: description || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        return NextResponse.json(
            { id: docRef.id, message: 'Categoría creada exitosamente' },
            { status: 201 },
        );
    } catch (error) {
        console.error('Error creating category:', error);
        return NextResponse.json({ error: 'Error al crear la categoría' }, { status: 500 });
    }
}
