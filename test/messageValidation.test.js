import assert from "node:assert/strict";
import test from "node:test";
import {
    parseMessageLimit,
    validateEncryptedMessage,
} from "../src/utils/messageValidation.js";

const encrypted = Buffer.alloc(256, 7).toString("base64");
const digest = "a".repeat(64);

test("encrypted message validation accepts the Flutter RSA payload", () => {
    assert.deepEqual(
        validateEncryptedMessage({
            contentForSender: encrypted,
            contentForRecipient: encrypted,
            contentHash: digest,
        }),
        {
            contentForSender: encrypted,
            contentForRecipient: encrypted,
            contentHash: digest,
        }
    );
});

test("encrypted message validation rejects malformed ciphertext and digest", () => {
    assert.throws(
        () => validateEncryptedMessage({
            contentForSender: "not base64",
            contentForRecipient: encrypted,
            contentHash: digest,
        }),
        /valid canonical Base64/
    );
    assert.throws(
        () => validateEncryptedMessage({
            contentForSender: encrypted,
            contentForRecipient: encrypted,
            contentHash: "short",
        }),
        /SHA-256/
    );
});

test("message limit is bounded and invalid values are rejected", () => {
    assert.equal(parseMessageLimit(undefined), 50);
    assert.equal(parseMessageLimit("10"), 10);
    assert.equal(parseMessageLimit("500"), 100);
    assert.throws(() => parseMessageLimit("0"), /positive integer/);
    assert.throws(() => parseMessageLimit("1.5"), /positive integer/);
});
