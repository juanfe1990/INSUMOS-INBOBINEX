import fs from 'fs';
import matter from 'gray-matter';
import path from 'path';
import { remark } from 'remark';
import html from 'remark-html';
import type { PostData } from './types';

const postsDirectory = path.join(process.cwd(), 'posts');

export function getSortedPostsData(): PostData[] {
    // Obtener nombres de archivos bajo /posts
    const fileNames = fs.readdirSync(postsDirectory);

    const allPostsData = fileNames.map((fileName) => {
        // Eliminar ".md" del nombre del archivo para usarlo como id
        const id = fileName.replace(/\.md$/, '');

        // Leer el archivo markdown como string
        const fullPath = path.join(postsDirectory, fileName);
        const fileContents = fs.readFileSync(fullPath, 'utf8');

        // Usar gray-matter para parsear la sección de metadata del post
        const matterResult = matter(fileContents);

        // Combinar los datos con el id
        return {
            id,
            ...(matterResult.data as {
                title: string;
                date: string;
                description: string;
                image?: string;
            }),
        } as PostData;
    });

    // Ordenar los posts por fecha
    return allPostsData.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ... (tu código anterior de getSortedPostsData) ...

// Función para obtener todos los IDs (para las rutas dinámicas)
export function getAllPostIds() {
    const fileNames = fs.readdirSync(postsDirectory);
    return fileNames.map((fileName) => {
        return {
            id: fileName.replace(/\.md$/, ''),
        };
    });
}

// Función para obtener los datos completos de un solo post
export async function getPostData(id: string): Promise<PostData> {
    const fullPath = path.join(postsDirectory, `${id}.md`);
    const fileContents = fs.readFileSync(fullPath, 'utf8');

    // Parsear los metadatos
    const matterResult = matter(fileContents);

    // Procesar el contenido de Markdown a HTML
    const processedContent = await remark().use(html).process(matterResult.content);

    const contentHtml = processedContent.toString();

    return {
        id,
        contentHtml,
        ...(matterResult.data as {
            title: string;
            date: string;
            description: string;
            image?: string;
        }),
    };
}
