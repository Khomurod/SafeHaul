/**
 * The origin a signing link may be built on. A link carries the document's
 * access token, so a base URL that came from a browser (a guest's or a team
 * member's) is kept only when it is one of the app's own Hosting sites:
 * Production and Testing, each also served at `.web.app` and
 * `.firebaseapp.com` (`src/app/startup/site.js` names the same hosts). Anything
 * else falls back to the configured base URL.
 */
const APP_HOSTS = new Set([
    'app.safehaul.io',
    'safehaul-app-production.web.app',
    'safehaul-app-production.firebaseapp.com',
    'truckerapp-system.web.app',
    'truckerapp-system.firebaseapp.com',
]);

const DEFAULT_APP_BASE_URL = 'https://app.safehaul.io';

/** `candidate`'s origin when it is one of the app's sites, else the configured base URL. */
function trustedAppBaseUrl(candidate) {
    try {
        const url = new URL(String(candidate || '').trim());
        if (url.protocol === 'https:' && !url.port && APP_HOSTS.has(url.hostname.toLowerCase())) {
            return url.origin;
        }
    } catch {
        // Not a URL: the configured base below.
    }
    return process.env.APP_BASE_URL || DEFAULT_APP_BASE_URL;
}

module.exports = { APP_HOSTS, DEFAULT_APP_BASE_URL, trustedAppBaseUrl };
