export function normalizeFcmToken(value) {
    if (typeof value !== "string") return null;
    const token = value.trim();
    if (token.length < 20 || token.length > 4096 || /\s/.test(token)) return null;
    return token;
}
