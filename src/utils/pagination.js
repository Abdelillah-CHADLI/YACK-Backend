// src/utils/pagination.js
//
// Shared list-pagination parsing (F-14). The previous "always return
// everything" behavior on contract lists, media lists and dispute lists is
// replaced by bounded limits so a single abusive account cannot make one
// request balloon the response.

export function parseLimit(value, { defaultValue = 100, max = 100 } = {}) {
    if (value == null || value === "") return defaultValue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
    return Math.min(Math.floor(parsed), max);
}

export function parseOffset(value, { defaultValue = 0 } = {}) {
    if (value == null || value === "") return defaultValue;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return defaultValue;
    return Math.floor(parsed);
}