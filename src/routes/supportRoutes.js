import express from "express";

import {
    getReviewPublicKey,
    getUserSupportThread,
    grantReviewAccess,
    sendUserSupportMessage,
} from "../controllers/supportController.js";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";
import requireActiveAccount from "../middleware/requireActiveAccount.js";

const router = express.Router();

router.get("/review-key", auth, getReviewPublicKey);
router.get(
    "/thread",
    auth,
    requireActiveAccount,
    checkContractPermission,
    getUserSupportThread
);
router.post(
    "/review-access",
    auth,
    requireActiveAccount,
    checkContractPermission,
    grantReviewAccess
);
router.post(
    "/messages",
    auth,
    requireActiveAccount,
    checkContractPermission,
    sendUserSupportMessage
);

export default router;
