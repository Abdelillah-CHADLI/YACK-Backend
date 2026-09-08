// src/config/firebaseCredentials.js
//
// Pure credential resolution for Firebase Admin (F-28). Kept separate from
// firebase.js so it can be unit tested without initializing the Admin SDK.
//
// Credentials are resolved, in order:
//   1. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY env vars
//   2. GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON file
//
// The old implicit `serviceAccountKey.json` next to this directory was removed:
// a second, conveniently-located copy of the Admin SDK key is exactly the
// credential-sprawl risk the audit flagged.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadServiceAccount(env = process.env, fsModule = fs) {
    const projectId = env.FIREBASE_PROJECT_ID;
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKey = env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
        return {
            projectId,
            clientEmail,
            privateKey: String(privateKey).replace(/\\n/g, "\n"),
        };
    }

    const filePath = env.GOOGLE_APPLICATION_CREDENTIALS;
    if (filePath && fsModule.existsSync(path.resolve(filePath))) {
        try {
            const raw = fsModule.readFileSync(path.resolve(filePath), "utf8");
            const sa = JSON.parse(raw);
            return {
                projectId: sa.project_id,
                clientEmail: sa.client_email,
                privateKey: sa.private_key,
            };
        } catch (err) {
            console.error(`[Firebase] Failed to read service account at ${filePath}:`, err.message);
            return null;
        }
    }

    return null;
}

export const firebaseDetectionMessage =
    "Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY " +
    "(or provide GOOGLE_APPLICATION_CREDENTIALS).";