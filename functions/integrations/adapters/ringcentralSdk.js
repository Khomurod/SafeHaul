/**
 * The one place a RingCentral SDK is built, so every RingCentral request has a
 * time limit.
 *
 * Under Node the SDK sends through node-fetch 2, which has no limit of its own:
 * a RingCentral that stops answering used to hold a send until the Cloud
 * Function was killed. node-fetch's `timeout` request option, passed through the
 * SDK's `defaultRequestInit`, reaches every request the SDK builds (log-in,
 * token refresh, sends and reads) and applies again to reading the answer.
 * Do not pass Node's built-in fetch as the SDK's `fetch`: its `Request` is
 * node-fetch's, and built-in fetch ignores `timeout`.
 */
const RC = require('@ringcentral/sdk').SDK;

const RINGCENTRAL_TIMEOUT_MS = 20000;

/** node-fetch's error when nothing came back in time, or the answer stalled. */
function isRingCentralTimeout(error) {
    return error?.type === 'request-timeout' || error?.type === 'body-timeout';
}

/**
 * One SDK's own token store. Under Node the SDK's default store is a single
 * module-wide object and every SDK uses the same key in it, so two SDKs alive in
 * one function instance (two lines, or two companies) would read, refresh or
 * erase each other's session. Each SDK gets a store of its own, dropped with it.
 */
class SessionStore {
    constructor() {
        this.items = new Map();
    }

    getItem(key) {
        return this.items.has(key) ? this.items.get(key) : null;
    }

    setItem(key, value) {
        this.items.set(key, String(value));
    }

    removeItem(key) {
        this.items.delete(key);
    }

    keys() {
        return [...this.items.keys()];
    }
}

function createRingCentralSdk({ server, clientId, clientSecret }, timeoutMs = RINGCENTRAL_TIMEOUT_MS) {
    return new RC({
        server,
        clientId,
        clientSecret,
        defaultRequestInit: { timeout: timeoutMs },
        localStorage: new SessionStore(),
    });
}

module.exports = { RINGCENTRAL_TIMEOUT_MS, createRingCentralSdk, isRingCentralTimeout };
