import assert from "node:assert/strict";
import test from "node:test";

process.env.YACK_DISABLE_BOOT_VALIDATE = "1";

const {
    buildCorsOptions,
    isAllowedOrigin,
    parseCorsOrigins,
} = await import("../src/config/cors.js");

test("parseCorsOrigins splits and trims comma-separated origins", () => {
    assert.deepEqual(parseCorsOrigins(" https://a.com, https://b.com ,"), ["https://a.com", "https://b.com"]);
    assert.deepEqual(parseCorsOrigins(""), []);
    assert.deepEqual(parseCorsOrigins(undefined), []);
});

test("isAllowedOrigin allows requests without an Origin header (native clients)", () => {
    assert.equal(isAllowedOrigin(null, [], true), true);
    assert.equal(isAllowedOrigin("", [], true), true);
});

test("isAllowedOrigin denies unknown origins in production", () => {
    assert.equal(isAllowedOrigin("https://evil.example.com", ["https://admin.example.com"], true), false);
});

test("isAllowedOrigin allows exact and trailing-slash-stripped matches", () => {
    assert.equal(isAllowedOrigin("https://admin.example.com", ["https://admin.example.com"], true), true);
    assert.equal(isAllowedOrigin("https://admin.example.com/", ["https://admin.example.com"], true), true);
});

test("isAllowedOrigin honors the explicit wildcard opt-in", () => {
    assert.equal(isAllowedOrigin("https://anything.example.com", ["*"], true), true);
});

test("isAllowedOrigin allows localhost origins outside production only", () => {
    assert.equal(isAllowedOrigin("http://localhost:3000", [], false), true);
    assert.equal(isAllowedOrigin("http://127.0.0.1:8080", [], false), true);
    assert.equal(isAllowedOrigin("http://localhost:3000", [], true), false);
    assert.equal(isAllowedOrigin("http://evillocalhost.com", [], false), false);
});

test("buildCorsOptions wires isAllowedOrigin into the express callback", () => {
    const options = buildCorsOptions({ corsOrigins: "https://admin.example.com", production: true });
    options.origin("https://admin.example.com", (err, allow) => {
        assert.equal(err, null);
        assert.equal(allow, true);
    });
    options.origin("https://evil.example.com", (err, allow) => {
        assert.equal(err, null);
        assert.equal(allow, false);
    });
    options.origin(null, (err, allow) => {
        assert.equal(err, null);
        assert.equal(allow, true);
    });
});