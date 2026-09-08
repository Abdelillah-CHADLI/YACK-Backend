import express from "express";

import {
    getAdminIdentity,
    getAnalytics,
    getDispute,
    listDisputes,
    resolveDispute,
    sendAdminSupportMessage,
} from "../controllers/adminController.js";
import adminAuth from "../middleware/adminAuth.js";
import auth from "../middleware/auth.js";

const router = express.Router();

router.use(auth, adminAuth);
router.get("/me", getAdminIdentity);
router.get("/analytics", getAnalytics);
router.get("/disputes", listDisputes);
router.get("/disputes/:contractId", getDispute);
router.post("/disputes/:contractId/resolve", resolveDispute);
router.post(
    "/disputes/:contractId/support/:userId/messages",
    sendAdminSupportMessage
);

export default router;
