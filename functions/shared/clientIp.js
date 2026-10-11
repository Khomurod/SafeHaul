// functions/shared/clientIp.js
//
// The caller's address as Google's front end saw it.
//
// The front end appends the address it saw to X-Forwarded-For, after whatever
// the caller sent in that header. Everything before the last entry is the
// caller's to write, and Express's `req.ip` is the FIRST entry here (the
// functions framework trusts every proxy), so neither proves anything.

const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;

/** @returns {string} the address the front end appended, or '0.0.0.0' */
function trustedClientIp(req) {
    const header = req?.headers?.['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : String(header || ''))
        .split(',').map((entry) => entry.trim()).filter(Boolean);
    // No header at all (the emulator, a test): Express's own address is the socket's.
    const address = entries.length > 0 ? entries[entries.length - 1] : String(req?.ip || '');
    return ADDRESS.test(address) ? address : '0.0.0.0';
}

module.exports = { trustedClientIp };
