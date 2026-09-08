// src/middleware/requireVerifiedEmail.js
//
// Write-side gate (F-35): account-creation and profile mutations require a
// verified Firebase email. `req.emailVerified` is populated by the auth
// middleware (including the live-record refresh for stale tokens).

export default function requireVerifiedEmail(req, res, next) {
    if (req.emailVerified !== true) {
        return res.status(403).json({
            error: "Email must be verified to perform this action",
            code: "EMAIL_NOT_VERIFIED",
        });
    }
    next();
}