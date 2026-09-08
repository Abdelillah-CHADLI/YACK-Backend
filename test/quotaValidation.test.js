import assert from "node:assert/strict";
import test from "node:test";

import {
    validateCiphertext,
    validateHash,
    timingSafeHexEqual,
} from "../src/utils/validation.js";
import {
    arrayBelowCap,
    MAX_MESSAGES_PER_CONTRACT,
    MAX_MEDIA_PER_CONTRACT,
    MAX_SUPPORT_MESSAGES_PER_THREAD,
    MAX_SUPPORT_ATTACHMENTS_PER_THREAD,
    MAX_SUPPORT_ATTACHMENT_BYTES,
    MAX_OPEN_TEMP_CONTRACTS_PER_USER,
    MAX_FINAL_CONTRACTS_PER_USER,
} from "../src/utils/quota.js";
import { parseLimit, parseOffset } from "../src/utils/pagination.js";
import AdminAuditLog from "../src/models/AdminAuditLog.js";

const CIPHERTEXT = Buffer.from("payload", "utf8").toString("base64");

test("validateCiphertext accepts canonical Base64 ciphertext bound by size", () => {
    assert.equal(validateCiphertext(CIPHERTEXT, "Title"), CIPHERTEXT);
    assert.throws(
        () => validateCiphertext("not base64", "Title"),
        (error) => error.code === "INVALID_CIPHERTEXT"
    );
    assert.throws(
        () => validateCiphertext(`${CIPHERTEXT}==`, "Title"),
        (error) => error.code === "INVALID_CIPHERTEXT"
    );
    assert.throws(
        () => validateCiphertext("", "Title"),
        (error) => error.code === "FIELD_REQUIRED"
    );
    assert.throws(
        () => validateCiphertext("x".repeat(17_000), "Title"),
        (error) => error.code === "FIELD_TOO_LARGE"
    );
});

test("validateHash enforces a SHA-256 hex shape", () => {
    assert.equal(validateHash("A".repeat(64)), "a".repeat(64));
    assert.throws(
        () => validateHash("short"),
        (error) => error.code === "INVALID_HASH"
    );
    assert.throws(
        () => validateHash("z".repeat(64)),
        (error) => error.code === "INVALID_HASH"
    );
});

test("timingSafeHexEqual compares normalized digests in constant time", () => {
    assert.equal(timingSafeHexEqual("ABC", "abc"), true);
    assert.equal(timingSafeHexEqual("a".repeat(64), "b".repeat(64)), false);
    // Different input lengths must not throw and must not short-circuit to true.
    assert.equal(timingSafeHexEqual("a", "a".repeat(64)), false);
    assert.equal(timingSafeHexEqual("", ""), true);
});

test("arrayBelowCap builds a $expr predicate usable inside an update filter", () => {
    const predicate = arrayBelowCap("messages", 5);
    assert.equal(predicate.$expr.$lt[0].$size.$ifNull[0], "$messages");
    assert.equal(predicate.$expr.$lt[1], 5);
});

test("arrayBelowCap treats a missing field as an empty array so caps apply before the first push", () => {
    const predicate = arrayBelowCap("attachments", 25);
    const nested = predicate.$expr.$lt[0].$size.$ifNull;
    assert.deepEqual(nested, ["$attachments", []]);
});

test("per-account and per-resource caps stay at their documented values", () => {
    assert.equal(MAX_MESSAGES_PER_CONTRACT, 500);
    assert.equal(MAX_MEDIA_PER_CONTRACT, 100);
    assert.equal(MAX_SUPPORT_MESSAGES_PER_THREAD, 250);
    assert.equal(MAX_SUPPORT_ATTACHMENTS_PER_THREAD, 25);
    assert.equal(MAX_SUPPORT_ATTACHMENT_BYTES, 6 * 1024 * 1024);
    assert.equal(MAX_OPEN_TEMP_CONTRACTS_PER_USER, 50);
    assert.equal(MAX_FINAL_CONTRACTS_PER_USER, 200);
});

test("parseLimit and parseOffset clamp page bounds", () => {
    assert.equal(parseLimit(undefined), 100);
    assert.equal(parseLimit("10"), 10);
    assert.equal(parseLimit("500"), 100);
    assert.equal(parseLimit("-3"), 100);
    assert.equal(parseLimit("abc"), 100);
    assert.equal(parseOffset("0"), 0);
    assert.equal(parseOffset("20"), 20);
    assert.equal(parseOffset("-1"), 0);
    assert.equal(parseOffset(undefined), 0);
});

test("admin audit log schema enforces its action vocabulary", () => {
    const actions = AdminAuditLog.schema.path("action").enumValues;
    assert.deepEqual(
        [...actions].sort(),
        ["dispute.resolved", "dispute.viewed", "review.access.viewed", "support.message.sent"]
    );
    const record = new AdminAuditLog({ actorId: "uid-1", action: "dispute.viewed" });
    assert.equal(record.actorId, "uid-1");
    assert.equal(AdminAuditLog.schema.get("timestamps").createdAt, true);
});