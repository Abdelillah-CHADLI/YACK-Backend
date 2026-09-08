import assert from "node:assert/strict";
import test from "node:test";

import requireVerifiedEmail from "../src/middleware/requireVerifiedEmail.js";

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

test("requireVerifiedEmail passes verified requests through", () => {
    const res = responseRecorder();
    let called = false;
    requireVerifiedEmail({ emailVerified: true }, res, () => { called = true; });
    assert.equal(called, true);
});

test("requireVerifiedEmail blocks unverified and missing flags", () => {
    for (const emailVerified of [false, undefined]) {
        const res = responseRecorder();
        let called = false;
        requireVerifiedEmail({ emailVerified }, res, () => { called = true; });
        assert.equal(called, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.payload.code, "EMAIL_NOT_VERIFIED");
    }
});