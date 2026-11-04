import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

const hasFirebaseEnv = Boolean(projectId && clientEmail && privateKey);
let firebaseReady = false;

if (hasFirebaseEnv) {
    try {
        if (!getApps().length) {
            const serviceAccount: ServiceAccount = { projectId, clientEmail, privateKey };
            initializeApp({ credential: cert(serviceAccount), storageBucket });
        }
        firebaseReady = true;
    } catch (err) {
        // Credenciales inválidas (p. ej. FIREBASE_PRIVATE_KEY mal formateada):
        // no tumbar las rutas que importan este módulo.
        console.error('[firebase-admin] No se pudo inicializar Firebase:', err);
    }
}

export const isFirebaseConfigured = firebaseReady;
export const db = firebaseReady ? getFirestore() : null;
export const storage = firebaseReady ? getStorage() : null;
