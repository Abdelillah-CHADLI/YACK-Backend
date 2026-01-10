import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";

import {
    sendMedia,
    getAllMedia,
    getMedia,
    getMediaUrl
} from "../controllers/mediaController.js";

const router = express.Router();

router.post("/send", auth, checkContractPermission, sendMedia);
router.get("/all", auth, checkContractPermission, getAllMedia);
router.get("/get", auth, checkContractPermission, getMedia);
router.get("/url", auth, checkContractPermission, getMediaUrl);

export default router;
