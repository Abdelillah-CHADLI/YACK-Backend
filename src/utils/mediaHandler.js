import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { CryptoHandler } from "./cryptoHandler.js";

// Get directory name in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use environment variable or fallback to a path relative to project root
const MEDIA_ROOT = process.env.UPLOAD_DIR || path.resolve(__dirname, "../../uploads");

export class MediaHandler {

    static async ensureUploadDir() {
        try {
            await fs.mkdir(MEDIA_ROOT, { recursive: true });
        } catch (err) {
            if (err.code !== 'EEXIST') {
                console.error(`Failed to create upload directory: ${MEDIA_ROOT}`, err);
                throw new Error(`Cannot create upload directory: ${err.message}`);
            }
        }
    }

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
        const encryptedFilename = `${baseName}_${timestamp}_${randomStr}${ext}.enc`;

        // Ensure upload directory exists
        await this.ensureUploadDir();
        const filePath = path.join(MEDIA_ROOT, encryptedFilename);

        // Store encrypted file
        await fs.writeFile(filePath, encryptedData);

        // Store metadata separately (encrypted key, iv, authTag)
        const metadataPath = `${filePath}.meta`;
        const metadata = {
            encryptedKey: encryptedKey.toString('base64'),
            iv: iv.toString('base64'),
            authTag: authTag.toString('base64'),
            originalFilename: media.filename,
            mimeType: media.mimeType || 'application/octet-stream'
        };
        await fs.writeFile(metadataPath, JSON.stringify(metadata));

        return {
            path: filePath,
            originalFilename: media.filename,
            mimeType: media.mimeType,
            encryptedKey: metadata.encryptedKey,
            iv: metadata.iv,
            authTag: metadata.authTag
        };
    }

    static async get(mediaPath) {
        if (!mediaPath) {
            throw new Error("Media path required");
        }

        const encryptedData = await fs.readFile(mediaPath);
        const metadataPath = `${mediaPath}.meta`;

        let metadata = {};
        try {
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
        } catch (err) {
            console.error(`Failed to read metadata for ${mediaPath}:`, err);
        }

        return {
            encryptedData: encryptedData.toString('base64'),
            ...metadata
        };
    }

    static async decrypt(mediaPath, privateKeyPEM) {
        if (!mediaPath || !privateKeyPEM) {
            throw new Error("Media path and private key required");
        }

        const encryptedData = await fs.readFile(mediaPath);
        const metadataPath = `${mediaPath}.meta`;
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataContent);

        const encryptedKey = Buffer.from(metadata.encryptedKey, 'base64');
        const iv = Buffer.from(metadata.iv, 'base64');
        const authTag = Buffer.from(metadata.authTag, 'base64');

        return CryptoHandler.decryptMedia(
            encryptedData,
            encryptedKey,
            iv,
            authTag,
            privateKeyPEM
        );
    }
}