// src/controllers/contractController.js

import TempContract from "../models/TempContract.js";
import Contract from "../models/Contract.js";
import User from "../models/User.js";

import { sendNotification } from "../utils/sendNotification.js";
import mongoose from "mongoose";

/**
 * Create temporary contract
 */
export const createContract = async (req, res) => {
    try {
        const { hash } = req.body;

        const temp = await TempContract.create({
            userA: req.userDoc._id,
            hash: hash || ""
        });

        res.json({ success: true, tempID: temp._id });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create temp contract" });
    }
};


/**
 * Join temporary contract
 */
export const joinContract = async (req, res) => {
    try {
        const { tempID, hash } = req.body;

        if (hash && typeof hash !== "string") {
            return res.status(400).json({ error: "Invalid hash format" });
        }

        // Validate ID
        if (!mongoose.Types.ObjectId.isValid(tempID)) {
            return res.status(400).json({ error: "Invalid contract ID" });
        }

        const temp = await TempContract.findById(tempID);
        if (!temp) {
            return res.status(404).json({ error: "Temp contract not found" });
        }

        if (temp.hash) {
            if (!hash) {
                return res.status(400).json({ error: "Contract hash required" });
            }

            if (temp.hash !== hash) {
                return res.status(403).json({ error: "Contract hash mismatch" });
            }
        }

        if (temp.userB) {
            return res.status(400).json({ error: "Contract already joined" });
        }

        // Add user B
        temp.userB = req.userDoc._id;
        await temp.save();

        // Fetch userA data
        const userA = await User.findById(temp.userA).select("firstName lastName");

        // Notify userA
        sendNotification(
            temp.userA,
            "Contract Update",
            `${req.userDoc.firstName} joined your contract.`,
            {
                type: 'contractJoin',
                userId: temp.userB.toString(),
                username: req.userDoc.firstName
            }
        );

        // Return success + userA info
        res.json({
            success: true,
            userAFullName: userA?.firstName + " " + userA?.lastName|| "",
            userId: userA?._id
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to join contract" });
    }
};


/**
 * accept contract
 */
export const signContract = async (req, res) => {
    try {
        const { tempID } = req.body;

        const temp = await TempContract.findById(tempID);
        if (!temp) return res.status(404).json({ error: "Temp contract not found" });

        const uid = req.userDoc._id.toString();

        if (uid === temp.userA?.toString()) {
            temp.userASign = true;
        } else if (uid === temp.userB?.toString()) {
            temp.userBSign = true;
        } else {
            return res.status(403).json({ error: "Not your contract" });
        }

        await temp.save();

        // notify other user
        const other = uid === temp.userA?.toString() ? temp.userB : temp.userA;
        if (other) sendNotification(other,
            "Contract Update",
            "The other user signed.",
            {
                type: 'contractSign',
                userId: uid,
                username: req.userDoc.firstName
            });

        // if both signed => finalize
        if (temp.userASign && temp.userBSign) {
            const final = await Contract.create({
                userA: temp.userA,
                userB: temp.userB,
                userASign: true,
                userBSign: true,
                status: "active",
                hash: temp.hash || ""
            });

            await temp.deleteOne();

            return res.json({
                success: true,
                completed: true,
                contractID: final._id
            });
        }

        res.json({ success: true, signed: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to sign contract" });
    }
};

/**
 * accept contract
 */
export const acceptContract = async (req, res) => {
    try {
        const contract = req.contract;
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const uid = req.userDoc._id.toString();
        const isUserA = contract.userA.toString() === uid;

        if (contract.disputedUserA || contract.disputedUserB) {
            return res.status(400).json({ error: "Contract is disputed" });
        }

        const agreeField = isUserA ? "agreedUserA" : "agreedUserB";
        if (contract[agreeField]) {
            return res.status(400).json({ error: "Contract already accepted" });
        }

        contract[agreeField] = true;

        if (contract.agreedUserA && contract.agreedUserB) {
            contract.status = "completed";
        }

        await contract.save();

        const otherUser = isUserA ? contract.userB : contract.userA;
        if (otherUser) {
            sendNotification(
                otherUser,
                "Contract Accepted",
                `${req.userDoc.firstName} accepted the contract.`,
                {
                    type: "contractAccept",
                    userId: uid,
                    username: req.userDoc.firstName
                }
            );
        }

        res.json({
            success: true,
            status: contract.status,
            agreedUserA: contract.agreedUserA,
            agreedUserB: contract.agreedUserB
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to accept contract" });
    }
};

/**
 * dispute contract
 */
export const disputeContract = async (req, res) => {
    try {
        const contract = req.contract;
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const { reason = "" } = req.body || {};

        if ( contract.status === "completed" ){
            return res.status(400).json({ error: "Completed contract cannot be disputed" });
        }

        const uid = req.userDoc._id.toString();
        const isUserA = contract.userA.toString() === uid;


        const disputeField = isUserA ? "disputedUserA" : "disputedUserB";

        if (contract[disputeField]) {
            return res.status(400).json({ error: "Contract already disputed" });
        }

        contract[disputeField] = true;
        if (isUserA) {
            contract.agreedUserA = false;
        } else {
            contract.agreedUserB = false;
        }

        contract.status = "dispatched";

        await contract.save();

        const otherUser = isUserA ? contract.userB : contract.userA;
        if (otherUser) {
            sendNotification(
                otherUser,
                "Contract Disputed",
                `${req.userDoc.firstName} disputed the contract.`,
                {
                    type: "contractDispute",
                    reason,
                    userId: uid,
                    username: req.userDoc.firstName
                }
            );
        }

        res.json({
            success: true,
            status: contract.status,
            disputedUserA: contract.disputedUserA,
            disputedUserB: contract.disputedUserB
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to dispute contract" });
    }
};

/**
 * Verify contract hash
 * @param req
 * @param res
 * @returns {Promise<*>}
 */
export const verifyContract = async (req, res) => {
    try {
        const contract = req.contract;
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const providedHash = req.body?.hash || req.query?.hash || req.params?.hash;
        if (!providedHash) {
            return res.status(400).json({ error: "Hash is required" });
        }

        if (!contract.hash) {
            return res.status(404).json({ error: "No hash stored for this contract" });
        }

        const matches = contract.hash === providedHash;

        res.json({ success: true, matches });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to verify contract" });
    }
};

export const getContracts = async (req, res) => {
    try {
        const userId = req.userDoc._id;
        const contracts = await Contract.find({
            $or: [{ userA: userId }, { userB: userId }]
        }).sort({ updatedAt: -1 });

        res.json({ success: true, contracts });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch contracts" });
    }
};