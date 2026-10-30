/**
 * Content Security Policy violations, forwarded to Sentry.
 *
 * The application sites ship their full policy as
 * `Content-Security-Policy-Report-Only` (`firebase.json`): the browser blocks
 * nothing and fires a `securitypolicyviolation` event instead. This module turns
 * those events into Sentry messages, so the policy can be checked against real
 * traffic before anyone enforces it, without a report endpoint or the DSN in
 * the hosting config.
 *
 * Only an origin or a CSP keyword ever leaves the browser. Blocked and source
 * URLs can carry tokens (`/verify/:token`, a Graph API `access_token`, a signed
 * Storage URL), so paths and queries are always dropped. Each distinct violation
 * is sent once per page load, and at most `limit` in total.
 */
import * as Sentry from '@sentry/react';

const DEFAULT_LIMIT = 20;
// A browser extension's own scripts and requests are not the app's to fix.
const EXTENSION_SCHEMES = new Set(['chrome-extension', 'moz-extension', 'safari-extension', 'safari-web-extension']);

function originOf(value) {
    if (!value) return '';
    try {
        const url = new URL(value);
        // `data:` has no origin and `blob:` borrows its creator's: name the scheme.
        return /^https?:$/.test(url.protocol) ? url.origin : url.protocol.slice(0, -1);
    } catch {
        // `inline`, `eval`, `data`, `blob`, `wasm-eval`, `trusted-types-…`.
        return String(value).split(':')[0];
    }
}

/**
 * What Sentry adds to every event by itself, cut down for a CSP report. The
 * page URL and Referer (HttpContext), the breadcrumbs (navigation and request
 * URLs) and the transaction name can all carry a path such as
 * `/verify/:token`; a CSP report needs none of them.
 */
function stripPageContext(event) {
    if (event.request) event.request = { url: originOf(event.request.url) };
    delete event.breadcrumbs;
    delete event.transaction;
    return event;
}

/**
 * Sends one message, or returns false when Sentry has no client yet: the
 * listener starts in the startup guards, before `main.jsx` calls `initSentry`.
 */
function defaultCapture(message, context) {
    if (!Sentry.getClient()) return false;
    Sentry.withScope((scope) => {
        scope.addEventProcessor(stripPageContext);
        Sentry.captureMessage(message, context);
    });
    return true;
}

/**
 * Starts listening. Returns a function that stops listening (for tests).
 */
export function reportCspViolations({ win = globalThis, capture = defaultCapture, limit = DEFAULT_LIMIT } = {}) {
    const target = win.document;
    if (!target?.addEventListener) return () => {};
    const seen = new Set();

    const onViolation = (event) => {
        const directive = event.effectiveDirective || event.violatedDirective || '';
        if (!directive || seen.size >= limit) return;
        const disposition = event.disposition || 'enforce';
        const blocked = originOf(event.blockedURI) || 'unknown';
        if (EXTENSION_SCHEMES.has(blocked) || EXTENSION_SCHEMES.has(originOf(event.sourceFile))) return;
        const key = `${disposition}|${directive}|${blocked}`;
        if (seen.has(key)) return;
        const sent = capture(`CSP ${disposition}: ${directive} ${blocked}`, {
            level: 'warning',
            fingerprint: ['csp-violation', disposition, directive, blocked],
            tags: { csp_disposition: disposition, csp_directive: directive, csp_blocked: blocked },
            extra: { sourceOrigin: originOf(event.sourceFile), lineNumber: event.lineNumber || 0 },
        });
        // Not sent (no client yet): leave it unseen, so a repeat once Sentry runs
        // is reported, and spend none of the limit on it.
        if (sent !== false) seen.add(key);
    };

    target.addEventListener('securitypolicyviolation', onViolation);
    return () => target.removeEventListener('securitypolicyviolation', onViolation);
}
