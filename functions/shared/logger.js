/**
 * E2 — Thin structured logger (backend).
 *
 * Emits a single JSON line with a `severity` field, which Cloud Logging parses
 * into severity / jsonPayload automatically. Context is run through the A5
 * scrubber so PII never reaches Cloud Logging.
 *
 * Intentionally additive: existing console.* calls keep working. Adopt this
 * incrementally; a no-console lint ban can follow once migration is complete.
 */

const { scrub } = require('./scrub');

function emit(severity, message, ctx = {}) {
    let line;
    try {
        line = JSON.stringify({ severity, message, ...scrub(ctx) });
    } catch {
        // Never let logging throw (e.g. unserializable / circular context).
        line = JSON.stringify({ severity, message, ctxError: 'unserializable' });
    }
    // eslint-disable-next-line no-console
    (severity === 'ERROR' ? console.error : console.log)(line);
}

module.exports = {
    info: (message, ctx) => emit('INFO', message, ctx),
    warn: (message, ctx) => emit('WARNING', message, ctx),
    error: (message, ctx) => emit('ERROR', message, ctx),
};
