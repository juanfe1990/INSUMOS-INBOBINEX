import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

export const isFirebaseConfigured = Boolean(projectId && clientEmail && privateKey);

// console.log("[v0] Firebase config check:", {
//   hasProjectId: Boolean(projectId),
//   hasClientEmail: Boolean(clientEmail),
//   hasPrivateKey: Boolean(privateKey),
//   isFirebaseConfigured,
//   appsLength: getApps().length,
// })

if (isFirebaseConfigured && !getApps().length) {
    const serviceAccount: ServiceAccount = {
        projectId,
        clientEmail,
        privateKey,
    };
    initializeApp({
        credential: cert(serviceAccount),
        storageBucket,
    });
}

export const db = isFirebaseConfigured ? getFirestore() : null;
export const storage = isFirebaseConfigured ? getStorage() : null;
