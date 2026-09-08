import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

import Contract from "../src/models/Contract.js";
import TempContract from "../src/models/TempContract.js";

test("final contracts enforce one source temp contract", () => {
    const sourceIndex = Contract.schema.indexes().find(
        ([fields]) => fields.sourceTempContract === 1
    );

    assert.ok(sourceIndex, "sourceTempContract index should exist");
    assert.equal(sourceIndex[1].unique, true);
    assert.deepEqual(sourceIndex[1].partialFilterExpression, {
        sourceTempContract: { $type: "objectId" }
    });
});

test("temporary contracts retain recoverable lifecycle state", () => {
    const userA = new mongoose.Types.ObjectId();
    const temp = new TempContract({ userA });

    assert.equal(temp.userASign, false);
    assert.equal(temp.userBSign, false);
    assert.equal(temp.finalContract, null);
    assert.equal(temp.finalizedAt, null);
    assert.equal(temp.cancelledAt, null);
    assert.ok(temp.expiresAt instanceof Date);
    assert.ok(temp.expiresAt.getTime() > Date.now());

    const ttlIndex = TempContract.schema.indexes().find(
        ([fields]) => fields.expiresAt === 1
    );
    assert.ok(ttlIndex, "expiresAt TTL index should exist");
    assert.equal(ttlIndex[1].expireAfterSeconds, 0);
});

test("contract schema persists dispute evidence", () => {
    const contract = new Contract({
        userA: new mongoose.Types.ObjectId(),
        userB: new mongoose.Types.ObjectId(),
        disputeReasonUserA: "Scope was not delivered",
        disputeReasonEncryptedUserB: "Q2lwaGVydGV4dEtlcA==",
        disputedAtUserA: new Date()
    });

    assert.equal(contract.disputeReasonUserA, "Scope was not delivered");
    assert.equal(
        contract.disputeReasonEncryptedUserB,
        "Q2lwaGVydGV4dEtlcA=="
    );
    assert.equal(contract.disputeReasonEncryptedUserA, "");
    assert.ok(contract.disputedAtUserA instanceof Date);
    assert.equal(contract.disputeReasonUserB, "");
    assert.equal(contract.disputedAtUserB, null);
});

test("contract status rejects unknown lifecycle values", async () => {
    const contract = new Contract({
        userA: new mongoose.Types.ObjectId(),
        userB: new mongoose.Types.ObjectId(),
        status: "unknown"
    });

    await assert.rejects(contract.validate(), /status/);
});

const hasIndex = (indexes, fields) =>
    indexes.some(
        ([candidate]) =>
            Object.keys(candidate).length === Object.keys(fields).length &&
            Object.entries(fields).every(([key, value]) => candidate[key] === value)
    );

test("contract indexes cover the participant contract lists (F-46)", () => {
    const contractIndexes = Contract.schema.indexes();

    for (const fields of [
        { userA: 1, updatedAt: -1 },
        { userB: 1, updatedAt: -1 },
    ]) {
        assert.ok(
            hasIndex(contractIndexes, fields),
            `expected an index for ${JSON.stringify(fields)}`
        );
    }
});

test("contract indexes cover the admin dispute queries (F-46)", () => {
    const contractIndexes = Contract.schema.indexes();

    for (const fields of [
        { status: 1, updatedAt: -1 },
        { disputeState: 1, updatedAt: -1 },
        { status: 1, disputeState: 1 },
    ]) {
        assert.ok(
            hasIndex(contractIndexes, fields),
            `expected an index for ${JSON.stringify(fields)}`
        );
    }
});

test("temporary contract indexes cover the open-invite quota and recovery lookups (F-46)", () => {
    const tempIndexes = TempContract.schema.indexes();

    for (const fields of [
        { userA: 1, updatedAt: -1 },
        { userB: 1, updatedAt: -1 },
        { userA: 1, cancelledAt: 1, finalContract: 1, expiresAt: 1 },
    ]) {
        assert.ok(
            hasIndex(tempIndexes, fields),
            `expected an index for ${JSON.stringify(fields)}`
        );
    }

    const recoveryIndex = tempIndexes.find(
        ([fields]) => fields.finalContract === 1 && typeof fields.userA === "undefined"
    );
    assert.ok(recoveryIndex, "sparse finalContract index should exist");
    assert.equal(recoveryIndex[1].sparse, true);
});
