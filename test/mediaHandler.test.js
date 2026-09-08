import assert from "node:assert/strict";
import test from "node:test";
import {
    inferMediaMimeType,
    MAX_MEDIA_BYTES,
    MediaHandler,
    MediaValidationError,
    mediaEnvelopeOf,
    sanitizeMediaFilename,
    validateEncryptedMediaPayload,
    validateMediaPayload,
} from "../src/utils/mediaHandler.js";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("media validation accepts the Flutter image-picker payload", () => {
    const payload = validateMediaPayload({
        filename: "camera-photo.JPG",
        buffer: JPEG_BYTES.toString("base64"),
    });

    assert.equal(payload.filename, "camera-photo.JPG");
    assert.equal(payload.mimeType, "image/jpeg");
});

test("media validation rejects content that does not match its declared type", () => {
    assert.throws(
        () => validateMediaPayload({
            filename: "proof.png",
            buffer: JPEG_BYTES.toString("base64"),
        }),
        (error) =>
            error instanceof MediaValidationError &&
            /does not match/.test(error.message)
    );
    assert.throws(
        () => validateMediaPayload({
            filename: "notes.txt",
            buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString("base64"),
        }),
        MediaValidationError
    );
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
            buffer: Buffer.concat([PNG_MAGIC, Buffer.from("image bytes")]).toString("base64"),
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

// F-05: encrypted-media helpers --------------------------------------------

const IV_BASE64 = Buffer.from("AAAAAAAAAAAAg7QF/DYwJw").slice(0, 12).toString("base64");
const WRAP_BASE64 = Buffer.alloc(256, 7).toString("base64");

function encryptedPayload(overrides = {}) {
    return {
        filename: "proof.png",
        buffer: Buffer.from("ciphertext-bytes-not-magic").toString("base64"),
        mimeType: "image/png",
        iv: IV_BASE64,
        contentHash: "a".repeat(64),
        keyOwner: WRAP_BASE64,
        keyParticipant: WRAP_BASE64,
        keyAdmin: WRAP_BASE64,
        ...overrides,
    };
}

test("encrypted payload validation skips magic sniffing but keeps the allowlist", () => {
    // The bytes are opaque AES-GCM ciphertext, so no magic bytes are present.
    const payload = validateEncryptedMediaPayload(encryptedPayload());
    assert.equal(payload.mimeType, "image/png");
    assert.equal(payload.iv, IV_BASE64);
    assert.equal(payload.contentHash, "a".repeat(64));

    // The MIME allowlist still applies to the declared type.
    assert.throws(
        () => validateEncryptedMediaPayload(encryptedPayload({ filename: "archive.exe" })),
        MediaValidationError
    );
});

test("encrypted payload validation rejects a junk envelope", () => {
    assert.throws(
        () => validateEncryptedMediaPayload(encryptedPayload({ iv: "%%%" })),
        MediaValidationError
    );
    assert.throws(
        () => validateEncryptedMediaPayload(encryptedPayload({ contentHash: "xyz" })),
        MediaValidationError
    );
    assert.throws(
        () => validateEncryptedMediaPayload(encryptedPayload({ keyOwner: undefined })),
        MediaValidationError
    );
    assert.throws(
        () => validateEncryptedMediaPayload(encryptedPayload({ keyParticipant: "%%%" })),
        MediaValidationError
    );
});

test("support attachments may omit the participant envelope", () => {
    const { keyParticipant, ...rest } = encryptedPayload();
    const payload = validateEncryptedMediaPayload(rest, { requireKeyParticipant: false });
    assert.equal(payload.keyParticipant, "");
});

test("encrypted upload forces a raw Cloudinary resource and preserves the envelope", async () => {
    let uploadedResourceType;
    const fakeCloudinary = {
        uploader: {
            upload: async (dataUri, { resource_type: resourceType }) => {
                uploadedResourceType = resourceType;
                return {
                    public_id: "yack-media/proof_123",
                    secure_url: "https://media.example/proof.dat",
                    resource_type: resourceType,
                    format: "dat",
                    bytes: 42,
                };
            },
        },
    };

    const result = await MediaHandler.send(encryptedPayload(), fakeCloudinary, { encrypted: true });

    assert.equal(uploadedResourceType, "raw");
    assert.equal(result.encryptionVersion, 1);
    assert.equal(result.encryption, "AES-256-GCM");
    assert.equal(result.iv, IV_BASE64);
    assert.equal(result.contentHash, "a".repeat(64));
    assert.equal(result.keyOwner, WRAP_BASE64);
    assert.equal(result.keyParticipant, WRAP_BASE64);
    assert.equal(result.keyAdmin, WRAP_BASE64);
});

test("legacy media records normalize to encryptionVersion 0", () => {
    assert.deepEqual(mediaEnvelopeOf({}), {
        encryptionVersion: 0,
        iv: "",
        contentHash: "",
        keyOwner: "",
        keyParticipant: "",
        keyAdmin: "",
    });
    const envelope = mediaEnvelopeOf({
        encryptionVersion: 1,
        iv: IV_BASE64,
        contentHash: "b".repeat(64),
        keyOwner: WRAP_BASE64,
    });
    assert.equal(envelope.encryptionVersion, 1);
    assert.equal(envelope.keyParticipant, "");
});
