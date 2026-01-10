import express from "express";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";

import {
    sendMedia,
    getAllMedia,
    getMedia
} from "../controllers/mediaController.js";

const router = express.Router();

router.post("/send", auth, checkContractPermission, sendMedia);
router.get("/all", auth, checkContractPermission, getAllMedia);
router.get("/get", auth, checkContractPermission, getMedia);

export default router;
