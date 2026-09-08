function configuredAdminEmails() {
    return new Set(
        String(process.env.ADMIN_EMAILS || "")
            .split(",")
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean)
    );
}

export default function adminAuth(req, res, next) {
    const email = String(req.firebaseUser?.email || "").trim().toLowerCase();
    const hasAdminClaim = req.firebaseUser?.admin === true
        || req.firebaseUser?.role === "admin";
    const isAllowlisted = email && configuredAdminEmails().has(email);

    if (!req.emailVerified || (!hasAdminClaim && !isAllowlisted)) {
        return res.status(403).json({
            error: "Administrator access required",
            code: "ADMIN_REQUIRED",
        });
    }

    req.adminIdentity = {
        uid: req.firebaseUser.uid,
        email,
    };
    next();
}
