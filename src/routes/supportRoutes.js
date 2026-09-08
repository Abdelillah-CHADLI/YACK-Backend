import express from "express";

import {
    getReviewPublicKey,
    getUserSupportThread,
    grantReviewAccess,
    sendUserSupportMessage,
    uploadSupportAttachment,
    getSupportAttachments,
    deleteSupportAttachment,
} from "../controllers/supportController.js";
import auth from "../middleware/auth.js";
import checkContractPermission from "../middleware/contractPermission.js";
import requireActiveAccount from "../middleware/requireActiveAccount.js";
import { userWriteLimiter } from "../middleware/rateLimiters.js";

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
    userWriteLimiter,
    requireActiveAccount,
    checkContractPermission,
    grantReviewAccess
);
router.post(
    "/messages",
    auth,
    userWriteLimiter,
    requireActiveAccount,
    checkContractPermission,
    sendUserSupportMessage
);
router.post(
    "/attachments",
    auth,
    userWriteLimiter,
    requireActiveAccount,
    checkContractPermission,
    uploadSupportAttachment
);
router.get(
    "/attachments",
    auth,
    requireActiveAccount,
    checkContractPermission,
    getSupportAttachments
);
router.delete(
    "/attachments/:mediaId",
    auth,
    userWriteLimiter,
    requireActiveAccount,
    checkContractPermission,
    deleteSupportAttachment
);

export default router;
