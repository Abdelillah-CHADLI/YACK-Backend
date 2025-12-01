// src/routes/contractRoutes.js

import express from "express";
import auth from "../middleware/auth.js";

import {
    createContract,
    joinContract,
    signContract
} from "../controllers/contractController.js";

const router = express.Router();

router.post("/create", auth, createContract);
router.post("/join", auth, joinContract);
router.post("/sign", auth, signContract);

export default router;
