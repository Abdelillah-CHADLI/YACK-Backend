// src/config/firebase.js
//
// Firebase Admin initialization.
//
// Credentials are resolved by firebaseCredentials.js: either the
// FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars
// or GOOGLE_APPLICATION_CREDENTIALS (a service-account JSON file). The old
// implicit `serviceAccountKey.json` fallback in this directory was removed
// (F-28) so a stray key copy can no longer be picked up automatically.
//
// This matches the same Firebase project that the Flutter app authenticates
// against (Firebase Auth + Cloud Messaging). Keep them in sync!

import admin from "firebase-admin";
import { firebaseDetectionMessage, loadServiceAccount } from "./firebaseCredentials.js";

if (!admin.apps.length) {
    const credentialObject = loadServiceAccount();

    if (!credentialObject) {
        const message = `Firebase is not configured. ${firebaseDetectionMessage}`;
        console.error("[Firebase]", message);
        throw new Error(message);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credentialObject),
    });
    console.log(`[Firebase] Initialized project: ${credentialObject.projectId}`);
}

export default admin;