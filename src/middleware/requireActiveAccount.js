export default function requireActiveAccount(req, res, next) {
    if (!req.emailVerified) {
        return res.status(403).json({
            error: "Email must be verified before using contracts",
            code: "EMAIL_NOT_VERIFIED",
        });
    }
    if (
        !req.userDoc?.isComplete ||
        !req.userDoc.publicKey ||
        !req.userDoc.encryptedPrivateKey
    ) {
        return res.status(409).json({
            error: "Account setup and encryption keys must be completed first",
            code: "ACCOUNT_INCOMPLETE",
        });
    }
    next();
}
