import { db, isFirebaseConfigured, storage } from '@/lib/firebase-admin';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!isFirebaseConfigured || !db || !storage) {
        return NextResponse.json({ error: 'Firebase not configured' }, { status: 503 });
    }
    try {
        const { id } = await params;
        const formData = await request.formData();
        const name = formData.get('name') as string;
        const description = formData.get('description') as string;
        const category = formData.get('category') as string;
        const image = formData.get('image') as File | null;

        if (!name || !category) {
            return NextResponse.json({ error: 'Name and category are required' }, { status: 400 });
        }

        const updateData: Record<string, string> = {
            name,
            description: description || '',
            category,
            updatedAt: new Date().toISOString(),
        };

        if (image && image.size > 0) {
            // Delete old image if exists
            const doc = await db.collection('products').doc(id).get();
            if (doc.exists) {
                const oldImageUrl = doc.data()?.imageUrl;
                if (oldImageUrl && oldImageUrl.includes('storage.googleapis.com')) {
                    try {
                        const bucket = storage.bucket();
                        const oldPath = oldImageUrl.split(`${bucket.name}/`)[1];
                        if (oldPath) {
                            await bucket.file(oldPath).delete();
                        }
                    } catch {
                        // Ignore delete errors
                    }
                }
            }

            const buffer = Buffer.from(await image.arrayBuffer());
            const fileName = `products/${Date.now()}-${image.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            const bucket = storage.bucket();
            const file = bucket.file(fileName);

            await file.save(buffer, {
                metadata: { contentType: image.type },
            });

            await file.makePublic();
            updateData.imageUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        }

        await db.collection('products').doc(id).update(updateData);
        return NextResponse.json({ message: 'Product updated' });
    } catch (error) {
        console.error('Error updating product:', error);
        return NextResponse.json({ error: 'Error updating product' }, { status: 500 });
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    if (!isFirebaseConfigured || !db || !storage) {
        return NextResponse.json({ error: 'Firebase not configured' }, { status: 503 });
    }
    try {
        const { id } = await params;
        const doc = await db.collection('products').doc(id).get();

        if (!doc.exists) {
            return NextResponse.json({ error: 'Product not found' }, { status: 404 });
        }

        // Delete image from storage
        const imageUrl = doc.data()?.imageUrl;
        if (imageUrl && imageUrl.includes('storage.googleapis.com')) {
            try {
                const bucket = storage.bucket();
                const filePath = imageUrl.split(`${bucket.name}/`)[1];
                if (filePath) {
                    await bucket.file(filePath).delete();
                }
            } catch {
                // Ignore delete errors
            }
        }

        await db.collection('products').doc(id).delete();
        return NextResponse.json({ message: 'Product deleted' });
    } catch (error) {
        console.error('Error deleting product:', error);
        return NextResponse.json({ error: 'Error deleting product' }, { status: 500 });
    }
}
