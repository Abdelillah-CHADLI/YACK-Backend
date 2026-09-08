import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

import { globalApiLimiter, createUserLimiter } from "../src/middleware/rateLimiters.js";

function buildApp(limiters, { forgeUser = false } = {}) {
    const app = express();
    if (forgeUser) {
        app.use((req, _res, next) => {
            req.firebaseUser = { uid: req.headers["x-uid"] || "default-user" };
            next();
        });
    }
    for (const limiter of limiters) app.use(limiter);
    let hits = 0;
    app.get("/", (_req, res) => res.json({ ok: true }));
    app.post("/run", (_req, res) => res.json({ hits: ++hits }));
    return app;
}

async function withServer(app, fn) {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    try {
        const port = server.address().port;
        return await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

test("globalApiLimiter skips the root health endpoint", async () => {
    const app = buildApp([globalApiLimiter]);
    await withServer(app, async (base) => {
        for (let i = 0; i < 3; i++) {
            const res = await fetch(`${base}/`);
            assert.equal(res.status, 200);
        }
    });
});

test("globalApiLimiter rejects floods with 429 RATE_LIMITED", async () => {
    const app = buildApp([globalApiLimiter]);
    await withServer(app, async (base) => {
        let saw429 = false;
        let allowed = 0;
        for (let i = 0; i < 610; i++) {
            const res = await fetch(`${base}/run`, { method: "POST" });
            if (res.status === 429) {
                saw429 = true;
                const body = await res.json();
                assert.equal(body.code, "RATE_LIMITED");
                break;
            }
            allowed += 1;
        }
        assert.equal(saw429, true, "expected a 429 after the global per-IP ceiling");
        assert.equal(allowed, 600);
    });
});

test("createUserLimiter is keyed per Firebase UID", async () => {
    const limiter = createUserLimiter({ limit: 3 });
    const app = buildApp([limiter], { forgeUser: true });
    await withServer(app, async (base) => {
        const aliceRequests = [];
        for (let i = 0; i < 4; i++) {
            const res = await fetch(`${base}/run`, {
                method: "POST",
                headers: { "x-uid": "alice" },
            });
            aliceRequests.push(res.status);
        }
        assert.deepEqual(aliceRequests.slice(0, 3), [200, 200, 200]);
        assert.equal(aliceRequests[3], 429, "alice must hit her own per-user ceiling");

        const bob = await fetch(`${base}/run`, {
            method: "POST",
            headers: { "x-uid": "bob" },
        });
        assert.equal(bob.status, 200, "a different UID must not share alice's ceiling");
    });
});