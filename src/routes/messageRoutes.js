import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";
import requireActiveAccount from "../middleware/requireActiveAccount.js";


import {
    sendMessage,
    getAllMessages
} from "../controllers/messageController.js";

const router = express.Router();

router.post("/send", auth, requireActiveAccount, checkContractPermission, sendMessage);
router.get("/all", auth, requireActiveAccount, checkContractPermission, getAllMessages);

export default router;
