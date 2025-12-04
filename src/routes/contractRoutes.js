// src/routes/contractRoutes.js

import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";

import {
    createContract,
    joinContract,
    signContract,
    acceptContract,
    disputeContract,
    verifyContract
} from "../controllers/contractController.js";

const router = express.Router();

router.post("/create", auth, createContract); // create a contract to be joined
router.post("/join", auth, joinContract); // join a contract
router.post("/sign", auth, signContract); // sign a contract


router.post("/accept", auth, checkContractPermission, acceptContract);
router.post("/dispute", auth,checkContractPermission , disputeContract);
router.get("/verify",auth, checkContractPermission, verifyContract); // verify contract hash


export default router;
