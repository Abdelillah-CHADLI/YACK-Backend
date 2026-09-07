import assert from "node:assert/strict";
import test from "node:test";
import {
    inferMediaMimeType,
    MAX_MEDIA_BYTES,
    MediaHandler,
    MediaValidationError,
    sanitizeMediaFilename,
    validateMediaPayload,
} from "../src/utils/mediaHandler.js";

test("media validation accepts the Flutter image-picker payload", () => {
    const payload = validateMediaPayload({
        filename: "camera-photo.JPG",
        buffer: Buffer.from("image bytes").toString("base64"),
    });

    assert.equal(payload.filename, "camera-photo.JPG");
    assert.equal(payload.mimeType, "image/jpeg");
});

test("media validation sanitizes paths and rejects malformed Base64", () => {
    assert.equal(sanitizeMediaFilename("../../proof.png"), "proof.png");
    assert.equal(sanitizeMediaFilename("..\\..\\proof.png"), "proof.png");
    assert.throws(
        () => validateMediaPayload({ filename: "proof.png", buffer: "%%%" }),
        MediaValidationError
    );
});

test("media validation enforces the same six-megabyte ceiling as Flutter", () => {
    const oversized = Buffer.alloc(MAX_MEDIA_BYTES + 1).toString("base64");
    assert.throws(
        () => validateMediaPayload({ filename: "video.mp4", buffer: oversized }),
        (error) => error instanceof MediaValidationError && error.statusCode === 413
    );
});

test("media MIME inference rejects unsupported attachments", () => {
    assert.equal(inferMediaMimeType("clip.mov"), "video/quicktime");
    assert.throws(() => inferMediaMimeType("archive.exe"), MediaValidationError);
});

test("media upload produces the response shape consumed by Flutter", async () => {
    let uploadedDataUri;
    const fakeCloudinary = {
        uploader: {
            upload: async (dataUri) => {
                uploadedDataUri = dataUri;
                return {
                    public_id: "yack-media/proof_123",
                    secure_url: "https://media.example/proof.png",
                    resource_type: "image",
                    format: "png",
                    bytes: 12,
                };
            },
        },
    };

    const result = await MediaHandler.send(
        {
            filename: "proof.png",
            buffer: Buffer.from("image bytes").toString("base64"),
        },
        fakeCloudinary
    );

    assert.match(uploadedDataUri, /^data:image\/png;base64,/);
    assert.equal(result.path, "yack-media/proof_123");
    assert.equal(result.url, "https://media.example/proof.png");
    assert.equal(result.originalFilename, "proof.png");
    assert.equal(result.mimeType, "image/png");
});

test("media lookup probes the Cloudinary resource types", async () => {
    const attempts = [];
    const fakeCloudinary = {
        api: {
            resource: async (publicId, { resource_type: resourceType }) => {
                attempts.push(resourceType);
                if (resourceType === "image") throw { http_code: 404 };
                return {
                    public_id: publicId,
                    secure_url: "https://media.example/video.mp4",
                    resource_type: resourceType,
                    bytes: 100,
                };
            },
        },
    };

    const result = await MediaHandler.get("yack-media/video_123", fakeCloudinary);
    assert.deepEqual(attempts, ["image", "video"]);
    assert.equal(result.resourceType, "video");
});
