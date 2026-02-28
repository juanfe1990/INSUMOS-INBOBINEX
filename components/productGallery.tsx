'use client';

import Image from 'next/image';
import { useState } from 'react';

type ProductGalleryProps = {
    images: string[];
    productName: string;
};

export default function ProductGallery({ images, productName }: ProductGalleryProps) {
    const [mainImage, setMainImage] = useState<string>(images[0] || '/images/default-product.jpg');

    return (
        <div className="flex flex-col gap-4">
            {/* Imagen Principal */}
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-[#C8CDC9]/40 bg-[#F8F9FA]">
                <Image
                    src={mainImage}
                    alt={productName}
                    fill
                    className="object-contain p-4 transition-all duration-300"
                    unoptimized
                />
            </div>

            {/* Miniaturas de la Galería */}
            {images.length > 1 && (
                <div className="grid grid-cols-4 gap-4 sm:grid-cols-5">
                    {images.map((img, idx) => (
                        <button
                            key={idx}
                            onClick={() => setMainImage(img)}
                            className={`relative aspect-square overflow-hidden rounded-xl border-2 transition-all ${
                                mainImage === img
                                    ? 'border-[#3F8346] shadow-md'
                                    : 'border-transparent opacity-70 hover:opacity-100 hover:border-[#C8CDC9]'
                            }`}
                        >
                            <div className="absolute inset-0 bg-[#F8F9FA]"></div>
                            <Image
                                src={img}
                                alt={`Vista ${idx + 1}`}
                                fill
                                className="object-contain p-1"
                                unoptimized
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
