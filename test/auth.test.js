import assert from "node:assert/strict";
import test from "node:test";

import { createAuthMiddleware } from "../src/middleware/auth.js";

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

function makeFakes({ tokenUser, blockedUser } = {}) {
    const captures = { revokeChecks: [], upsert: null, firebaseUpserts: [] };
    const mockCalls = { updateMany: 0, findByIdAndUpdate: 0 };
    const firebaseAdmin = {
        auth: () => ({
            async verifyIdToken(token, options) {
                captures.revokeChecks.push(options?.checkRevoked);
                if (token === "revoked-token") {
                    throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" });
                }
                return tokenUser || { uid: "u1", email: "a@b.c", email_verified: true };
            },
            async getUser() {
                const live = { emailVerified: true };
                captures.firebaseUpserts.push(live);
                return live;
            },
        }),
    };
    const userDoc = {
        _id: "doc1",
        firebaseID: "u1",
        blocked: false,
        fcmTokens: [],
    };
    const UserModel = {
        async findOneAndUpdate(filter, update, options) {
            captures.upsert = { filter, update, options };
            const user = blockedUser ? { ...userDoc, blocked: true } : blockedUser === false ? { ...userDoc, blocked: false } : userDoc;
            return user;
        },
        async updateMany() { mockCalls.updateMany += 1; return {}; },
        async findByIdAndUpdate() { mockCalls.findByIdAndUpdate += 1; return userDoc; },
    };
    return { captures, firebaseAdmin, UserModel, mockCalls };
}

test("auth requires a bearer token", async () => {
    const { firebaseAdmin, UserModel } = makeFakes();
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = { headers: {}, body: {} };
    const res = responseRecorder();
    let called = false;
    await auth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.payload.error, /Bearer auth token required/);
});

test("auth verifies with checkRevoked:true and attaches the user", async () => {
    const { captures, firebaseAdmin, UserModel } = makeFakes();
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = { headers: { authorization: "Bearer valid-token" }, body: {} };
    let called = false;
    await auth(req, responseRecorder(), () => { called = true; });
    assert.equal(called, true);
    assert.equal(captures.revokeChecks[0], true);
    assert.equal(captures.firebaseUpserts.length, 0, "verified token must not re-fetch the Firebase user");
    assert.equal(req.userDoc._id, "doc1");
    assert.equal(req.emailVerified, true);
});

test("auth rejects revoked tokens", async () => {
    const { firebaseAdmin, UserModel } = makeFakes();
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = { headers: { authorization: "Bearer revoked-token" }, body: {} };
    const res = responseRecorder();
    let called = false;
    await auth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.payload.error, /Invalid or expired/);
});

test("auth rejects blocked accounts with 403 ACCOUNT_BLOCKED", async () => {
    const { firebaseAdmin, UserModel } = makeFakes({ blockedUser: true });
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = { headers: { authorization: "Bearer valid-token" }, body: {} };
    const res = responseRecorder();
    let called = false;
    await auth(req, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.payload.code, "ACCOUNT_BLOCKED");
});

test("auth upserts a fresh user with defaults including blocked:false", async () => {
    const { captures, firebaseAdmin, UserModel } = makeFakes({ blockedUser: false });
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = { headers: { authorization: "Bearer valid-token" }, body: {} };
    let called = false;
    await auth(req, responseRecorder(), () => { called = true; });
    assert.equal(called, true);
    assert.deepEqual(captures.upsert.filter, { firebaseID: "u1" });
    assert.equal(captures.upsert.options.upsert, true);
    assert.deepEqual(captures.upsert.update.$setOnInsert.blocked, false);
    assert.equal(captures.upsert.update.$set.email, "a@b.c");
});

test("auth no longer registers FCM tokens implicitly (F-03)", async () => {
    const { firebaseAdmin, UserModel, mockCalls } = makeFakes({ blockedUser: false });
    mockCalls.updateMany = 0;
    mockCalls.findByIdAndUpdate = 0;
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = {
        headers: { authorization: "Bearer valid-token", "x-fcm-token": "token-1234567890" },
        body: { fcmToken: "token-1234567890" },
    };
    let called = false;
    await auth(req, responseRecorder(), () => { called = true; });
    assert.equal(called, true);
    assert.equal(mockCalls.updateMany, 0, "FCM tokens must only be bound through the explicit endpoint");
    assert.equal(mockCalls.findByIdAndUpdate, 0, "FCM tokens must only be bound through the explicit endpoint");
});

test("auth rechecks email_verified against the live Firebase record", async () => {
    const { captures, firebaseAdmin, UserModel } = makeFakes({
        tokenUser: { uid: "u1", email: "a@b.c", email_verified: false },
    });
    const auth = createAuthMiddleware({ firebaseAdmin, UserModel });
    const req = { headers: { authorization: "Bearer valid-token" }, body: {} };
    let called = false;
    await auth(req, responseRecorder(), () => { called = true; });
    assert.equal(called, true);
    assert.equal(captures.firebaseUpserts.length, 1, "stale token must trigger a live Firebase check");
    assert.equal(req.emailVerified, true);
});