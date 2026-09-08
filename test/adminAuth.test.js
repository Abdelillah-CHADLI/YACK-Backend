import assert from "node:assert/strict";
import test from "node:test";

import adminAuth from "../src/middleware/adminAuth.js";

function responseRecorder() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        },
    };
}

test("admin middleware accepts a verified allowlisted account", () => {
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "admin@example.com, second@example.com";
    try {
        const req = {
            emailVerified: true,
            firebaseUser: { uid: "firebase-admin", email: "ADMIN@example.com" },
        };
        const res = responseRecorder();
        let called = false;
        adminAuth(req, res, () => { called = true; });
        assert.equal(called, true);
        assert.deepEqual(req.adminIdentity, {
            uid: "firebase-admin",
            email: "admin@example.com",
        });
    } finally {
        if (previous === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = previous;
    }
});

test("admin middleware rejects ordinary and unverified accounts", () => {
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "admin@example.com";
    try {
        for (const req of [
            {
                emailVerified: true,
                firebaseUser: { uid: "user", email: "user@example.com" },
            },
            {
                emailVerified: false,
                firebaseUser: { uid: "admin", email: "admin@example.com" },
            },
        ]) {
            const res = responseRecorder();
            let called = false;
            adminAuth(req, res, () => { called = true; });
            assert.equal(called, false);
            assert.equal(res.statusCode, 403);
            assert.equal(res.payload.code, "ADMIN_REQUIRED");
        }
    } finally {
        if (previous === undefined) delete process.env.ADMIN_EMAILS;
        else process.env.ADMIN_EMAILS = previous;
    }
});

test("admin middleware accepts a verified Firebase admin claim", () => {
    const req = {
        emailVerified: true,
        firebaseUser: { uid: "claimed-admin", email: "owner@example.com", admin: true },
    };
    const res = responseRecorder();
    let called = false;
    adminAuth(req, res, () => { called = true; });
    assert.equal(called, true);
});
