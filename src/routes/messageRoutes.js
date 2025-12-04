import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";


import {
    sendMessage,
    getAllMessages
} from "../controllers/messageController.js";

const router = express.Router();

router.post("/send", auth, checkContractPermission, sendMessage); // send a message
router.get("/all", auth, checkContractPermission, getAllMessages); // get all messages

export default router;
