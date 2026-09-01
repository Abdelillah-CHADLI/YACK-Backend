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
        const { hash, titleUserA, descriptionUserA, priceUserA, detailsHash } = req.body;

        // Validate encrypted fields
        if (!titleUserA || typeof titleUserA !== "string") {
            return res.status(400).json({ error: "Encrypted title required" });
        }
        if (!descriptionUserA || typeof descriptionUserA !== "string") {
            return res.status(400).json({ error: "Encrypted description required" });
        }
        if (!priceUserA || typeof priceUserA !== "string") {
            return res.status(400).json({ error: "Encrypted price required" });
        }
        if (!detailsHash || typeof detailsHash !== "string") {
            return res.status(400).json({ error: "Details hash required" });
        }

        const temp = await TempContract.create({
            userA: req.userDoc._id,
            hash: hash || "",
            titleUserA: titleUserA.trim(),
            descriptionUserA: descriptionUserA.trim(),
            priceUserA: priceUserA.trim(),
            detailsHash: detailsHash.trim()
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
        const { tempID, hash, titleUserB, descriptionUserB, priceUserB } = req.body;

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

        // Validate encrypted fields for userB
        if (!titleUserB || typeof titleUserB !== "string") {
            return res.status(400).json({ error: "Encrypted title for userB required" });
        }
        if (!descriptionUserB || typeof descriptionUserB !== "string") {
            return res.status(400).json({ error: "Encrypted description for userB required" });
        }
        if (!priceUserB || typeof priceUserB !== "string") {
            return res.status(400).json({ error: "Encrypted price for userB required" });
        }

        // Add user B and their encrypted details
        temp.userB = req.userDoc._id;
        temp.titleUserB = titleUserB.trim();
        temp.descriptionUserB = descriptionUserB.trim();
        temp.priceUserB = priceUserB.trim();
        await temp.save();

        // Fetch userA data
        const userA = await User.findById(temp.userA).select("firstName lastName publicKey");

        // Notify userA
        await sendNotification(
            temp.userA,
            "contract_joined",
            "",
            {
                type: 'contractJoin',
                tempId: temp._id.toString(),
                userId: temp.userB.toString(),
                username: req.userDoc.firstName
            },
            {
                localize: true,
                params: {
                    name: req.userDoc.firstName
                }
            }
        );

        // Return success + userA info including public key for encryption
        res.json({
            success: true,
            userAFullName: userA?.firstName + " " + userA?.lastName || "",
            userId: userA?._id,
            userAPublicKey: userA?.publicKey || ""
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
        if (other) await sendNotification(
            other,
            "contract_signed",
            "",
            {
                type: 'contractSign',
                tempId: temp._id.toString(),
                userId: uid,
                username: req.userDoc.firstName
            },
            {
                localize: true,
                params: {
                    name: req.userDoc.firstName
                }
            }
        );

        // if both signed => finalize
        if (temp.userASign && temp.userBSign) {
            const final = await Contract.create({
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
            await sendNotification(
                otherUser,
                "contract_accepted",
                "",
                {
                    type: "contractAccept",
                    userId: uid,
                    username: req.userDoc.firstName,
                    contractId: contract._id.toString()
                },
                {
                    localize: true,
                    params: {
                        name: req.userDoc.firstName
                    }
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

        contract.status = "disputed";

        await contract.save();

        const otherUser = isUserA ? contract.userB : contract.userA;
        if (otherUser) {
            await sendNotification(
                otherUser,
                "contract_disputed",
                "",
                {
                    type: "contractDispute",
                    reason,
                    userId: uid,
                    username: req.userDoc.firstName,
                    contractId: contract._id.toString()
                },
                {
                    localize: true,
                    params: {
                        name: req.userDoc.firstName
                    }
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
        const userId = req.userDoc._id.toString();
        const contracts = await Contract.find({
            $or: [{ userA: req.userDoc._id }, { userB: req.userDoc._id }]
        })
            .populate("userA", "firstName lastName publicKey")
            .populate("userB", "firstName lastName publicKey")
            .sort({ updatedAt: -1 });

        // Map contracts to return only the caller's encrypted fields
        const mappedContracts = contracts.map(contract => {
            const isUserA = contract.userA._id.toString() === userId;
            const otherUser = isUserA ? contract.userB : contract.userA;

            return {
                _id: contract._id,
                otherUser: {
                    _id: otherUser._id,
                    firstName: otherUser.firstName,
                    lastName: otherUser.lastName,
                    publicKey: otherUser.publicKey
                },
                title: isUserA ? contract.titleUserA : contract.titleUserB,
                description: isUserA ? contract.descriptionUserA : contract.descriptionUserB,
                price: isUserA ? contract.priceUserA : contract.priceUserB,
                detailsHash: contract.detailsHash,
                status: contract.status,
                userASign: contract.userASign,
                userBSign: contract.userBSign,
                agreedUserA: contract.agreedUserA,
                agreedUserB: contract.agreedUserB,
                disputedUserA: contract.disputedUserA,
                disputedUserB: contract.disputedUserB,
                hash: contract.hash,
                isUserA,
                createdAt: contract.createdAt,
                updatedAt: contract.updatedAt
            };
        });

        res.json({ success: true, contracts: mappedContracts });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch contracts" });
    }
};