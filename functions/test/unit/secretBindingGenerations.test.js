/**
 * Which function generation binds which secret — asserted, because getting it
 * wrong fails the whole Cloud Functions deploy.
 *
 * ## The failure this exists to prevent
 *
 * On 2026-08-19 a green pull request merged and `main` shipped nothing. Four new
 * **1st-generation** callables declared `secrets: ['SMS_ENCRYPTION_KEY']`, and
 * every previous consumer of that secret was **2nd generation**. The two
 * generations default to different runtime service accounts — App Engine for v1,
 * Compute Engine for v2 — so the Firebase CLI tried to add a binding the secret's
 * IAM policy did not have:
 *
 *     i functions: ensuring truckerapp-system@appspot.gserviceaccount.com
 *                  access to secret SMS_ENCRYPTION_KEY.
 *     Error: ... Permission 'secretmanager.secrets.setIamPolicy' denied
 *
 * The CI deploy account can deploy functions but cannot rewrite secret IAM. So
 * `deploy-functions` aborted — for **every** function, not only the new ones —
 * and the shared backend that Production also runs on stayed on the previous
 * revision. `verify-shipped` caught it, which is the only reason anybody knew.
 *
 * Nothing in the test suite could have caught it: the functions load fine, the
 * unit tests pass, and a pull request never deploys. This test is the guard.
 *
 * ## What to do when it fails
 *
 * It fails when a secret gains a generation it did not have. That is not
 * necessarily wrong — it just cannot ship until the matching runtime service
 * account can read the secret. Grant it first:
 *
 *     gcloud secrets add-iam-policy-binding <SECRET> \
 *       --project truckerapp-system \
 *       --member serviceAccount:<the account for that generation> \
 *       --role roles/secretmanager.secretAccessor
 *
 * v1 → `truckerapp-system@appspot.gserviceaccount.com`
 * v2 → `<project-number>-compute@developer.gserviceaccount.com`
 *
 * Then update the expectation below in the same change, so the next reader knows
 * the grant exists. Do **not** simply widen the expectation to make this pass:
 * the assertion is a claim about IAM that has been granted, not about code.
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.resolve(__dirname, '../..');

/**
 * The generations each secret is bound from, and therefore the runtime service
 * accounts that must be able to read it.
 *
 * `GROQ_API_KEY` is bound from both and always has been — `cdlParser.js` is 1st
 * generation and predates the AI platform — which is why both accounts already
 * have access to it and why adding `ai/callablesV1.js` needed no IAM change.
 */
const EXPECTED = Object.freeze({
    // Both accounts. v1 arrived with the guest application-draft callables and
    // needed a one-time grant to the App Engine account (see the header).
    SMS_ENCRYPTION_KEY: ['v1', 'v2'],
    // Both accounts, and always has been: `cdlParser.js` is 1st generation and
    // predates the AI platform. That is why adding `ai/callablesV1.js` needed no
    // IAM change while the draft callables did.
    GROQ_API_KEY: ['v1', 'v2'],
    // 2nd generation only. A 1st-generation function binding any of these needs
    // the App Engine account granted access first.
    BULK_WORKER_SECRET: ['v2'],
    PROCESS_BULK_BATCH_URL: ['v2'],
    FACEBOOK_APP_ID: ['v2'],
    FACEBOOK_APP_SECRET: ['v2'],
    FACEBOOK_VERIFY_TOKEN: ['v2'],
});

/** Every `.js` under `functions/`, excluding tests and dependencies. */
function sourceFiles(dir = FUNCTIONS_DIR, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'test' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, found);
        else if (entry.name.endsWith('.js')) found.push(full);
    }
    return found;
}

/**
 * Maps secret name → the set of generations that bind it.
 *
 * Read out of the real `secrets: [...]` declarations rather than a list, so a
 * new binding cannot be added without this test seeing it. A file importing both
 * generations counts for both, deliberately: this is a "which accounts must have
 * access" question, and the conservative answer is the correct one.
 */
function bindingsByGeneration() {
    const map = new Map();

    for (const file of sourceFiles()) {
        const source = fs.readFileSync(file, 'utf8');
        const declarations = source.match(/secrets:\s*\[[^\]]*\]/g) || [];
        if (declarations.length === 0) continue;

        const generations = [];
        if (/require\(['"]firebase-functions\/v1['"]\)/.test(source)) generations.push('v1');
        if (/require\(['"]firebase-functions\/v2/.test(source)) generations.push('v2');
        if (generations.length === 0) continue; // a registry or plain data module

        for (const declaration of declarations) {
            for (const raw of declaration.replace(/secrets:\s*\[/, '').replace(/\]$/, '').split(',')) {
                const name = raw.trim().replace(/^['"]|['"]$/g, '');
                // Skip interpolated or constant references: only literal, and only
                // things shaped like a secret name.
                if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) continue;
                if (!map.has(name)) map.set(name, new Set());
                for (const generation of generations) map.get(name).add(generation);
            }
        }
    }
    return map;
}

describe('secret bindings and function generations', () => {
    const actual = bindingsByGeneration();

    it('finds the secret bindings at all, so a silent pass is impossible', () => {
        expect(actual.size).toBeGreaterThan(0);
        expect(actual.has('SMS_ENCRYPTION_KEY')).toBe(true);
    });

    it('binds no secret from a generation whose service account was not granted access', () => {
        const unexpected = [];
        for (const [secret, generations] of actual) {
            const allowed = EXPECTED[secret];
            if (!allowed) {
                unexpected.push(`${secret} is bound but not declared in EXPECTED`);
                continue;
            }
            for (const generation of generations) {
                if (!allowed.includes(generation)) {
                    unexpected.push(
                        `${secret} is now bound from ${generation}, which EXPECTED does not list. `
                        + 'Grant that generation\'s runtime service account secretAccessor on it '
                        + 'BEFORE merging, or the whole functions deploy fails.',
                    );
                }
            }
        }
        expect(unexpected).toEqual([]);
    });

    it('keeps the expectation honest — no entry for a secret nothing binds', () => {
        // A stale entry would quietly license a future binding nobody granted.
        const stale = Object.keys(EXPECTED).filter((secret) => !actual.has(secret));
        expect(stale).toEqual([]);
    });
});
