import express from "express";
import auth from "../middleware/auth.js";

import {
    finalizeAccount,
    getProfile,
    registerFcmToken,
    unregisterFcmToken,
    updatePrivateKey,
    updateProfile
} from "../controllers/userController.js";

const router = express.Router();

router.post("/finalize", auth, finalizeAccount);   // Finalize account with name + keys
router.get("/profile", auth, getProfile);          // Get user profile with keys
router.put("/private-key", auth, updatePrivateKey); // Update encrypted private key
router.put("/profile", auth, updateProfile);       // Update profile (name only)
router.post("/fcm-token/register", auth, registerFcmToken);
router.post("/fcm-token/unregister", auth, unregisterFcmToken);

export default router;

