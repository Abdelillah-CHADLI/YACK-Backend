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

function getConfiguredCloudinary() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
        throw new MediaConfigurationError();
    }

    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
    });
    return cloudinary;
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

    return { filename, buffer, mimeType };
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

function cloudinaryClient(client) {
    return client || getConfiguredCloudinary();
}

export class MediaHandler {
    /**
     * Upload an image/video payload. Passing a client is intended for isolated tests.
     */
    static async send(media, client = null) {
        const validated = validateMediaPayload(media);
        const storage = cloudinaryClient(client);
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

    static getUrl(publicId, options = {}, client = null) {
        if (typeof publicId !== "string" || !publicId.trim()) {
            throw new MediaValidationError("Public ID required");
        }
        return cloudinaryClient(client).url(publicId.trim(), {
            fetch_format: "auto",
            quality: "auto",
            secure: true,
            ...options,
        });
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
