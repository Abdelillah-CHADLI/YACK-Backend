import assert from "node:assert/strict";
import test from "node:test";

import { MAX_FCM_TOKENS_PER_USER, planFcmTokenBind } from "../src/utils/fcmRegistration.js";
import { createRegisterFcmTokenHandler } from "../src/controllers/userController.js";

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

test("planFcmTokenBind returns an idempotent already-bound decision", () => {
    const plan = planFcmTokenBind({
        userId: "u1",
        ownedTokens: ["a", "b"],
        token: "b",
    });
    assert.equal(plan.decision, "already-bound");
});

test("planFcmTokenBind builds a single atomic filter+pipeline that steals the token", () => {
    const plan = planFcmTokenBind({
        userId: "u1",
        ownedTokens: [],
        token: "tok",
    });
    assert.equal(plan.decision, "bind");
    assert.deepEqual(plan.filter.$or, [{ _id: "u1" }, { fcmTokens: "tok" }]);
    assert.equal(plan.pipeline.length, 1);

    const nonTarget = plan.pipeline[0].$set.fcmTokens.$cond[2];
    assert.equal(nonTarget.$filter.cond.$ne[0], "$$t");
    assert.equal(nonTarget.$filter.cond.$ne[1], "tok");
    assert.deepEqual(plan.targetTokens, ["tok"]);
});

test("planFcmTokenBind evicts the oldest token at the cap", () => {
    const owned = Array.from({ length: MAX_FCM_TOKENS_PER_USER }, (_, i) => `t${i}`);
    const plan = planFcmTokenBind({ userId: "u1", ownedTokens: owned, token: "new" });
    assert.equal(plan.decision, "bind");
    assert.deepEqual(plan.targetTokens, ["t1", "t2", "t3", "t4", "new"]);
});

test("registerFcmToken handler: invalid token rejected", async () => {
    const handler = createRegisterFcmTokenHandler({ UserModel: {} });
    const res = responseRecorder();
    const result = await handler(
        { body: { fcmToken: "short" }, headers: {}, userDoc: { _id: "u1" } },
        res
    );
    assert.equal(result.statusCode, 400);
});

test("registerFcmToken handler: already-bound token is idempotent without a write", async () => {
    let writes = 0;
    const handler = createRegisterFcmTokenHandler({
        UserModel: {
            findById() {
                return { select: async () => ({ _id: "u1", fcmTokens: ["fcm-token-1234567890abcdef"] }) };
            },
            async updateMany() {
                writes += 1;
            },
        },
    });
    const res = responseRecorder();
    await handler({ body: { fcmToken: "fcm-token-1234567890abcdef" }, headers: {}, userDoc: { _id: "u1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(writes, 0);
});

test("registerFcmToken handler: atomically binds a new token through a single write", async () => {
    let capturedFilter;
    let capturedPipeline;
    let capturedOptions;
    const handler = createRegisterFcmTokenHandler({
        UserModel: {
            findById() {
                return { select: async () => ({ _id: "u1", fcmTokens: ["old-token"] }) };
            },
            async updateMany(filter, pipeline, options) {
                capturedFilter = filter;
                capturedPipeline = pipeline;
                capturedOptions = options;
            },
        },
    });
    const res = responseRecorder();
    await handler({ body: { fcmToken: "fcm-token-1234567890abcdef" }, headers: {}, userDoc: { _id: "u1" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedFilter, { $or: [{ _id: "u1" }, { fcmTokens: "fcm-token-1234567890abcdef" }] });
    assert.equal(capturedPipeline.length, 1);
    assert.equal(capturedOptions.updatePipeline, true);
});

test("registerFcmToken handler: duplicate-key race returns 409 FCM_TOKEN_CONFLICT", async () => {
    const handler = createRegisterFcmTokenHandler({
        UserModel: {
            findById() {
                return { select: async () => ({ _id: "u1", fcmTokens: [] }) };
            },
            async updateMany() {
                const err = new Error("E11000 duplicate key");
                err.code = 11000;
                throw err;
            },
        },
    });
    const res = responseRecorder();
    await handler({ body: { fcmToken: "fcm-token-1234567890abcdef" }, headers: {}, userDoc: { _id: "u1" } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "FCM_TOKEN_CONFLICT");
});
