import crypto from "crypto";
import path from "path";
import { bucket } from "../config/firebase.js";
import { CryptoHandler } from "./cryptoHandler.js";

export class MediaHandler {

    static async send(media, publicKeyBase64) {
        if (!media || !media.buffer || !media.filename) {
            throw new Error("Invalid media payload");
        }

        if (!publicKeyBase64) {
            throw new Error("Public key required for encryption");
        }

        const fileBuffer = Buffer.from(media.buffer, 'base64');

        const { encryptedData, encryptedKey, iv, authTag } = CryptoHandler.encryptMedia(
            fileBuffer,
            publicKeyBase64
        );

        // Create unique filename to avoid collisions
        const timestamp = Date.now();
        const randomStr = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(media.filename);
        const baseName = path.basename(media.filename, ext);
        const encryptedFilename = `media/${baseName}_${timestamp}_${randomStr}${ext}.enc`;

        // Upload encrypted file to Firebase Storage
        const file = bucket.file(encryptedFilename);
        await file.save(encryptedData, {
            metadata: {
                contentType: 'application/octet-stream',
                metadata: {
                    encryptedKey: encryptedKey.toString('base64'),
                    iv: iv.toString('base64'),
                    authTag: authTag.toString('base64'),
                    originalFilename: media.filename,
                    mimeType: media.mimeType || 'application/octet-stream'
                }
            }
        });

        // Get the public URL or signed URL
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: '01-01-2100' // Long expiry for permanent access
        });

        return {
            path: encryptedFilename,
            url: url,
            originalFilename: media.filename,
            mimeType: media.mimeType,
            encryptedKey: encryptedKey.toString('base64'),
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64')
        };
    }

    static async get(filePath) {
        if (!filePath) {
            throw new Error("File path required");
        }

        const file = bucket.file(filePath);

        // Check if file exists
        const [exists] = await file.exists();
        if (!exists) {
            throw new Error("File not found");
        }

        // Get file data and metadata
        const [data] = await file.download();
        const [metadata] = await file.getMetadata();

        return {
            encryptedData: data.toString('base64'),
            encryptedKey: metadata.metadata?.encryptedKey,
            iv: metadata.metadata?.iv,
            authTag: metadata.metadata?.authTag,
            originalFilename: metadata.metadata?.originalFilename,
            mimeType: metadata.metadata?.mimeType
        };
    }

    static async getSignedUrl(filePath, expiresInMinutes = 60) {
        if (!filePath) {
            throw new Error("File path required");
        }

        const file = bucket.file(filePath);
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + expiresInMinutes * 60 * 1000
        });

        return url;
    }

    static async delete(filePath) {
        if (!filePath) {
            throw new Error("File path required");
        }

        const file = bucket.file(filePath);
        await file.delete();
    }
}