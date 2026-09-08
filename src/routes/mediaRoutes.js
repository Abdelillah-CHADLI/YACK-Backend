import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";
import requireActiveAccount from "../middleware/requireActiveAccount.js";
import { mediaUploadLimiter } from "../middleware/rateLimiters.js";

import {
    sendMedia,
    getAllMedia,
    getMedia
} from "../controllers/mediaController.js";

const router = express.Router();

router.post("/send", auth, mediaUploadLimiter, requireActiveAccount, checkContractPermission, sendMedia);
router.get("/all", auth, requireActiveAccount, checkContractPermission, getAllMedia);
router.get("/get", auth, requireActiveAccount, checkContractPermission, getMedia);

export default router;
