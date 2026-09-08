import express from "express";
import auth from "../middleware/auth.js";
import requireVerifiedEmail from "../middleware/requireVerifiedEmail.js";
import { accountSetupLimiter, userWriteLimiter } from "../middleware/rateLimiters.js";

import {
    finalizeAccount,
    getProfile,
    registerFcmToken,
    unregisterFcmToken,
    updatePrivateKey,
    updateProfile
} from "../controllers/userController.js";

const router = express.Router();

router.post("/finalize", auth, accountSetupLimiter, requireVerifiedEmail, finalizeAccount);   // Finalize account with name + keys
router.get("/profile", auth, getProfile);          // Get user profile with keys
router.put("/private-key", auth, userWriteLimiter, requireVerifiedEmail, updatePrivateKey); // Update encrypted private key
router.put("/profile", auth, userWriteLimiter, requireVerifiedEmail, updateProfile);       // Update profile (name only)
router.post("/fcm-token/register", auth, userWriteLimiter, registerFcmToken);
router.post("/fcm-token/unregister", auth, userWriteLimiter, unregisterFcmToken);

export default router;

