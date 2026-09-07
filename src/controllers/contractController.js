import mongoose from "mongoose";

import Contract from "../models/Contract.js";
import TempContract from "../models/TempContract.js";
import User from "../models/User.js";
import { sendNotification } from "../utils/sendNotification.js";

const DETAILS_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_ENCRYPTED_FIELD_LENGTH = 16_384;
const MAX_JOIN_HASH_LENGTH = 512;
const MAX_DISPUTE_REASON_LENGTH = 2_000;

function requiredString(value, label, { maxLength = MAX_ENCRYPTED_FIELD_LENGTH } = {}) {
    if (typeof value !== "string" || !value.trim()) {
        return { error: `${label} required` };
    }

    const normalized = value.trim();
    if (normalized.length > maxLength) {
        return { error: `${label} is too large` };
    }

    return { value: normalized };
}

function isExpired(temp, now = new Date()) {
    return Boolean(temp.expiresAt && new Date(temp.expiresAt) <= now);
}

function referenceId(value) {
    return value?._id || value || null;
}

function participantRole(document, userId) {
    const id = userId.toString();
    if (referenceId(document.userA)?.toString() === id) return "userA";
    if (referenceId(document.userB)?.toString() === id) return "userB";
    return null;
}

function participantSummary(user) {
    if (!user) return null;
    return {
        _id: referenceId(user),
        firstName: user.firstName || "",
        lastName: user.lastName || ""
    };
}

function tempStatus(temp) {
    if (temp.finalContract) return "completed";
    if (temp.cancelledAt) return "cancelled";
    if (isExpired(temp)) return "expired";
    if (!temp.userB) return "waiting_for_join";
    if (temp.userASign && temp.userBSign) return "finalizing";
    return "waiting_for_signatures";
}

function tempStatusPayload(temp, finalContractId = null) {
    const contractID = finalContractId || temp.finalContract || null;
    return {
        success: true,
        status: contractID ? "completed" : tempStatus(temp),
        tempID: temp._id,
        contractID,
        // Keep both spellings for existing and newer mobile clients.
        contractId: contractID,
        userASign: Boolean(temp.userASign),
        userBSign: Boolean(temp.userBSign),
        userASigned: Boolean(temp.userASign),
        userBSigned: Boolean(temp.userBSign),
        userA: participantSummary(temp.userA),
        userB: participantSummary(temp.userB),
        detailsHash: temp.detailsHash || "",
        expiresAt: temp.expiresAt,
        updatedAt: temp.updatedAt
    };
}

async function notifyBestEffort(...args) {
    try {
        await sendNotification(...args);
    } catch (error) {
        // A push-provider outage must never turn a committed contract mutation
        // into a 500 response. Clients can recover through status/list polling.
        console.error("[ContractNotification] Delivery failed:", error.message);
    }
}

async function findFinalContractForTemp(tempId) {
    return Contract.findOne({
        $or: [{ sourceTempContract: tempId }, { _id: tempId }]
    });
}

async function finalizeTempContract(tempId) {
    const temp = await TempContract.findOne({
        _id: tempId,
        userB: { $ne: null },
        userASign: true,
        userBSign: true,
        cancelledAt: null
    });

    if (!temp) return null;

    if (temp.finalContract) {
        const storedFinalContract = await Contract.findById(temp.finalContract);
        if (storedFinalContract) return storedFinalContract;
    }

    const contractFields = {
        sourceTempContract: temp._id,
        userA: temp.userA,
        userB: temp.userB,
        userASign: true,
        userBSign: true,
        status: "active",
        hash: temp.hash || "",
        titleUserA: temp.titleUserA,
        descriptionUserA: temp.descriptionUserA,
        priceUserA: temp.priceUserA,
        titleUserB: temp.titleUserB,
        descriptionUserB: temp.descriptionUserB,
        priceUserB: temp.priceUserB,
        detailsHash: temp.detailsHash
    };

    let finalContract = await findFinalContractForTemp(temp._id);
    try {
        if (!finalContract) {
            // Reusing the temp ObjectId makes MongoDB's built-in _id index the
            // finalization lock. This remains exactly-once even before custom
            // indexes have finished building during a rolling deployment.
            finalContract = await Contract.create({
                _id: temp._id,
                ...contractFields
            });
        }
    } catch (error) {
        // Concurrent retries converge on the same deterministic _id.
        if (error?.code !== 11000) throw error;
        finalContract = await findFinalContractForTemp(temp._id);
    }

    if (!finalContract) {
        throw new Error("Final contract could not be materialized");
    }

    await TempContract.updateOne(
        { _id: temp._id, cancelledAt: null },
        {
            $set: {
                finalContract: finalContract._id,
                finalizedAt: new Date()
            }
        }
    );

    return finalContract;
}

/** Create a temporary contract invitation. */
export const createContract = async (req, res) => {
    try {
        const title = requiredString(req.body?.titleUserA, "Encrypted title");
        const description = requiredString(
            req.body?.descriptionUserA,
            "Encrypted description"
        );
        const price = requiredString(req.body?.priceUserA, "Encrypted price");
        const detailsHash = requiredString(req.body?.detailsHash, "Details hash", {
            maxLength: 64
        });

        for (const field of [title, description, price, detailsHash]) {
            if (field.error) return res.status(400).json({ error: field.error });
        }

        if (!DETAILS_HASH_PATTERN.test(detailsHash.value)) {
            return res.status(400).json({
                error: "Details hash must be a SHA-256 hex digest",
                code: "INVALID_DETAILS_HASH"
            });
        }

        let hash = "";
        if (req.body?.hash != null) {
            const parsedHash = requiredString(req.body.hash, "Contract hash", {
                maxLength: MAX_JOIN_HASH_LENGTH
            });
            if (parsedHash.error) {
                return res.status(400).json({ error: parsedHash.error });
            }
            hash = parsedHash.value;
        }

        const temp = await TempContract.create({
            userA: req.userDoc._id,
            hash,
            titleUserA: title.value,
            descriptionUserA: description.value,
            priceUserA: price.value,
            detailsHash: detailsHash.value.toLowerCase()
        });

        const payload = tempStatusPayload(temp);
        payload.userA = participantSummary(req.userDoc);
        return res.status(201).json({
            ...payload,
            tempID: temp._id
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to create temp contract" });
    }
};

/** Atomically reserve a temporary contract for user B. */
export const joinContract = async (req, res) => {
    try {
        const { tempID } = req.body || {};
        if (!mongoose.Types.ObjectId.isValid(tempID)) {
            return res.status(400).json({ error: "Invalid contract ID" });
        }

        const title = requiredString(req.body?.titleUserB, "Encrypted title for userB");
        const description = requiredString(
            req.body?.descriptionUserB,
            "Encrypted description for userB"
        );
        const price = requiredString(req.body?.priceUserB, "Encrypted price for userB");
        const suppliedDetailsHash = requiredString(
            req.body?.detailsHash,
            "Details hash",
            { maxLength: 64 }
        );

        for (const field of [title, description, price, suppliedDetailsHash]) {
            if (field.error) return res.status(400).json({ error: field.error });
        }

        if (!DETAILS_HASH_PATTERN.test(suppliedDetailsHash.value)) {
            return res.status(400).json({
                error: "Details hash must be a SHA-256 hex digest",
                code: "INVALID_DETAILS_HASH"
            });
        }

        const existing = await TempContract.findById(tempID);
        if (!existing) {
            return res.status(404).json({ error: "Temp contract not found" });
        }
        if (existing.finalContract) {
            return res.status(409).json({
                error: "Contract has already been finalized",
                code: "CONTRACT_FINALIZED",
                contractID: existing.finalContract
            });
        }
        if (existing.cancelledAt) {
            return res.status(409).json({
                error: "Contract invitation was cancelled",
                code: "CONTRACT_CANCELLED"
            });
        }
        if (isExpired(existing)) {
            return res.status(410).json({
                error: "Contract invitation has expired",
                code: "CONTRACT_EXPIRED"
            });
        }
        if (existing.userA.toString() === req.userDoc._id.toString()) {
            return res.status(403).json({
                error: "You cannot join your own contract",
                code: "SELF_JOIN_NOT_ALLOWED"
            });
        }
        const storedDetailsHash = existing.detailsHash?.toLowerCase();
        if (!storedDetailsHash || !DETAILS_HASH_PATTERN.test(storedDetailsHash)) {
            return res.status(409).json({
                error: "The creator's contract details cannot be verified",
                code: "DETAILS_HASH_UNAVAILABLE"
            });
        }
        if (storedDetailsHash !== suppliedDetailsHash.value.toLowerCase()) {
            return res.status(409).json({
                error: "Contract details do not match the creator's terms",
                code: "DETAILS_HASH_MISMATCH"
            });
        }

        const suppliedJoinHash = req.body?.hash;
        if (existing.hash) {
            if (typeof suppliedJoinHash !== "string" || !suppliedJoinHash) {
                return res.status(400).json({ error: "Contract hash required" });
            }
            if (existing.hash !== suppliedJoinHash) {
                return res.status(403).json({
                    error: "Contract hash mismatch",
                    code: "JOIN_HASH_MISMATCH"
                });
            }
        }

        const userA = await User.findById(existing.userA).select(
            "firstName lastName publicKey isComplete"
        );
        if (!userA?.isComplete || !userA.publicKey) {
            return res.status(409).json({
                error: "The contract creator's account is unavailable",
                code: "CREATOR_ACCOUNT_UNAVAILABLE"
            });
        }

        const callerId = req.userDoc._id;
        let joinedNow = false;
        let temp;

        if (existing.userB?.toString() === callerId.toString()) {
            temp = existing;
        } else if (existing.userB) {
            return res.status(409).json({
                error: "Contract already joined",
                code: "CONTRACT_ALREADY_JOINED"
            });
        } else {
            temp = await TempContract.findOneAndUpdate(
                {
                    _id: existing._id,
                    userA: { $ne: callerId },
                    userB: null,
                    cancelledAt: null,
                    finalContract: null,
                    expiresAt: { $gt: new Date() }
                },
                {
                    $set: {
                        userB: callerId,
                        titleUserB: title.value,
                        descriptionUserB: description.value,
                        priceUserB: price.value
                    }
                },
                { new: true, runValidators: true }
            );
            joinedNow = Boolean(temp);

            if (!temp) {
                const latest = await TempContract.findById(existing._id);
                if (latest?.userB?.toString() === callerId.toString()) {
                    temp = latest;
                } else {
                    return res.status(409).json({
                        error: "Contract is no longer available to join",
                        code: "CONTRACT_NOT_AVAILABLE"
                    });
                }
            }
        }

        if (joinedNow) {
            void notifyBestEffort(
                temp.userA,
                "contract_joined",
                "",
                {
                    type: "contractJoin",
                    tempId: temp._id.toString(),
                    userId: temp.userB.toString(),
                    username: req.userDoc.firstName || ""
                },
                {
                    localize: true,
                    params: { name: req.userDoc.firstName || "" }
                }
            );
        }

        const userAFullName = [userA.firstName, userA.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();

        return res.json({
            ...tempStatusPayload(temp),
            alreadyJoined: !joinedNow,
            userAFullName,
            userId: userA._id,
            userAPublicKey: userA.publicKey
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to join contract" });
    }
};

/** Sign a temporary contract and idempotently create its final contract. */
export const signContract = async (req, res) => {
    try {
        const { tempID } = req.body || {};
        if (!mongoose.Types.ObjectId.isValid(tempID)) {
            return res.status(400).json({ error: "Invalid contract ID" });
        }

        let temp = await TempContract.findById(tempID);
        if (!temp) {
            const finalContract = await findFinalContractForTemp(tempID);
            if (finalContract && participantRole(finalContract, req.userDoc._id)) {
                return res.json({
                    success: true,
                    signed: true,
                    alreadySigned: true,
                    completed: true,
                    tempID,
                    contractID: finalContract._id,
                    contractId: finalContract._id
                });
            }
            return res.status(404).json({ error: "Temp contract not found" });
        }

        const role = participantRole(temp, req.userDoc._id);
        if (!role) {
            return res.status(403).json({ error: "Not your contract" });
        }
        if (!temp.userB) {
            return res.status(409).json({
                error: "Wait for another participant to join before signing",
                code: "WAITING_FOR_PARTICIPANT"
            });
        }
        if (temp.cancelledAt) {
            return res.status(409).json({
                error: "Contract invitation was cancelled",
                code: "CONTRACT_CANCELLED"
            });
        }
        if (temp.finalContract) {
            return res.json({
                ...tempStatusPayload(temp),
                signed: true,
                alreadySigned: true,
                completed: true
            });
        }
        if (isExpired(temp)) {
            return res.status(410).json({
                error: "Contract invitation has expired",
                code: "CONTRACT_EXPIRED"
            });
        }

        const signField = role === "userA" ? "userASign" : "userBSign";
        const alreadySigned = Boolean(temp[signField]);
        let signedNow = false;

        if (!alreadySigned) {
            temp = await TempContract.findOneAndUpdate(
                {
                    _id: temp._id,
                    [signField]: false,
                    userB: { $ne: null },
                    cancelledAt: null,
                    finalContract: null,
                    expiresAt: { $gt: new Date() }
                },
                { $set: { [signField]: true } },
                { new: true, runValidators: true }
            );
            signedNow = Boolean(temp);
            if (!temp) {
                temp = await TempContract.findById(tempID);
                if (!temp) {
                    return res.status(404).json({ error: "Temp contract not found" });
                }
                if (temp.cancelledAt) {
                    return res.status(409).json({
                        error: "Contract invitation was cancelled",
                        code: "CONTRACT_CANCELLED"
                    });
                }
                if (isExpired(temp)) {
                    return res.status(410).json({
                        error: "Contract invitation has expired",
                        code: "CONTRACT_EXPIRED"
                    });
                }
                if (!temp[signField] && !temp.finalContract) {
                    return res.status(409).json({
                        error: "Contract signature conflicted with another update",
                        code: "CONTRACT_STATE_CONFLICT"
                    });
                }
            }
        }

        let finalContract = null;
        if (temp.userASign && temp.userBSign) {
            finalContract = await finalizeTempContract(temp._id);
            if (!finalContract) {
                return res.status(409).json({
                    error: "Contract could not be finalized in its current state",
                    code: "FINALIZATION_CONFLICT"
                });
            }
            temp.finalContract = finalContract._id;
        }

        if (signedNow) {
            const otherUser = role === "userA" ? temp.userB : temp.userA;
            void notifyBestEffort(
                otherUser,
                "contract_signed",
                "",
                {
                    type: "contractSign",
                    tempId: temp._id.toString(),
                    contractId: finalContract?._id?.toString() || "",
                    completed: Boolean(finalContract),
                    userId: req.userDoc._id.toString(),
                    username: req.userDoc.firstName || ""
                },
                {
                    localize: true,
                    params: { name: req.userDoc.firstName || "" }
                }
            );
        }

        return res.json({
            ...tempStatusPayload(temp, finalContract?._id),
            signed: true,
            alreadySigned: !signedNow,
            completed: Boolean(finalContract)
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to sign contract" });
    }
};

/** Return temporary-contract state, without exposing encrypted details. */
export const getTempContractStatus = async (req, res) => {
    try {
        const tempID = req.query?.tempID || req.query?.tempId;
        if (!mongoose.Types.ObjectId.isValid(tempID)) {
            return res.status(400).json({ error: "Invalid contract ID" });
        }

        const temp = await TempContract.findById(tempID)
            .populate("userA", "firstName lastName")
            .populate("userB", "firstName lastName");

        if (temp) {
            const role = participantRole(temp, req.userDoc._id);
            // A prospective authenticated participant may inspect only the safe
            // status metadata before joining. Once reserved, it is A/B-only.
            if (temp.userB && !role) {
                return res.status(403).json({ error: "Not your contract" });
            }

            let finalContractId = temp.finalContract;
            if (!finalContractId && temp.userASign && temp.userBSign && !temp.cancelledAt) {
                const finalContract = await finalizeTempContract(temp._id);
                finalContractId = finalContract?._id || null;
            }

            return res.json(tempStatusPayload(temp, finalContractId));
        }

        const finalContract = await findFinalContractForTemp(tempID);
        if (finalContract && participantRole(finalContract, req.userDoc._id)) {
            return res.json({
                success: true,
                status: "completed",
                tempID,
                contractID: finalContract._id,
                contractId: finalContract._id,
                userASign: true,
                userBSign: true,
                userASigned: true,
                userBSigned: true
            });
        }

        return res.status(404).json({ error: "Temp contract not found" });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch contract status" });
    }
};

/** Cancel a creator-owned invitation while retaining a short-lived tombstone. */
export const cancelTempContract = async (req, res) => {
    try {
        const { tempID } = req.params;
        if (!mongoose.Types.ObjectId.isValid(tempID)) {
            return res.status(400).json({ error: "Invalid contract ID" });
        }

        const temp = await TempContract.findById(tempID);
        if (!temp) {
            const finalContract = await findFinalContractForTemp(tempID);
            if (finalContract) {
                if (finalContract.userA.toString() !== req.userDoc._id.toString()) {
                    return res.status(403).json({
                        error: "Only the contract creator can cancel this invitation"
                    });
                }
                return res.status(409).json({
                    error: "A finalized contract cannot be cancelled",
                    code: "CONTRACT_FINALIZED",
                    contractID: finalContract._id
                });
            }
            return res.json({
                success: true,
                cancelled: true,
                alreadyCancelled: true,
                tempID
            });
        }

        if (temp.userA.toString() !== req.userDoc._id.toString()) {
            return res.status(403).json({
                error: "Only the contract creator can cancel this invitation"
            });
        }
        if (temp.finalContract || (temp.userASign && temp.userBSign)) {
            return res.status(409).json({
                error: "A finalized contract cannot be cancelled",
                code: "CONTRACT_FINALIZED",
                contractID: temp.finalContract || null
            });
        }
        if (temp.cancelledAt) {
            return res.json({
                success: true,
                cancelled: true,
                alreadyCancelled: true,
                tempID: temp._id
            });
        }
        if (isExpired(temp)) {
            return res.status(410).json({
                error: "Contract invitation has expired",
                code: "CONTRACT_EXPIRED"
            });
        }

        const cancelled = await TempContract.findOneAndUpdate(
            {
                _id: temp._id,
                userA: req.userDoc._id,
                cancelledAt: null,
                finalContract: null,
                $or: [{ userASign: false }, { userBSign: false }]
            },
            { $set: { cancelledAt: new Date() } },
            { new: true, runValidators: true }
        );

        if (!cancelled) {
            return res.status(409).json({
                error: "Contract is already finalizing and cannot be cancelled",
                code: "CONTRACT_FINALIZING"
            });
        }

        return res.json({
            success: true,
            cancelled: true,
            alreadyCancelled: false,
            tempID: cancelled._id
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to cancel contract" });
    }
};

/** Atomically record one participant's acceptance. */
export const acceptContract = async (req, res) => {
    try {
        const contract = req.contract;
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const isUserA = participantRole(contract, req.userDoc._id) === "userA";
        const agreeField = isUserA ? "agreedUserA" : "agreedUserB";
        let updated = await Contract.findOneAndUpdate(
            {
                _id: contract._id,
                [agreeField]: false,
                status: { $nin: ["completed", "disputed", "rejected"] }
            },
            { $set: { [agreeField]: true } },
            { new: true, runValidators: true }
        );

        if (!updated) {
            const current = await Contract.findById(contract._id);
            if (!current) {
                return res.status(404).json({ error: "Contract not found" });
            }
            if (current.status === "disputed" || current.status === "rejected") {
                return res.status(409).json({
                    error: current.status === "disputed"
                        ? "A disputed contract cannot be accepted"
                        : "Contract cannot be accepted in its current state",
                    code: "CONTRACT_STATE_CONFLICT"
                });
            }
            if (current[agreeField]) {
                return res.json({
                    success: true,
                    alreadyAccepted: true,
                    status: current.status,
                    agreedUserA: current.agreedUserA,
                    agreedUserB: current.agreedUserB
                });
            }
            return res.status(409).json({
                error: "Contract cannot be accepted in its current state",
                code: "CONTRACT_STATE_CONFLICT"
            });
        }

        if (updated.agreedUserA && updated.agreedUserB) {
            const transitioned = await Contract.findOneAndUpdate(
                {
                    _id: updated._id,
                    agreedUserA: true,
                    agreedUserB: true,
                    status: { $nin: ["disputed", "rejected"] }
                },
                { $set: { status: "completed" } },
                { new: true, runValidators: true }
            );
            updated = transitioned || await Contract.findById(updated._id) || updated;
        } else {
            const transitioned = await Contract.findOneAndUpdate(
                {
                    _id: updated._id,
                    status: { $in: ["active", "pending"] }
                },
                { $set: { status: "accepted" } },
                { new: true, runValidators: true }
            );
            updated = transitioned || await Contract.findById(updated._id) || updated;
        }

        if (updated.status === "disputed" || updated.status === "rejected") {
            return res.status(409).json({
                error: "Contract state changed before acceptance completed",
                code: "CONTRACT_STATE_CONFLICT"
            });
        }

        const otherUser = isUserA ? updated.userB : updated.userA;
        void notifyBestEffort(
            otherUser,
            updated.status === "completed" ? "contract_completed" : "contract_accepted",
            "",
            {
                type: "contractAccept",
                userId: req.userDoc._id.toString(),
                username: req.userDoc.firstName || "",
                contractId: updated._id.toString(),
                status: updated.status
            },
            {
                localize: true,
                params: { name: req.userDoc.firstName || "" }
            }
        );

        return res.json({
            success: true,
            alreadyAccepted: false,
            status: updated.status,
            agreedUserA: updated.agreedUserA,
            agreedUserB: updated.agreedUserB
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to accept contract" });
    }
};

/** Atomically dispute a non-completed contract and retain the reason. */
export const disputeContract = async (req, res) => {
    try {
        const contract = req.contract;
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        if (req.body?.reason != null && typeof req.body.reason !== "string") {
            return res.status(400).json({ error: "Dispute reason must be text" });
        }
        const reason = (req.body?.reason || "").trim();
        if (reason.length > MAX_DISPUTE_REASON_LENGTH) {
            return res.status(400).json({ error: "Dispute reason is too large" });
        }

        const isUserA = participantRole(contract, req.userDoc._id) === "userA";
        const disputeField = isUserA ? "disputedUserA" : "disputedUserB";
        const agreeField = isUserA ? "agreedUserA" : "agreedUserB";
        const reasonField = isUserA ? "disputeReasonUserA" : "disputeReasonUserB";
        const disputedAtField = isUserA ? "disputedAtUserA" : "disputedAtUserB";

        const updated = await Contract.findOneAndUpdate(
            {
                _id: contract._id,
                [disputeField]: false,
                status: { $nin: ["completed", "rejected"] }
            },
            {
                $set: {
                    [disputeField]: true,
                    [agreeField]: false,
                    [reasonField]: reason,
                    [disputedAtField]: new Date(),
                    status: "disputed"
                }
            },
            { new: true, runValidators: true }
        );

        if (!updated) {
            const current = await Contract.findById(contract._id);
            if (!current) {
                return res.status(404).json({ error: "Contract not found" });
            }
            if (current[disputeField]) {
                return res.json({
                    success: true,
                    alreadyDisputed: true,
                    status: current.status,
                    disputedUserA: current.disputedUserA,
                    disputedUserB: current.disputedUserB
                });
            }
            return res.status(409).json({
                error: "A completed contract cannot be disputed",
                code: "CONTRACT_STATE_CONFLICT"
            });
        }

        const otherUser = isUserA ? updated.userB : updated.userA;
        void notifyBestEffort(
            otherUser,
            "contract_disputed",
            "",
            {
                type: "contractDispute",
                reason,
                userId: req.userDoc._id.toString(),
                username: req.userDoc.firstName || "",
                contractId: updated._id.toString()
            },
            {
                localize: true,
                params: { name: req.userDoc.firstName || "" }
            }
        );

        return res.json({
            success: true,
            alreadyDisputed: false,
            status: updated.status,
            disputedUserA: updated.disputedUserA,
            disputedUserB: updated.disputedUserB,
            disputeReason: reason
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to dispute contract" });
    }
};

/** Compare a contract's stored join hash, or details hash when no join hash exists. */
export const verifyContract = async (req, res) => {
    try {
        const contract = req.contract;
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const providedHash = req.body?.hash || req.query?.hash || req.params?.hash;
        if (typeof providedHash !== "string" || !providedHash) {
            return res.status(400).json({ error: "Hash is required" });
        }

        const storedHash = contract.hash || contract.detailsHash;
        if (!storedHash) {
            return res.status(404).json({ error: "No hash stored for this contract" });
        }

        return res.json({
            success: true,
            matches: storedHash === providedHash,
            hashType: contract.hash ? "contract" : "details"
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to verify contract" });
    }
};

/** List caller-visible contracts without leaking the other encrypted envelope. */
export const getContracts = async (req, res) => {
    try {
        const userId = req.userDoc._id.toString();
        const contracts = await Contract.find({
            $or: [{ userA: req.userDoc._id }, { userB: req.userDoc._id }]
        })
            .populate("userA", "firstName lastName publicKey")
            .populate("userB", "firstName lastName publicKey")
            .sort({ updatedAt: -1 });

        const mappedContracts = contracts.flatMap((contract) => {
            const userAId = contract.userA?._id?.toString();
            const userBId = contract.userB?._id?.toString();
            const isUserA = userAId === userId;
            const otherUser = isUserA ? contract.userB : contract.userA;

            // A deleted/corrupt participant should not make the entire list
            // endpoint fail for every otherwise healthy contract.
            if (!otherUser || (userAId !== userId && userBId !== userId)) {
                return [];
            }

            return [{
                _id: contract._id,
                otherUser: {
                    _id: otherUser._id,
                    firstName: otherUser.firstName || "",
                    lastName: otherUser.lastName || "",
                    publicKey: otherUser.publicKey || ""
                },
                title: isUserA ? contract.titleUserA : contract.titleUserB,
                description: isUserA
                    ? contract.descriptionUserA
                    : contract.descriptionUserB,
                price: isUserA ? contract.priceUserA : contract.priceUserB,
                detailsHash: contract.detailsHash,
                status: contract.status,
                userASign: contract.userASign,
                userBSign: contract.userBSign,
                agreedUserA: contract.agreedUserA,
                agreedUserB: contract.agreedUserB,
                disputedUserA: contract.disputedUserA,
                disputedUserB: contract.disputedUserB,
                disputeReasonUserA: contract.disputeReasonUserA,
                disputeReasonUserB: contract.disputeReasonUserB,
                disputedAtUserA: contract.disputedAtUserA,
                disputedAtUserB: contract.disputedAtUserB,
                hash: contract.hash,
                isUserA,
                createdAt: contract.createdAt,
                updatedAt: contract.updatedAt
            }];
        });

        return res.json({ success: true, contracts: mappedContracts });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Failed to fetch contracts" });
    }
};
