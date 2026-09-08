import test from "node:test";
import assert from "node:assert/strict";

import { logger, redact, requestContext } from "../src/utils/logger.js";

test("redact masks secret fields recursively and keeps safe data", () => {
    const safe = redact({
        authorization: "Bearer secret-token",
        user: { fcmToken: "tok", publicKey: "abc", name: "Ali" },
        details: { iv: "ivv", salt: "salt-v" },
        safe: { contractId: "c1" },
    });
    assert.equal(safe.authorization, "[REDACTED]");
    assert.equal(safe.user.fcmToken, "[REDACTED]");
    assert.equal(safe.user.publicKey, "[REDACTED]");
    assert.equal(safe.user.name, "Ali");
    assert.equal(safe.details, "[REDACTED]");
    assert.equal(safe.safe.contractId, "c1");
});

test("redact masks secret fields nested inside arrays", () => {
    const safe = redact({
        items: [{ secret: "s1", name: "a" }, { iv: "i" }],
    });
    assert.equal(safe.items[0].secret, "[REDACTED]");
    assert.equal(safe.items[0].name, "a");
    assert.equal(safe.items[1].iv, "[REDACTED]");
});

test("requestContext carries method path status rid and resolved uid", () => {
    const ctx = requestContext({
        method: "GET",
        originalUrl: "/contracts",
        res: { statusCode: 200 },
        rid: "r-1",
        firebaseUser: { uid: "uid-1" },
    });
    assert.equal(ctx.method, "GET");
    assert.equal(ctx.path, "/contracts");
    assert.equal(ctx.status, 200);
    assert.equal(ctx.rid, "r-1");
    assert.equal(ctx.uid, "uid-1");
});

test("logger.write emits one-line JSON for warn and error levels", () => {
    const lines = [];
    const original = { warn: console.warn, error: console.error };
    console.warn = (line) => lines.push(["warn", line]);
    console.error = (line) => lines.push(["error", line]);
    try {
        logger.warn("w", { safe: 1 });
        logger.error("e", { password: "p" });
    } finally {
        console.warn = original.warn;
        console.error = original.error;
    }
    assert.equal(lines.length, 2);
    for (const [level, line] of lines) {
        const entry = JSON.parse(line);
        assert.equal(entry.level, level);
    }
    assert.equal(JSON.parse(lines[1][1]).password, "[REDACTED]");
});