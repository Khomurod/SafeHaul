// functions/shared/clientIp.js
//
// The caller's address as Google's front end saw it.
//
// The front end appends what it saw to X-Forwarded-For, after whatever the
// caller sent in that header, and a proxy of Google's may follow it. Everything
// left of the front end's entries is the caller's to write, and Express's
// `req.ip` is the FIRST entry here (the functions framework trusts every proxy),
// so neither proves anything.

const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;

// Google's front-end proxy ranges (as load-balancer backends see them), and
// private, loopback and link-local space: never where a signer connects from.
const NOT_A_CLIENT_V4 = [
    ['35.191.0.0', 16], ['130.211.0.0', 22],
    ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16],
];

function v4ToInt(address) {
    const parts = address.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

function isNotAClient(address) {
    const v4 = v4ToInt(address);
    if (v4 !== null) {
        return NOT_A_CLIENT_V4.some(([base, bits]) => Math.floor(v4 / 2 ** (32 - bits)) === Math.floor(v4ToInt(base) / 2 ** (32 - bits)));
    }
    const lower = address.toLowerCase();
    return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

function forwardedEntries(req) {
    const header = req?.headers?.['x-forwarded-for'];
    return (Array.isArray(header) ? header.join(',') : String(header || ''))
        .split(',').map((entry) => entry.trim()).filter(Boolean);
}

/**
 * Walks X-Forwarded-For from the right, past Google's own proxies, to the first
 * address that could be the caller's: the one the front end saw. The caller can
 * only write further left.
 *
 * @returns {string} that address, or '0.0.0.0'
 */
function trustedClientIp(req) {
    const entries = forwardedEntries(req);
    // No header at all (the emulator, a test): Express's own address is the socket's.
    if (entries.length === 0) return ADDRESS.test(String(req?.ip || '')) ? String(req.ip) : '0.0.0.0';
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (!ADDRESS.test(entries[i])) return '0.0.0.0';
        if (!isNotAClient(entries[i])) return entries[i];
    }
    return entries[entries.length - 1];
}

/** The whole X-Forwarded-For chain, cleaned and cut short, for an audit trail. */
function forwardedChain(req) {
    return forwardedEntries(req).join(', ').replace(/[^0-9A-Fa-f:., ]/g, '').slice(0, 256);
}

module.exports = { trustedClientIp, forwardedChain };
