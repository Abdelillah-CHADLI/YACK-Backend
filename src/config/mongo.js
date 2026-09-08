// src/config/mongo.js
//
// MongoDB connection (F-69). The module no longer opens a connection on import:
// index.js resolves the URI through validateEnv() and calls connectDatabase()
// explicitly, so unit tests can import resolveMongoUri() without spawning a
// connection. The previous silent localhost fallback is now limited to local
// development and refused in production.

import mongoose from "mongoose";
import { isProduction } from "./validateEnv.js";

const DEV_FALLBACK_URI = "mongodb://127.0.0.1:27017/yack";

export function resolveMongoUri(env = process.env, production = isProduction(env)) {
    const uri = String(env.MONGO_URI || "").trim();
    if (uri) return uri;

    if (production) {
        throw new Error(
            "MONGO_URI is required in production (see SETUP.md). Refusing to start."
        );
    }

    console.warn("[mongo] MONGO_URI not set; using local development fallback " + DEV_FALLBACK_URI);
    return DEV_FALLBACK_URI;
}

export async function connectDatabase(uri = resolveMongoUri()) {
    await mongoose.connect(uri, { dbName: "yack" });
    return mongoose;
}

export default mongoose;