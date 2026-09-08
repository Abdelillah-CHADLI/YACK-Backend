import mongoose from "mongoose";

import Contract from "../models/Contract.js";
import TempContract from "../models/TempContract.js";
import User from "../models/User.js";
import { sendNotification } from "../utils/sendNotification.js";
import { ensureSupportThread } from "./supportController.js";
import {
    validateCiphertext,
    validateHash,
    timingSafeHexEqual,
} from "../utils/validation.js";
import { parseLimit, parseOffset } from "../utils/pagination.js";
import {
    MAX_FINAL_CONTRACTS_PER_USER,
    MAX_OPEN_TEMP_CONTRACTS_PER_USER,
} from "../utils/quota.js";
import { logger } from "../utils/logger.js";

const MAX_JOIN_HASH_LENGTH = 512;
const MAX_DISPUTE_REASON_LENGTH = 2_000;

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

/**
 * Build the temp-contract status payload.
 *
 * F-39: before a second participant has been reserved, participant names are
 * PII no outsider needs, so they are dropped unless the caller already is one
 * of the parties. The detailsHash is intentionally kept even pre-join: the
 * mobile scan flow cross-checks it against the value transported by the QR
 * code, and the QR already carries it, so hiding it adds no secrecy while
 * breaking cold join (verified against scan_contract.dart).
 */
function tempStatusPayload(temp, finalContractId = null, callerId = null) {
    const contractID = finalContractId || temp.finalContract || null;
    const callerRole = callerId ? participantRole(temp, callerId) : null;
    const discloseNames = Boolean(temp.userB) || callerRole !== null;
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
        userA: discloseNames ? participantSummary(temp.userA) : null,
        userB: discloseNames ? participantSummary(temp.userB) : null,
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
        logger.error("[ContractNotification] Delivery failed:", { error: error.message });
    }
}

async function findFinalContractForTemp(tempId) {
    return Contract.findOne({
        $or: [{ sourceTempContract: tempId }, { _id: tempId }]
    });
}

async function finalizeTempContract(tempId) {
    // F-13: finalization is only legal inside the invitation's lifetime.
    const temp = await TempContract.findOne({
        _id: tempId,
        userB: { $ne: null },
        userASign: true,
        userBSign: true,
        cancelledAt: null,
        expiresAt: { $gt: new Date() }
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

async function finalContractCountForUser(userId) {
    return Contract.countDocuments({
        $or: [{ userA: userId }, { userB: userId }]
    });
}

/** Create a temporary contract invitation. */
export const createContract = async (req, res) => {
    logger.info("[contracts] create temp invitation started");
    try {
        // F-36: one account may hold a bounded number of live invitations.
        const openCount = await TempContract.countDocuments({
            userA: req.userDoc._id,
            cancelledAt: null,
            finalContract: null,
            expiresAt: { $gt: new Date() }
        });
        if (openCount >= MAX_OPEN_TEMP_CONTRACTS_PER_USER) {
            return res.status(429).json({
                error: "Open contract invitations limit reached",
                code: "TEMP_CONTRACT_QUOTA_EXCEEDED"
            });
        }

        // F-41: the creator's contract fields are expected to be canonical
        // Base64 ciphertext, like every other encrypted field on the server.
        const title = validateCiphertext(req.body?.titleUserA, "Encrypted title");
        const description = validateCiphertext(
            req.body?.descriptionUserA,
            "Encrypted description"
        );
        const price = validateCiphertext(req.body?.priceUserA, "Encrypted price");
        const detailsHash = validateHash(req.body?.detailsHash, {
            label: "Details hash"
        });

        let hash = "";
        if (req.body?.hash != null) {
            const parsedHash = String(req.body.hash || "").trim();
            if (!parsedHash) {
                return res.status(400).json({ error: "Contract hash is required" });
            }
            if (parsedHash.length > MAX_JOIN_HASH_LENGTH) {
                return res.status(400).json({ error: "Contract hash is too large" });
            }
            hash = parsedHash;
        }

        const temp = await TempContract.create({
            userA: req.userDoc._id,
            hash,
            titleUserA: title,
            descriptionUserA: description,
            priceUserA: price,
            detailsHash
        });

        const payload = tempStatusPayload(temp);
        payload.userA = participantSummary(req.userDoc);
        return res.status(201).json({
            ...payload,
            tempID: temp._id
        });
    } catch (error) {
        logger.error("[contracts] Failed to create temp contract:", { error: error.message });
        return res.status(500).json({ error: "Failed to create temp contract" });
    }
};

/** Atomically reserve a temporary contract for user B. */
export const joinContract = async (req, res) => {
    logger.info("[contracts] join temp invitation started");
    try {
        const { tempID } = req.body || {};
        if (!mongoose.Types.ObjectId.isValid(tempID)) {
            return res.status(400).json({ error: "Invalid contract ID" });
        }

        // F-41: same ciphertext shape rule as contract creation.
        const title = validateCiphertext(req.body?.titleUserB, "Encrypted title for userB");
        const description = validateCiphertext(
            req.body?.descriptionUserB,
            "Encrypted description for userB"
        );
        const price = validateCiphertext(req.body?.priceUserB, "Encrypted price for userB");
        const suppliedDetailsHash = validateHash(req.body?.detailsHash, {
            label: "Details hash"
        });

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
        if (!storedDetailsHash || !/^[a-f0-9]{64}$/i.test(storedDetailsHash)) {
            return res.status(409).json({
                error: "The creator's contract details cannot be verified",
                code: "DETAILS_HASH_UNAVAILABLE"
            });
        }
        if (storedDetailsHash !== suppliedDetailsHash.toLowerCase()) {
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
            if (!timingSafeHexEqual(String(existing.hash).trim().toLowerCase(), suppliedJoinHash.trim().toLowerCase())) {
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

        // F-36: bounded account growth even when invitations are finalized.
        const callerId = req.userDoc._id;
        const callerFinalCount = await finalContractCountForUser(callerId);
        if (callerFinalCount >= MAX_FINAL_CONTRACTS_PER_USER) {
            return res.status(429).json({
                error: "Contract limit reached for this account",
                code: "FINAL_CONTRACT_QUOTA_EXCEEDED"
            });
        }

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
                        titleUserB: title,
                        descriptionUserB: description,
                        priceUserB: price
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
        logger.error("[contracts] Failed to join contract:", { error: error.message });
        return res.status(500).json({ error: "Failed to join contract" });
    }
};

/** Sign a temporary contract and idempotently create its final contract. */
export const signContract = async (req, res) => {
    logger.info("[contracts] sign temp invitation started");
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
            // F-36: final materialization is also bounded, so an account cannot
            // grow past the cap through the poll/recovery paths either.
            const otherFinalCount = await finalContractCountForUser(
                role === "userA" ? temp.userB : temp.userA
            );
            if (otherFinalCount >= MAX_FINAL_CONTRACTS_PER_USER) {
                return res.status(429).json({
                    error: "Contract limit reached for this account",
                    code: "FINAL_CONTRACT_QUOTA_EXCEEDED"
                });
            }

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
        logger.error("[contracts] Failed to sign contract:", { error: error.message });
        return res.status(500).json({ error: "Failed to sign contract" });
    }
};

/** Return temporary-contract state, without exposing encrypted details. */
export const getTempContractStatus = async (req, res) => {
    logger.info("[contracts] temp status requested");
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
                // F-13: a status poll is a legitimate recovery write. The mobile
                // client polls this endpoint ("UI recovers when push notifications
                // are delayed or disabled") so a lost /sign response still yields
                // the final contract. finalizeTempContract is exactly-once
                // (deterministic _id + duplicate-key retry), expiry-checked and
                // quota-bounded, so a GET can safely materialize it.
                const finalContract = await finalizeTempContract(temp._id);
                finalContractId = finalContract?._id || null;
            }

            return res.json(tempStatusPayload(temp, finalContractId, req.userDoc._id));
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
        logger.error("[contracts] Failed to fetch contract status:", { error: error.message });
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
        logger.error("[contracts] Failed to cancel contract:", { error: error.message });
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
        logger.error("[contracts] Failed to accept contract:", { error: error.message });
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

        // F-11: a resolved dispute is terminal; the review note stays the one
        // authoritative record, so a party cannot reopen or mutate it.
        if (contract.disputeState === "resolved") {
            return res.status(409).json({
                error: "This dispute has already been resolved",
                code: "DISPUTE_RESOLVED"
            });
        }

        if (req.body?.reason != null && typeof req.body.reason !== "string") {
            return res.status(400).json({ error: "Dispute reason must be text" });
        }
        const reason = (req.body?.reason || "").trim();
        if (reason.length > MAX_DISPUTE_REASON_LENGTH) {
            return res.status(400).json({ error: "Dispute reason is too large" });
        }

        // F-12: clients may send the reason wrapped in an RSA-OAEP envelope for
        // the admin review key. When an envelope is present the plaintext reason
        // is NOT persisted (admin-only confidentiality); legacy clients keep the
        // plaintext path for backward compatibility.
        let encryptedReason = "";
        if (req.body?.encryptedReason != null && req.body.encryptedReason !== "") {
            encryptedReason = validateCiphertext(
                req.body.encryptedReason,
                "Encrypted dispute reason"
            );
        }

        const isUserA = participantRole(contract, req.userDoc._id) === "userA";
        const disputeField = isUserA ? "disputedUserA" : "disputedUserB";
        const agreeField = isUserA ? "agreedUserA" : "agreedUserB";
        const reasonField = isUserA ? "disputeReasonUserA" : "disputeReasonUserB";
        const encryptedReasonField = isUserA
            ? "disputeReasonEncryptedUserA"
            : "disputeReasonEncryptedUserB";
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
                    [reasonField]: encryptedReason ? "" : reason,
                    [encryptedReasonField]: encryptedReason,
                    [disputedAtField]: new Date(),
                    status: "disputed",
                    statusBeforeDispute: contract.status === "disputed"
                        ? (contract.statusBeforeDispute || "active")
                        : contract.status,
                    disputeState: "open",
                    resolutionOutcome: null,
                    resolutionNote: "",
                    resolvedAt: null,
                    resolvedBy: ""
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
        void ensureSupportThread(updated._id, req.userDoc._id).catch((error) => {
            logger.error("[support] Failed to open dispute thread:", { error: error.message });
        });
        void notifyBestEffort(
            otherUser,
            "contract_disputed",
            "",
            {
                // F-12: the plaintext dispute reason no longer travels in the
                // push data payload (notifications are not encrypted).
                type: "contractDispute",
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
        logger.error("[contracts] Failed to dispute contract:", { error: error.message });
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
        if (typeof providedHash !== "string" || !providedHash || !providedHash.trim()) {
            return res.status(400).json({ error: "Hash is required" });
        }

        // F-40: normalize both sides the same way the object-store did at
        // creation (trim, collapse whitespace, lowercase), cap the length, and
        // compare digests in constant time instead of a raw === compare.
        const normalizedProvided = String(providedHash)
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
        if (normalizedProvided.length > 512) {
            return res.status(400).json({ error: "Hash is too large" });
        }

        const storedHash = String(contract.hash || contract.detailsHash || "")
            .trim()
            .replace(/\s+/g, " ")
            .toLowerCase();
        if (!storedHash) {
            return res.status(404).json({ error: "No hash stored for this contract" });
        }

        return res.json({
            success: true,
            matches: timingSafeHexEqual(storedHash, normalizedProvided),
            hashType: contract.hash ? "contract" : "details"
        });
    } catch (error) {
        logger.error("[contracts] Failed to verify contract:", { error: error.message });
        return res.status(500).json({ error: "Failed to verify contract" });
    }
};

/** List caller-visible contracts without leaking the other encrypted envelope. */
export const getContracts = async (req, res) => {
    logger.info("[contracts] list requested");
    try {
        const userId = req.userDoc._id.toString();

        // F-14: bounded pages instead of an unbounded embedded-array scan; the
        // mobile client walks pages until hasMore is false.
        const limit = parseLimit(req.query.limit, { defaultValue: 50, max: 100 });
        const offset = parseOffset(req.query.offset, { defaultValue: 0 });

        const query = {
            $or: [{ userA: req.userDoc._id }, { userB: req.userDoc._id }]
        };
        const [total, contracts] = await Promise.all([
            Contract.countDocuments(query),
            Contract.find(query)
                .populate("userA", "firstName lastName publicKey")
                .populate("userB", "firstName lastName publicKey")
                .sort({ updatedAt: -1 })
                .skip(offset)
                .limit(limit)
        ]);

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
                disputedAtUserA: contract.disputedAtUserA,
                disputedAtUserB: contract.disputedAtUserB,
                hash: contract.hash,
                isUserA,
                createdAt: contract.createdAt,
                updatedAt: contract.updatedAt
            }];
        });

        return res.json({
            success: true,
            contracts: mappedContracts,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + mappedContracts.length < total
            }
        });
    } catch (error) {
        logger.error("[contracts] Failed to fetch contracts:", { error: error.message });
        return res.status(500).json({ error: "Failed to fetch contracts" });
    }
};