// src/routes/contractRoutes.js

import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";
import requireActiveAccount from "../middleware/requireActiveAccount.js";
import { disputeLimiter, userWriteLimiter } from "../middleware/rateLimiters.js";

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

router.post("/create", auth, userWriteLimiter, requireActiveAccount, createContract);
router.post("/join", auth, userWriteLimiter, requireActiveAccount, joinContract);
router.post("/sign", auth, userWriteLimiter, requireActiveAccount, signContract);

// Recovery endpoints for clients that miss or cannot receive push events.
// The status GET stays auth-only (F-34): a prospective participant may poll
// an invitation before finishing account setup, which requireActiveAccount
// would wrongly block.
router.get("/temp/status", auth, getTempContractStatus);
router.delete("/temp/:tempID", auth, userWriteLimiter, requireActiveAccount, cancelTempContract);

router.post("/accept", auth, userWriteLimiter, requireActiveAccount, checkContractPermission, acceptContract);
router.post("/dispute", auth, disputeLimiter, requireActiveAccount, checkContractPermission, disputeContract);
router.get("/verify", auth, requireActiveAccount, checkContractPermission, verifyContract);
router.get("/list", auth, requireActiveAccount, getContracts);


export default router;
