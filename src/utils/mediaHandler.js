import crypto from "crypto";
import path from "path";
import { v2 as cloudinary } from "cloudinary";

// Cloudinary configuration. Credentials must be provided via environment
// variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    throw new Error(
        "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and " +
        "CLOUDINARY_API_SECRET in your environment (or .env file)."
    );
}

cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
});

export class MediaHandler {

    static async send(media) {
        if (!media || !media.buffer || !media.filename) {
            throw new Error("Invalid media payload");
        }

        // Create unique public_id to avoid collisions
        const timestamp = Date.now();
        const randomStr = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(media.filename);
        const baseName = path.basename(media.filename, ext);
        const publicId = `media/${baseName}_${timestamp}_${randomStr}`;

        // Convert base64 buffer to data URI for upload
        const mimeType = media.mimeType || 'application/octet-stream';
        const dataUri = `data:${mimeType};base64,${media.buffer}`;

        // Upload to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(dataUri, {
            public_id: publicId,
            resource_type: 'auto',
            folder: 'yack-media'
        });

        return {
            path: uploadResult.public_id,
            url: uploadResult.secure_url,
            originalFilename: media.filename,
            mimeType: mimeType,
            cloudinaryId: uploadResult.public_id,
            format: uploadResult.format,
            size: uploadResult.bytes
        };
    }

    static async get(publicId) {
        if (!publicId) {
            throw new Error("Public ID required");
        }

        // Get resource details from Cloudinary
        const result = await cloudinary.api.resource(publicId, {
            resource_type: 'auto'
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            size: result.bytes,
            createdAt: result.created_at
        };
    }

    static getUrl(publicId, options = {}) {
        if (!publicId) {
            throw new Error("Public ID required");
        }

        // Generate optimized URL
        return cloudinary.url(publicId, {
            fetch_format: 'auto',
            quality: 'auto',
            ...options
        });
    }

    static async delete(publicId) {
        if (!publicId) {
            throw new Error("Public ID required");
        }

        await cloudinary.uploader.destroy(publicId, {
            resource_type: 'auto'
        });
    }
}