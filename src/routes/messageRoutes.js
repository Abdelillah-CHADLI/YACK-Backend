import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";


import {
    sendMessage,
} from "../controllers/contractController.js";

const router = express.Router();

router.post("/send", auth, checkContractPermission, sendMessage); // send a message