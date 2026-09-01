// src/config/firebase.js
//
// Firebase Admin initialization.
//
// Credentials can be provided two ways (first match wins):
//   1. Env vars:        FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
//   2. A service account JSON file: pointed to by GOOGLE_APPLICATION_CREDENTIALS,
//      or a file named `serviceAccountKey.json` in this directory.
//
// This matches the same Firebase project that the Flutter app authenticates against
// (Firebase Auth + Cloud Messaging). Keep them in sync!

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadServiceAccount() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
        return {
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, "\n"),
        };
    }

    // Fall back to a service account JSON file
    const candidates = [];
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    }
    candidates.push(path.join(__dirname, "serviceAccountKey.json"));

    for (const filePath of candidates) {
        if (fs.existsSync(filePath)) {
            try {
                const raw = fs.readFileSync(filePath, "utf8");
                const sa = JSON.parse(raw);
                return {
                    projectId: sa.project_id,
                    clientEmail: sa.client_email,
                    privateKey: sa.private_key,
                };
            } catch (err) {
                console.error(`[Firebase] Failed to read service account at ${filePath}:`, err.message);
            }
            break;
        }
    }

    return null;
}

if (!admin.apps.length) {
    const credentialObject = loadServiceAccount();

    if (!credentialObject) {
        const message =
            "Firebase is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL " +
            "and FIREBASE_PRIVATE_KEY (or provide a serviceAccountKey.json / GOOGLE_APPLICATION_CREDENTIALS).";
        console.error("[Firebase]", message);
        throw new Error(message);
    }

    admin.initializeApp({
        credential: admin.credential.cert(credentialObject),
    });
    console.log(`[Firebase] Initialized project: ${credentialObject.projectId}`);
}

export default admin;
