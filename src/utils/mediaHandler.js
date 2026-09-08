import crypto from "crypto";
import path from "path";
import { v2 as cloudinary } from "cloudinary";

export const MAX_MEDIA_BYTES = 6 * 1024 * 1024;

const MIME_BY_EXTENSION = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
    [".webp", "image/webp"],
    [".heic", "image/heic"],
    [".heif", "image/heif"],
    [".bmp", "image/bmp"],
    [".mp4", "video/mp4"],
    [".mov", "video/quicktime"],
    [".m4v", "video/x-m4v"],
    [".webm", "video/webm"],
    [".3gp", "video/3gpp"],
    [".pdf", "application/pdf"],
    [".doc", "application/msword"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    [".xls", "application/vnd.ms-excel"],
    [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    [".txt", "text/plain"],
    [".csv", "text/csv"],
]);

export class MediaValidationError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = "MediaValidationError";
        this.statusCode = statusCode;
    }
}

export class MediaConfigurationError extends Error {
    constructor() {
        super(
            "Media storage is not configured. Set CLOUDINARY_CLOUD_NAME, " +
            "CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET."
        );
        this.name = "MediaConfigurationError";
        this.statusCode = 503;
    }
}

export function resolveCloudinaryConfig(env = process.env) {
    const cloudName = env.CLOUDINARY_CLOUD_NAME;
    const apiKey = env.CLOUDINARY_API_KEY;
    const apiSecret = env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) return null;
    return { cloudName, apiKey, apiSecret };
}

function getConfiguredCloudinary() {
    const config = resolveCloudinaryConfig();
    if (!config) {
        throw new MediaConfigurationError();
    }

    cloudinary.config({
        cloud_name: config.cloudName,
        api_key: config.apiKey,
        api_secret: config.apiSecret,
    });
    return cloudinary;
}

function cloudinaryClient(client) {
    return client || getConfiguredCloudinary();
}

/**
 * Boot-time connectivity check (F-69): validates the configured Cloudinary
 * credentials. The assumption is validated at import/startup rather than
 * failing lazily on the first media upload.
 */
export async function pingCloudinary(client = null) {
    const storage = cloudinaryClient(client);
    const result = await storage.api.ping();
    if (result?.status !== "ok") {
        throw new Error("Unexpected Cloudinary ping response");
    }
    return result;
}

/**
 * F-42: content sniffing against declared MIME type (magic bytes).
 *
 * A client can declare any MIME type; the extension map only validates the
 * filename extension. This check verifies the actual leading bytes match the
 * type the server will serve, so a malicious "image/png" upload that is
 * actually an HTML document or script cannot masquerade in the media feed.
 */
function isFtypContainer(buffer) {
    if (buffer.length < 12) return false;
    const box = buffer.readUInt32BE(0);
    // ISO BMFF 'ftyp' box at offset 0.
    if (box + 4 <= buffer.length && buffer.toString("latin1", 4, 8) === "ftyp") {
        return true;
    }
    return false;
}

function verifyMagicBytes(buffer, mimeType) {
    const isFtyp = isFtypContainer(buffer);
    switch (mimeType) {
        case "image/jpeg":
            return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
        case "image/png":
            return buffer.length >= 8 &&
                buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e &&
                buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a &&
                buffer[6] === 0x1a && buffer[7] === 0x0a;
        case "image/gif":
            return buffer.length >= 6 &&
                (buffer.toString("latin1", 0, 6) === "GIF87a" ||
                    buffer.toString("latin1", 0, 6) === "GIF89a");
        case "image/webp":
            return buffer.length >= 12 &&
                buffer.toString("latin1", 0, 4) === "RIFF" &&
                buffer.toString("latin1", 8, 12) === "WEBP";
        case "image/bmp":
            return buffer.length >= 2 &&
                buffer[0] === 0x42 && buffer[1] === 0x4d; // "BM"
        case "application/pdf":
            return buffer.length >= 5 && buffer.toString("latin1", 0, 5) === "%PDF-";
        case "application/msword":
        case "application/vnd.ms-excel":
            // OLE2 (legacy .doc/.xls) or an OFC zip container.
            return (buffer.length >= 8 &&
                buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 &&
                buffer[3] === 0xe0 && buffer[4] === 0xa1 && buffer[5] === 0xb1 &&
                buffer[6] === 0x1a && buffer[7] === 0xe1) ||
                (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
                    (buffer[2] === 0x03 || buffer[2] === 0x05) && buffer[3] === 0x04);
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
            return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b &&
                (buffer[2] === 0x03 || buffer[2] === 0x05) && buffer[3] === 0x04; // zip
        case "video/mp4":
        case "video/quicktime":
        case "video/x-m4v":
        case "video/3gpp":
        case "image/heic":
        case "image/heif":
            // ISO BMFF family (mp4, mov, m4v, 3gp, heic): 'ftyp' at offset 4.
            return isFtyp;
        case "video/webm":
            return buffer.length >= 4 &&
                buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3; // EBML
        case "text/plain":
        case "text/csv":
            // Text: reject NUL bytes and heavy control-character content.
            if (!buffer.length) return false;
            let controlBytes = 0;
            for (let index = 0; index < buffer.length; index += 1) {
                const byte = buffer[index];
                if (byte === 0) return false;
                if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controlBytes += 1;
            }
            return controlBytes <= buffer.length * 0.2;
        default:
            return true; // no supported signature, do not block unknown types
    }
}

function normalizeBase64(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new MediaValidationError("Media data is required");
    }

    const normalized = value.trim();
    const maxEncodedLength = Math.ceil(MAX_MEDIA_BYTES / 3) * 4;
    if (normalized.length > maxEncodedLength) {
        throw new MediaValidationError(
            `Media must be ${MAX_MEDIA_BYTES / 1024 / 1024} MB or smaller`,
            413
        );
    }

    if (
        normalized.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
        throw new MediaValidationError("Media data must be valid Base64");
    }

    const bytes = Buffer.from(normalized, "base64");
    const canonicalInput = normalized.replace(/=+$/, "");
    const canonicalDecoded = bytes.toString("base64").replace(/=+$/, "");
    if (!bytes.length || canonicalInput !== canonicalDecoded) {
        throw new MediaValidationError("Media data must be valid Base64");
    }
    if (bytes.length > MAX_MEDIA_BYTES) {
        throw new MediaValidationError(
            `Media must be ${MAX_MEDIA_BYTES / 1024 / 1024} MB or smaller`,
            413
        );
    }

    return normalized;
}

export function sanitizeMediaFilename(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new MediaValidationError("Media filename is required");
    }

    const filename = path.posix.basename(value.trim().replace(/\\/g, "/"))
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 180);
    if (!filename || filename === "." || filename === "..") {
        throw new MediaValidationError("Media filename is invalid");
    }
    return filename;
}

export function inferMediaMimeType(filename, suppliedMimeType) {
    const supplied = typeof suppliedMimeType === "string"
        ? suppliedMimeType.trim().toLowerCase()
        : "";

    const inferred = MIME_BY_EXTENSION.get(path.extname(filename).toLowerCase());
    if (!inferred) {
        throw new MediaValidationError(
            "Unsupported media type. Upload a supported image or video."
        );
    }
    if (supplied && !/^(image|video|application|text)\/[a-z0-9.+-]+$/.test(supplied)) {
        throw new MediaValidationError("Media MIME type is invalid");
    }
    return inferred;
}

export function validateMediaPayload(media) {
    if (!media || typeof media !== "object" || Array.isArray(media)) {
        throw new MediaValidationError("Media payload required");
    }

    const filename = sanitizeMediaFilename(media.filename);
    const buffer = normalizeBase64(media.buffer);
    const mimeType = inferMediaMimeType(filename, media.mimeType);

    if (!verifyMagicBytes(Buffer.from(buffer, "base64"), mimeType)) {
        throw new MediaValidationError(
            "Media content does not match its declared type"
        );
    }

    return { filename, buffer, mimeType };
}

// F-05: an AES-GCM nonce encoded as canonical Base64 (12 bytes).
function validateMediaIv(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new MediaValidationError("Encryption IV is required for encrypted media");
    }
    const normalized = value.trim();
    if (
        normalized.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
        throw new MediaValidationError("Encryption IV must be valid Base64");
    }
    const bytes = Buffer.from(normalized, "base64");
    const canonicalInput = normalized.replace(/=+$/, "");
    const canonicalDecoded = bytes.toString("base64").replace(/=+$/, "");
    if (!bytes.length || canonicalInput !== canonicalDecoded) {
        throw new MediaValidationError("Encryption IV must be valid Base64");
    }
    if (bytes.length !== 12) {
        throw new MediaValidationError("Encryption IV must be 96 bits");
    }
    return normalized;
}

// F-05: an RSA-OAEP-SHA256 key-wrap envelope encoded as canonical Base64.
function validateEnvelopeKey(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new MediaValidationError(`${label} is required for encrypted media`);
    }
    const normalized = value.trim();
    if (
        normalized.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
    ) {
        throw new MediaValidationError(`${label} must be valid Base64`);
    }
    const bytes = Buffer.from(normalized, "base64");
    const canonicalInput = normalized.replace(/=+$/, "");
    const canonicalDecoded = bytes.toString("base64").replace(/=+$/, "");
    if (!bytes.length || canonicalInput !== canonicalDecoded) {
        throw new MediaValidationError(`${label} must be valid Base64`);
    }
    if (bytes.length < 128 || bytes.length > 512) {
        throw new MediaValidationError(`${label} has an invalid size`);
    }
    return normalized;
}

// F-05: SHA-256 hex digest (lowercase) of the plaintext media bytes.
function validateContentHash(value) {
    if (typeof value !== "string" || !value.trim()) {
        throw new MediaValidationError("Content hash is required for encrypted media");
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new MediaValidationError("Content hash must be a SHA-256 hex digest");
    }
    return normalized;
}

/**
 * F-05: validate a client-side encrypted media payload. Unlike plaintext
 * uploads the bytes are AES-256-GCM ciphertext, so magic-byte sniffing is
 * intentionally skipped (the server never sees the plaintext). The MIME
 * allowlist and size cap still apply, and the key-wrap envelope must be
 * present and canonical.
 */
export function validateEncryptedMediaPayload(media, { requireKeyParticipant = true } = {}) {
    if (!media || typeof media !== "object" || Array.isArray(media)) {
        throw new MediaValidationError("Media payload required");
    }

    const filename = sanitizeMediaFilename(media.filename);
    const buffer = normalizeBase64(media.buffer);
    const mimeType = inferMediaMimeType(filename, media.mimeType);
    const iv = validateMediaIv(media.iv);
    const contentHash = validateContentHash(media.contentHash);
    const keyOwner = validateEnvelopeKey(media.keyOwner, "Key envelope for uploader");
    const keyAdmin = validateEnvelopeKey(media.keyAdmin, "Key envelope for admin");
    const keyParticipant = media.keyParticipant
        ? validateEnvelopeKey(media.keyParticipant, "Key envelope for participant")
        : "";
    if (requireKeyParticipant && !keyParticipant) {
        throw new MediaValidationError(
            "Key envelope for participant is required for encrypted media"
        );
    }

    return {
        filename,
        buffer,
        mimeType,
        iv,
        contentHash,
        keyOwner,
        keyParticipant,
        keyAdmin,
    };
}

/**
 * F-05: surface the encryption envelope of a stored media entry to clients.
 * Legacy plaintext records (which predate F-05) normalize to encryptionVersion
 * 0 so callers can branch without tripping over absent fields.
 */
export function mediaEnvelopeOf(entry) {
    if (!entry?.encryptionVersion) {
        return {
            encryptionVersion: 0,
            iv: "",
            contentHash: "",
            keyOwner: "",
            keyParticipant: "",
            keyAdmin: "",
        };
    }
    return {
        encryptionVersion: entry.encryptionVersion,
        iv: entry.iv || "",
        contentHash: entry.contentHash || "",
        keyOwner: entry.keyOwner || "",
        keyParticipant: entry.keyParticipant || "",
        keyAdmin: entry.keyAdmin || "",
    };
}

function makePublicId(filename) {
    const extension = path.extname(filename);
    const stem = path.basename(filename, extension)
        .normalize("NFKD")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "attachment";
    return `${stem}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

export class MediaHandler {
    /**
     * Upload an image/video payload. Passing a client is intended for isolated tests.
     * With `{ encrypted: true }` (F-05) the payload is AES-256-GCM ciphertext:
     * magic-byte sniffing is skipped, the envelope is validated, and the blob
     * is stored as a raw Cloudinary resource so it is never transformed or
     * sniffed into plaintext.
     */
    static async send(media, client = null, options = {}) {
        const validated = options.encrypted
            ? validateEncryptedMediaPayload(media, options)
            : validateMediaPayload(media);
        const storage = cloudinaryClient(client);

        if (options.encrypted) {
            // Ciphertext is opaque bytes; a raw resource guarantees the stored
            // object is byte-for-byte what the client uploaded.
            const dataUri = `data:${validated.mimeType};base64,${validated.buffer}`;
            const uploadResult = await storage.uploader.upload(dataUri, {
                public_id: makePublicId(validated.filename),
                resource_type: "raw",
                folder: "yack-media",
            });

            if (!uploadResult?.public_id || !uploadResult?.secure_url) {
                throw new Error("Media storage returned an invalid upload response");
            }

            return {
                path: uploadResult.public_id,
                url: uploadResult.secure_url,
                originalFilename: validated.filename,
                mimeType: validated.mimeType,
                cloudinaryId: uploadResult.public_id,
                resourceType: uploadResult.resource_type,
                format: uploadResult.format,
                size: uploadResult.bytes,
                encryptionVersion: 1,
                encryption: "AES-256-GCM",
                iv: validated.iv,
                contentHash: validated.contentHash,
                keyOwner: validated.keyOwner,
                keyParticipant: validated.keyParticipant,
                keyAdmin: validated.keyAdmin,
            };
        }

        const dataUri = `data:${validated.mimeType};base64,${validated.buffer}`;
        const resourceType = validated.mimeType.startsWith("image/")
            ? "image"
            : validated.mimeType.startsWith("video/")
                ? "video"
                : "raw";

        const uploadResult = await storage.uploader.upload(dataUri, {
            public_id: makePublicId(validated.filename),
            resource_type: resourceType,
            folder: "yack-media",
        });

        if (!uploadResult?.public_id || !uploadResult?.secure_url) {
            throw new Error("Media storage returned an invalid upload response");
        }

        return {
            path: uploadResult.public_id,
            url: uploadResult.secure_url,
            originalFilename: validated.filename,
            mimeType: validated.mimeType,
            cloudinaryId: uploadResult.public_id,
            resourceType: uploadResult.resource_type,
            format: uploadResult.format,
            size: uploadResult.bytes,
        };
    }

    static async get(publicId, client = null) {
        if (typeof publicId !== "string" || !publicId.trim()) {
            throw new MediaValidationError("Public ID required");
        }

        const storage = cloudinaryClient(client);
        let lastError;
        for (const resourceType of ["image", "video", "raw"]) {
            try {
                const result = await storage.api.resource(publicId.trim(), {
                    resource_type: resourceType,
                });
                return {
                    url: result.secure_url,
                    publicId: result.public_id,
                    resourceType: result.resource_type || resourceType,
                    format: result.format,
                    size: result.bytes,
                    createdAt: result.created_at,
                };
            } catch (error) {
                lastError = error;
                if (error?.http_code && error.http_code !== 404) throw error;
            }
        }
        throw lastError || new Error("Media not found in storage");
    }

    static async delete(publicId, client = null) {
        if (typeof publicId !== "string" || !publicId.trim()) {
            throw new MediaValidationError("Public ID required");
        }

        const storage = cloudinaryClient(client);
        for (const resourceType of ["image", "video", "raw"]) {
            try {
                const result = await storage.uploader.destroy(publicId.trim(), {
                    resource_type: resourceType,
                });
                if (result?.result === "ok") return true;
            } catch (error) {
                if (error?.http_code && error.http_code !== 404) throw error;
            }
        }
        return false;
    }
}
