/**
 * The registry's vocabulary: the closed sets an entry may draw on, and the
 * read-only policies it may carry.
 *
 * `source` is *where the value is stored* and therefore decides what can be done
 * to it. `category` is *what kind of configuration it is* and is what an operator
 * filters by. They overlap but are not the same axis: a public value can be
 * inlined into the browser while its deployment source remains Google.
 */

/** Configuration categories, matching the operator-facing filter. */
const CATEGORIES = Object.freeze({
    BROWSER_BUILD: 'browser-build',
    FUNCTIONS_ENV: 'functions-env',
    SECRET_MANAGER: 'secret-manager',
    GITHUB_ACTIONS: 'github-actions',
    FIREBASE_CONFIG: 'firebase-config',
    GLOBAL_INTEGRATION: 'global-integration',
    COMPANY_INTEGRATION: 'company-integration',
    INFRASTRUCTURE: 'infrastructure-security',
    PUBLIC_CONFIG: 'public-config',
    DEPLOYMENT_OPS: 'deployment-operations',
});

/** Storage locations. A row's source decides which operations are possible. */
const SOURCES = Object.freeze({
    /** Inlined into the browser bundle by Vite at build time. */
    VITE_BUILD: 'vite-build',
    /** Legacy plain Functions environment value. */
    FUNCTIONS_ENV: 'functions-env',
    /** Google Secret Manager, bound with `secrets: [...]` / `defineSecret`. */
    SECRET_MANAGER: 'secret-manager',
    /** GitHub Actions repository secret. */
    GITHUB_SECRET: 'github-actions-secret',
    /** Literal `env:` value committed in a workflow file. */
    WORKFLOW_ENV: 'github-actions-variable',
    /** Injected into the Cloud Functions runtime by the platform. */
    FIREBASE_RUNTIME: 'firebase-runtime',
    /** Committed repository configuration (`.firebaserc`, `firebase.json`). */
    REPO_CONFIG: 'repo-config',
    /** Encrypted-at-rest field on a Firestore document. */
    FIRESTORE_ENCRYPTED: 'firestore-encrypted',
    /** Plaintext-at-rest field on an access-restricted Firestore document. */
    FIRESTORE_PLAINTEXT: 'firestore-plaintext',
    /** Supplied by the local shell / CI runner for SafeHaul tooling. */
    LOCAL_TOOLING: 'local-tooling',
});

/**
 * How — and whether — the current value can be read back.
 *
 * `NOT_RETRIEVABLE` is the honest answer for GitHub Actions secrets: GitHub
 * never returns a stored secret's plaintext through its API. Those rows stay
 * listed and keep their eye control; the reveal reports the limitation instead
 * of inventing a value.
 */
const AVAILABILITY = Object.freeze({
    /** Already present in the shipped bundle; resolved in the browser. */
    BROWSER_VISIBLE: 'browser-visible',
    /** Read from `process.env` inside the reveal callable. */
    SERVER_RUNTIME: 'server-runtime',
    /** Decrypted server-side from Firestore. */
    FIRESTORE_ENCRYPTED: 'firestore-encrypted',
    /** Read server-side from Firestore without decryption. */
    FIRESTORE_PLAINTEXT: 'firestore-plaintext',
    /** Non-secret value committed in the repository. */
    KNOWN_LITERAL: 'known-literal',
    /** The source does not permit reading the saved value. */
    NOT_RETRIEVABLE: 'not-retrievable',
});

const SENSITIVITY = Object.freeze({
    PUBLIC: 'public',
    INTERNAL: 'internal',
    SENSITIVE: 'sensitive',
    CRITICAL: 'critical',
});

/** Reasons shown on a disabled control. Kept short enough for a tooltip. */
const REASONS = Object.freeze({
    DEPLOYMENT_MANAGED: 'Managed by deployment',
    PROTECTED_INFRASTRUCTURE: 'Protected infrastructure key',
    SOURCE_NO_EDIT: 'Source does not support editing',
    SOURCE_NO_DELETE: 'Source does not support deletion',
    SOURCE_NO_ADD: 'Source does not support adding keys here',
    READ_ONLY_GENERATED: 'Read-only generated value',
    REFERENCED: 'Cannot be deleted while referenced',
    PLATFORM_INJECTED: 'Injected by the platform at runtime',
});

/** No operation is available. The default for everything the vault only reads. */
const READ_ONLY = Object.freeze({
    revealable: true,
    editable: false,
    replaceable: false,
    addable: false,
    deletable: false,
    testable: false,
});

function readOnly(reason) {
    return {
        permissions: { ...READ_ONLY },
        restrictions: {
            edit: reason,
            replace: reason,
            add: REASONS.SOURCE_NO_ADD,
            delete: REASONS.SOURCE_NO_DELETE,
        },
    };
}

/**
 * Deployment-managed rows: the value is real and readable, but writing it here
 * would be a lie — the release workflow rewrites it on the next deploy.
 */
const DEPLOYMENT_MANAGED = readOnly(REASONS.DEPLOYMENT_MANAGED);
const PROTECTED = readOnly(REASONS.PROTECTED_INFRASTRUCTURE);
const PLATFORM = readOnly(REASONS.PLATFORM_INJECTED);

module.exports = {
    AVAILABILITY,
    CATEGORIES,
    DEPLOYMENT_MANAGED,
    PLATFORM,
    PROTECTED,
    READ_ONLY,
    REASONS,
    SENSITIVITY,
    SOURCES,
    readOnly,
};
