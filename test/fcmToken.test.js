import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFcmToken } from "../src/utils/fcmToken.js";

test("FCM token normalization trims valid tokens", () => {
    const token = "device-token-value-that-is-long-enough:abc123";
    assert.equal(normalizeFcmToken(`  ${token}  `), token);
});

test("FCM token normalization rejects unsafe values", () => {
    assert.equal(normalizeFcmToken(null), null);
    assert.equal(normalizeFcmToken("short"), null);
    assert.equal(normalizeFcmToken("contains whitespace in token"), null);
    assert.equal(normalizeFcmToken("x".repeat(4097)), null);
});
