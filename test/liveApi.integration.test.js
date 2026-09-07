import assert from "node:assert/strict";
import test from "node:test";

const shouldRun = process.env.RUN_LIVE_INTEGRATION === "1";

test(
    "live API supports account, contract, messaging, media, and cancellation flows",
    { skip: !shouldRun },
    async () => {
        assert.ok(process.env.FIREBASE_WEB_API_KEY, "FIREBASE_WEB_API_KEY is required");
        assert.ok(process.env.MONGO_URI, "MONGO_URI is required");

        const [{ default: mongoose }, { default: admin }, { default: User },
            { default: Contract }, { default: TempContract }, { MediaHandler }] =
            await Promise.all([
                import("mongoose"),
                import("../src/config/firebase.js"),
                import("../src/models/User.js"),
                import("../src/models/Contract.js"),
                import("../src/models/TempContract.js"),
                import("../src/utils/mediaHandler.js"),
            ]);

        const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const firebaseIds = [`yack-e2e-a-${suffix}`, `yack-e2e-b-${suffix}`];
        const uploadedMediaIds = [];
        const port = process.env.PORT || "3000";
        const baseUrl = `http://127.0.0.1:${port}`;

        async function api(method, path, token, body, expectedStatus = 200) {
            const response = await fetch(`${baseUrl}${path}`, {
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await response.text();
            const payload = text ? JSON.parse(text) : {};
            assert.equal(
                response.status,
                expectedStatus,
                `${method} ${path}: ${text}`
            );
            return payload;
        }

        async function idToken(uid) {
            const customToken = await admin.auth().createCustomToken(uid);
            const response = await fetch(
                `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.FIREBASE_WEB_API_KEY}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
                }
            );
            const payload = await response.json();
            assert.equal(response.status, 200, JSON.stringify(payload));
            return payload.idToken;
        }

        await mongoose.connect(process.env.MONGO_URI, { dbName: "yack" });

        try {
            await Promise.all(firebaseIds.map((uid, index) => admin.auth().createUser({
                uid,
                email: `yack-e2e-${index}-${suffix}@example.com`,
                emailVerified: true,
            })));

            const [tokenA, tokenB] = await Promise.all(firebaseIds.map(idToken));
            const finalize = (firstName) => ({
                firstName,
                lastName: "Integration",
                publicKey: `public-key-${firstName}`,
                encryptedPrivateKey: `encrypted-private-key-${firstName}`,
                salt: `salt-${firstName}`,
                iv: `iv-${firstName}`,
            });

            await api("POST", "/user/finalize", tokenA, finalize("Alice"));
            await api("POST", "/user/finalize", tokenB, finalize("Bob"));

            const profile = await api("GET", "/user/profile", tokenA);
            assert.equal(profile.user.firstName, "Alice");
            assert.equal(profile.user.isComplete, true);

            const fcmToken = `integration-device-token-${suffix}`;
            await api("POST", "/user/fcm-token/register", tokenA, { fcmToken });
            await api("POST", "/user/fcm-token/unregister", tokenA, { fcmToken });

            const detailsHash = "a".repeat(64);
            const invitation = await api("POST", "/contracts/create", tokenA, {
                hash: "join-secret",
                titleUserA: "encrypted-title-a",
                descriptionUserA: "encrypted-description-a",
                priceUserA: "encrypted-price-a",
                detailsHash,
            }, 201);
            const tempId = invitation.tempID;
            assert.ok(tempId);

            const preview = await api(
                "GET",
                `/contracts/temp/status?tempID=${tempId}`,
                tokenB
            );
            assert.equal(preview.status, "waiting_for_join");
            assert.equal(preview.detailsHash, detailsHash);

            await api("POST", "/contracts/join", tokenB, {
                tempID: tempId,
                hash: "join-secret",
                titleUserB: "encrypted-title-b",
                descriptionUserB: "encrypted-description-b",
                priceUserB: "encrypted-price-b",
                detailsHash: "b".repeat(64),
            }, 409);

            await api("POST", "/contracts/join", tokenB, {
                tempID: tempId,
                hash: "join-secret",
                titleUserB: "encrypted-title-b",
                descriptionUserB: "encrypted-description-b",
                priceUserB: "encrypted-price-b",
                detailsHash,
            });

            const firstSignature = await api("POST", "/contracts/sign", tokenA, {
                tempID: tempId,
            });
            assert.equal(firstSignature.completed, false);

            const secondSignature = await api("POST", "/contracts/sign", tokenB, {
                tempID: tempId,
            });
            assert.equal(secondSignature.completed, true);
            const contractId = secondSignature.contractID;
            assert.ok(contractId);

            const listA = await api("GET", "/contracts/list", tokenA);
            const listB = await api("GET", "/contracts/list", tokenB);
            assert.ok(listA.contracts.some((contract) => contract._id === contractId));
            assert.ok(listB.contracts.some((contract) => contract._id === contractId));

            const senderCiphertext = Buffer.from("message-for-a").toString("base64");
            const recipientCiphertext = Buffer.from("message-for-b").toString("base64");
            await api("POST", "/messages/send", tokenA, {
                contractId,
                contentForSender: senderCiphertext,
                contentForRecipient: recipientCiphertext,
                contentHash: "c".repeat(64),
            }, 201);
            const messages = await api(
                "GET",
                `/messages/all?contractId=${contractId}`,
                tokenB
            );
            assert.equal(messages.messages.at(-1).content, recipientCiphertext);

            const media = await api("POST", "/media/send", tokenA, {
                contractId,
                file: {
                    filename: "evidence.png",
                    mimeType: "image/png",
                    buffer: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                },
            }, 201);
            assert.ok(media.media.url.startsWith("https://"));
            uploadedMediaIds.push(media.media.content);
            const mediaList = await api(
                "GET",
                `/media/all?contractId=${contractId}`,
                tokenB
            );
            assert.ok(mediaList.media.some((item) => item._id === media.media._id));

            const firstAcceptance = await api("POST", "/contracts/accept", tokenA, {
                contractId,
            });
            assert.equal(firstAcceptance.status, "accepted");
            const secondAcceptance = await api("POST", "/contracts/accept", tokenB, {
                contractId,
            });
            assert.equal(secondAcceptance.status, "completed");
            await api("POST", "/contracts/dispute", tokenA, {
                contractId,
                reason: "must be rejected after completion",
            }, 409);

            const cancellable = await api("POST", "/contracts/create", tokenA, {
                titleUserA: "cancel-title",
                descriptionUserA: "cancel-description",
                priceUserA: "cancel-price",
                detailsHash: "d".repeat(64),
            }, 201);
            await api("DELETE", `/contracts/temp/${cancellable.tempID}`, tokenA);
            const cancelled = await api(
                "GET",
                `/contracts/temp/status?tempID=${cancellable.tempID}`,
                tokenA
            );
            assert.equal(cancelled.status, "cancelled");
        } finally {
            for (const publicId of uploadedMediaIds) {
                await MediaHandler.delete(publicId).catch(() => undefined);
            }

            const users = await User.find({ firebaseID: { $in: firebaseIds } }).select("_id");
            const userIds = users.map((user) => user._id);
            if (userIds.length) {
                await Promise.all([
                    Contract.deleteMany({
                        $or: [{ userA: { $in: userIds } }, { userB: { $in: userIds } }],
                    }),
                    TempContract.deleteMany({
                        $or: [{ userA: { $in: userIds } }, { userB: { $in: userIds } }],
                    }),
                    User.deleteMany({ _id: { $in: userIds } }),
                ]);
            }
            await admin.auth().deleteUsers(firebaseIds).catch(() => undefined);
            await mongoose.disconnect();
        }
    }
);
