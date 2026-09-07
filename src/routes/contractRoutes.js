// src/routes/contractRoutes.js

import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";
import requireActiveAccount from "../middleware/requireActiveAccount.js";

import {
    createContract,
    joinContract,
    signContract,
    acceptContract,
    disputeContract,
    verifyContract,
    getContracts,
    getTempContractStatus,
    cancelTempContract
} from "../controllers/contractController.js";

const router = express.Router();

router.post("/create", auth, requireActiveAccount, createContract);
router.post("/join", auth, requireActiveAccount, joinContract);
router.post("/sign", auth, requireActiveAccount, signContract);

// Recovery endpoints for clients that miss or cannot receive push events.
router.get("/temp/status", auth, requireActiveAccount, getTempContractStatus);
router.delete("/temp/:tempID", auth, requireActiveAccount, cancelTempContract);

router.post("/accept", auth, requireActiveAccount, checkContractPermission, acceptContract);
router.post("/dispute", auth, requireActiveAccount, checkContractPermission, disputeContract);
router.get("/verify", auth, requireActiveAccount, checkContractPermission, verifyContract);
router.get("/list", auth, requireActiveAccount, getContracts);


export default router;
