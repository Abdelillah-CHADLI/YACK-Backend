// src/utils/validation.js
//
// Shared ciphertext / hash validators (F-41) and constant-time comparison
// (F-40). Request paths across contract, join, review-access, message and
// support controllers use these so the "what is an encrypted field" rule stops
// drifting between files.

import crypto from "crypto";

export const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

function isCanonicalBase64(value) {
    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
        return false;
    }
    try {
        return Buffer.from(value, "base64").toString("base64") === value;
    } catch {
        return false;
    }
}

export function validateCiphertext(value, label, { maxLength = 16_384 } = {}) {
    if (typeof value !== "string" || !value.trim()) {
        const error = new TypeError(`${label} is required`);
        error.code = "FIELD_REQUIRED";
        throw error;
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
        const error = new RangeError(`${label} is too large`);
        error.code = "FIELD_TOO_LARGE";
        throw error;
    }
    if (!isCanonicalBase64(normalized)) {
        const error = new TypeError(`${label} must be valid canonical Base64 ciphertext`);
        error.code = "INVALID_CIPHERTEXT";
        throw error;
    }
    return normalized;
}

export function validateHash(value, { label = "Hash" } = {}) {
    const hash = String(value ?? "").trim().toLowerCase();
    if (!SHA256_HEX_PATTERN.test(hash)) {
        const error = new TypeError(`${label} must be a SHA-256 hex digest`);
        error.code = "INVALID_HASH";
        throw error;
    }
    return hash;
}

/**
 * Constant-time hex comparison. Digest hashes first so both sides are always
 * compared over fixed-length buffers (F-40).
 */
export function timingSafeHexEqual(a, b) {
    const left = typeof a === "string" ? a.trim().toLowerCase() : "";
    const right = typeof b === "string" ? b.trim().toLowerCase() : "";
    const leftDigest = crypto.createHash("sha256").update(left).digest();
    const rightDigest = crypto.createHash("sha256").update(right).digest();
    return crypto.timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Validate an optional contract/join hash: bound length, trim and lowercase
 * exactly like the object-store paths so create and verify agree (F-40).
 */
export function validateOptionalHash(value, { maxLength = 512, label = "Contract hash" } = {}) {
    if (value == null || value === "") return "";
    if (typeof value !== "string" || !value.trim()) {
        throw new TypeError(`${label} is required`);
    }
    const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
    if (normalized.length > maxLength) {
        throw new RangeError(`${label} is too long`);
    }
    // Join hashes are an additional integrity token (not a digest shape), so
    // they are length-capped but not forced into the hex64 shape.
    return normalized;
}