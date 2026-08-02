/**
 * Phone/line helpers for the SMS number-assignment UI.
 * Extracted verbatim from NumberAssignmentManager.jsx.
 */

// Non-phone option token for a configured line that is missing from the synced
// inventory (see NumberAssignmentManager for the full DLP/redaction rationale).
export const MISSING_TOKEN = '__missing__';

// Canonical E.164 normalization. Mirrors functions/shared/normalizePhone so that a
// number stored in any format -- "(555) 123-4567", "5551234567", "15551234567",
// "+15551234567" -- collapses to the SAME string the synced inventory uses
// (+15551234567). Without this, an assigned/default line saved in a different format
// silently fails to match its inventory entry: the per-recruiter row falls back to a
// "Missing from sync" warning and the Company Default Line shows "-- Select --" even
// though the line is configured and actively sending. Normalizing here also means the
// value we write on Save is already canonical, so future linking stays consistent.
export const sanitizePhone = (num) => {
    if (!num) return "";
    const str = String(num);
    const digits = str.replace(/[^0-9]/g, '');
    // No actual digits (e.g. "", "+", punctuation-only) -> treat as empty, so the
    // verify button never renders and we never send the bare "+" to the backend.
    if (digits.length === 0) return "";
    // Preserve numbers that already carry an explicit "+" prefix EXACTLY as stored.
    // The synced inventory and the per-line keychain entries are keyed by this same
    // "+ then digits" form (see functions normalizePhoneForKeychain), so rewriting a
    // country code here would break inventory matching and line verification.
    if (str.trim().startsWith('+')) return `+${digits}`;
    // No "+" at all: apply US/CA normalization so a line saved as "(555) 123-4567",
    // "5551234567" or "15551234567" collapses to the +1XXXXXXXXXX form the synced
    // inventory uses -- otherwise the dropdown can't find a matching option and the
    // line silently reads as unassigned even though it's configured and sending.
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
};

export const lineDisplay = (label, phone, idx, suffix) => {
    const name = (label && String(label).trim()) || `Line ${idx + 1}`;
    const base = phone ? `${name} (${phone})` : name;
    return suffix ? `${base} ${suffix}` : base;
};

/**
 * Build the stable-token line model from the synced inventory.
 *
 * Some browsers/extensions (corporate DLP tools, embedded/AI browsers) strip
 * phone-like text AND attribute values out of the page. When an <option value> is the
 * raw phone number it gets blanked, the <select> can no longer match its current value,
 * and every line silently collapses to the first option ("No Direct Line"). Using the
 * backend-provided stable lineId as the option value keeps selection working even when
 * inventory rows are reordered. The stored value (assignments / defaultPhoneNumber)
 * stays the real phone number — only the dropdown's internal value changes.
 */
export function buildLineModel(inventory) {
    const lines = inventory.map((num, idx) => ({
        token: num.lineId || num.id || `ln${idx}`,
        phone: sanitizePhone(num.phoneNumber),
        label: num.label,
        usageType: num.usageType,
    }));
    // Only ever match a NON-empty phone. Otherwise, if a line's phone resolves to "" (e.g.
    // a browser/DLP layer strips phone numbers out of the data the page receives), an
    // unassigned recruiter's empty currentPhone would "match" the first empty-phone line and
    // every row would collapse to showing that line ("Main Number"), and selecting another
    // line couldn't stick. Guarding on a non-empty phone keeps unassigned = "No Direct Line"
    // and makes selection exact.
    const resolveLineToken = (token) => {
        if (!token) return '';
        if (lines.some(l => l.token === token)) return token;
        const legacyMatch = String(token).match(/^ln(\d+)$/);
        if (legacyMatch) return lines[Number(legacyMatch[1])]?.token || token;
        return token;
    };
    const tokenForPhone = (phone) => (phone ? (lines.find(l => l.phone === phone)?.token || '') : '');
    const phoneForToken = (token) => lines.find(l => l.token === resolveLineToken(token))?.phone || '';

    return { lines, resolveLineToken, tokenForPhone, phoneForToken };
}
