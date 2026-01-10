// src/config/firebase.js
import admin from "firebase-admin";
import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
    });
}

export const bucket = admin.storage().bucket();

export default admin;
