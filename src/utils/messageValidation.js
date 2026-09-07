export const MAX_ENCRYPTED_MESSAGE_LENGTH = 4096;

function requireString(value, field, maxLength) {
    if (typeof value !== "string" || !value.trim()) {
        throw new TypeError(`${field} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
        throw new RangeError(`${field} is too large`);
    }
    return normalized;
}

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

export function validateEncryptedMessage(body = {}) {
    const contentForSender = requireString(
        body.contentForSender,
        "Encrypted content for sender",
        MAX_ENCRYPTED_MESSAGE_LENGTH
    );
    const contentForRecipient = requireString(
        body.contentForRecipient,
        "Encrypted content for recipient",
        MAX_ENCRYPTED_MESSAGE_LENGTH
    );
    const contentHash = requireString(body.contentHash, "Content hash", 64);

    if (!isCanonicalBase64(contentForSender)) {
        throw new TypeError("Encrypted content for sender must be valid Base64");
    }
    if (!isCanonicalBase64(contentForRecipient)) {
        throw new TypeError("Encrypted content for recipient must be valid Base64");
    }
    if (!/^[a-fA-F0-9]{64}$/.test(contentHash)) {
        throw new TypeError("Content hash must be a SHA-256 hex digest");
    }

    return {
        contentForSender,
        contentForRecipient,
        contentHash: contentHash.toLowerCase(),
    };
}

export function parseMessageLimit(value, fallback = 50) {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new TypeError("limit must be a positive integer");
    }
    return Math.min(parsed, 100);
}
