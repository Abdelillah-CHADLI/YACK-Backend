import { validateCiphertext, validateHash } from "./validation.js";

export const MAX_ENCRYPTED_MESSAGE_LENGTH = 4096;

export function validateEncryptedMessage(body = {}) {
    const contentForSender = validateCiphertext(body.contentForSender, "Encrypted content for sender", {
        maxLength: MAX_ENCRYPTED_MESSAGE_LENGTH,
    });
    const contentForRecipient = validateCiphertext(body.contentForRecipient, "Encrypted content for recipient", {
        maxLength: MAX_ENCRYPTED_MESSAGE_LENGTH,
    });
    const contentHash = validateHash(body.contentHash, { label: "Content hash" });

    return { contentForSender, contentForRecipient, contentHash };
}

export function parseMessageLimit(value, fallback = 50) {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new TypeError("limit must be a positive integer");
    }
    return Math.min(parsed, 100);
}