/**
 * The inventory guard.
 *
 * The Environment & Integrations vault is only worth having if it is *complete*.
 * These tests scan the real repository — frontend, backend, scripts, Playwright
 * config and GitHub workflows — and fail in both directions:
 *
 *  1. a configuration key referenced by SafeHaul that is not registered, so a
 *     new `process.env.X` cannot silently escape the vault;
 *  2. a registered key that nothing in SafeHaul references, so the inventory
 *     cannot drift into fiction. Synthetic rows must declare themselves in
 *     `UNREFERENCED_BY_DESIGN` with a stated reason.
 *
 * They also pin the exclusions: Vite built-ins and ordinary operating-system
 * variables are deliberately *not* SafeHaul configuration and must stay out.
 */

const fs = require('fs');
const path = require('path');

const {
    AVAILABILITY,
    COMPANY_TEMPLATES,
    GLOBAL_ENTRIES,
    UNREFERENCED_BY_DESIGN,
    VITE_BUILTINS,
    validateNewKeyName,
} = require('../../environmentVault/registry');

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Directories walked for both scans. */
const SCAN_ROOTS = ['functions', 'src', 'scripts', 'e2e', '.storybook', '.github/workflows'];

/** Individually scanned repository-root files. */
const SCAN_FILES = [
    'playwright.config.cjs',
    'vite.config.js',
    'vitest.config.js',
    'eslint.config.js',
    'index.html',
    '.env.example',
];

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'storybook-static', 'coverage', '.git']);

/** The registry describes these files, so they must not corroborate themselves. */
const SELF_DESCRIBING = path.join('functions', 'environmentVault');

function walk(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(abs, out);
        } else if (/\.(js|jsx|mjs|cjs|ts|tsx|yml|yaml|html|example)$/.test(entry.name) || entry.name === '.env.example') {
            out.push(abs);
        }
    }
    return out;
}

function collectFiles() {
    const files = [];
    for (const root of SCAN_ROOTS) walk(path.join(REPO_ROOT, root), files);
    for (const file of SCAN_FILES) {
        const abs = path.join(REPO_ROOT, file);
        if (fs.existsSync(abs)) files.push(abs);
    }
    return files;
}

const ALL_FILES = collectFiles();

const isTestFile = (file) => /\.(test|spec)\.(js|jsx|mjs|cjs|ts|tsx)$/.test(file)
    || file.includes(`${path.sep}functions${path.sep}test${path.sep}`);

const read = (file) => fs.readFileSync(file, 'utf8');

/**
 * Forward scan: every way SafeHaul names a configuration key.
 * Test files are excluded — they stub existing keys and introduce none.
 */
function referencedKeys() {
    const found = new Map(); // key -> Set of relative files

    const record = (key, file) => {
        if (!key || VITE_BUILTINS.includes(key)) return;
        const rel = path.relative(REPO_ROOT, file);
        if (!found.has(key)) found.set(key, new Set());
        found.get(key).add(rel);
    };

    for (const file of ALL_FILES) {
        if (isTestFile(file)) continue;
        if (file.includes(SELF_DESCRIBING)) continue;
        const source = read(file);

        for (const match of source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) record(match[1], file);
        for (const match of source.matchAll(/import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) record(match[1], file);
        for (const match of source.matchAll(/defineSecret\(\s*["']([A-Za-z0-9_]+)["']/g)) record(match[1], file);
        for (const match of source.matchAll(/secrets:\s*\[([^\]]*)\]/g)) {
            for (const quoted of match[1].matchAll(/["']([A-Za-z0-9_]+)["']/g)) record(quoted[1], file);
        }
        if (/\.ya?ml$/.test(file)) {
            for (const match of source.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) record(match[1], file);
            for (const match of source.matchAll(/vars\.([A-Za-z0-9_]+)/g)) record(match[1], file);
        }
    }

    return found;
}

const REFERENCED = referencedKeys();
const REGISTERED_KEYS = new Set(GLOBAL_ENTRIES.map((entry) => entry.key));

describe('environment registry — completeness', () => {
    it('scans a meaningful slice of the repository', () => {
        // A silently-empty glob would make every assertion below vacuous.
        expect(ALL_FILES.length).toBeGreaterThan(200);
        expect(REFERENCED.size).toBeGreaterThan(20);
    });

    it('registers every configuration key SafeHaul references', () => {
        const unregistered = [...REFERENCED.entries()]
            .filter(([key]) => !REGISTERED_KEYS.has(key))
            .map(([key, files]) => `${key} (referenced by ${[...files].sort().join(', ')})`)
            .sort();

        expect(unregistered).toEqual([]);
    });

    it('registers no key that SafeHaul does not reference', () => {
        const corpus = ALL_FILES
            .filter((file) => !file.includes(SELF_DESCRIBING))
            .map(read)
            .join('\n');

        const fabricated = [...REGISTERED_KEYS]
            .filter((key) => !UNREFERENCED_BY_DESIGN[key])
            .filter((key) => !new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(corpus))
            .sort();

        expect(fabricated).toEqual([]);
    });

    it('documents a reason for every synthetic row', () => {
        for (const key of Object.keys(UNREFERENCED_BY_DESIGN)) {
            expect(REGISTERED_KEYS.has(key)).toBe(true);
            expect(typeof UNREFERENCED_BY_DESIGN[key]).toBe('string');
            expect(UNREFERENCED_BY_DESIGN[key].length).toBeGreaterThan(20);
        }
    });

    it('excludes Vite built-ins, which are not SafeHaul configuration', () => {
        for (const builtin of VITE_BUILTINS) {
            expect(REGISTERED_KEYS.has(builtin)).toBe(false);
        }
    });

    it('excludes unrelated operating-system variables', () => {
        for (const osVar of ['PATH', 'HOME', 'USER', 'SHELL', 'PWD', 'LANG', 'TMPDIR', 'HOSTNAME', 'TERM']) {
            expect(REGISTERED_KEYS.has(osVar)).toBe(false);
        }
    });
});

describe('environment registry — coverage of each required area', () => {
    const bySource = (source) => GLOBAL_ENTRIES.filter((entry) => entry.source === source);

    it('covers every VITE_* variable the frontend reads', () => {
        const viteReferenced = [...REFERENCED.keys()].filter((key) => key.startsWith('VITE_')).sort();
        const viteRegistered = bySource('vite-build').map((entry) => entry.key).sort();
        expect(viteReferenced.filter((key) => !viteRegistered.includes(key))).toEqual([]);
    });

    it('covers every Secret Manager binding', () => {
        const registered = bySource('secret-manager').map((entry) => entry.key).sort();
        expect(registered).toEqual([
            'BULK_WORKER_SECRET',
            'FACEBOOK_APP_ID',
            'FACEBOOK_APP_SECRET',
            'FACEBOOK_VERIFY_TOKEN',
            'GROQ_API_KEY',
            'LANDING_TELEGRAM_BOT_TOKEN',
            'LANDING_TELEGRAM_CHAT_ID',
            'PROCESS_BULK_BATCH_URL',
            'SMS_ENCRYPTION_KEY',
        ]);
    });

    it('lists every GitHub Actions secret the workflows reference', () => {
        const workflowSecrets = new Set();
        for (const file of ALL_FILES.filter((f) => f.includes(`${path.sep}workflows${path.sep}`))) {
            for (const match of read(file).matchAll(/secrets\.([A-Za-z0-9_]+)/g)) workflowSecrets.add(match[1]);
        }
        const registered = new Set(bySource('github-actions-secret').map((entry) => entry.key));
        expect([...workflowSecrets].filter((key) => !registered.has(key)).sort()).toEqual([]);
    });

    it('keeps only GitHub\'s automatic per-run token in the inventory', () => {
        const githubRows = bySource('github-actions-secret');
        expect(githubRows.map((row) => row.key)).toEqual(['GITHUB_TOKEN']);
        for (const row of githubRows) {
            expect(row.availability).toBe(AVAILABILITY.NOT_RETRIEVABLE);
            expect(row.permissions.revealable).toBe(true);
            expect(row.permissions.editable).toBe(false);
            expect(row.permissions.deletable).toBe(false);
        }
    });

    it('lists every SMS credential field individually rather than as one document', () => {
        const smsFields = COMPANY_TEMPLATES.sms_provider.fields.map((field) => field.field);
        for (const expected of ['clientId', 'clientSecret', 'jwt', 'apiKey', 'apiSecret', 'subAccountId', 'phoneNumber', 'isSandbox', 'provider']) {
            expect(smsFields).toContain(expected);
        }
        // Dedicated-line credentials are their own rows, not a nested blob.
        expect(COMPANY_TEMPLATES.sms_keychain.fields.map((f) => f.field)).toEqual(
            expect.arrayContaining(['jwt', 'clientId', 'clientSecret']),
        );
    });

    it('covers the other stored integration credentials', () => {
        expect(COMPANY_TEMPLATES.email_config.fields.map((f) => f.field)).toEqual(
            expect.arrayContaining(['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass']),
        );
        expect(COMPANY_TEMPLATES.facebook_page.fields.map((f) => f.field)).toContain('accessToken');
    });

    it('gives every entry the metadata the inventory contract promises', () => {
        for (const entry of GLOBAL_ENTRIES) {
            expect(typeof entry.key).toBe('string');
            expect(typeof entry.displayName).toBe('string');
            expect(typeof entry.description).toBe('string');
            expect(entry.description.length).toBeGreaterThan(10);
            expect(typeof entry.category).toBe('string');
            expect(typeof entry.integration).toBe('string');
            expect(['global', 'company']).toContain(entry.scope);
            expect(typeof entry.source).toBe('string');
            expect(['public', 'internal', 'sensitive', 'critical']).toContain(entry.sensitivity);
            expect(Object.values(AVAILABILITY)).toContain(entry.availability);
            expect(typeof entry.permissions.revealable).toBe('boolean');
            expect(typeof entry.permissions.editable).toBe('boolean');
            expect(typeof entry.permissions.deletable).toBe('boolean');
            expect(typeof entry.requiresDeployment).toBe('boolean');
            expect(Array.isArray(entry.consumers)).toBe(true);
        }
    });

    it('explains every disabled operation', () => {
        for (const entry of GLOBAL_ENTRIES) {
            if (!entry.permissions.editable) expect(entry.restrictions.edit).toBeTruthy();
            if (!entry.permissions.replaceable) expect(entry.restrictions.replace).toBeTruthy();
            if (!entry.permissions.deletable) expect(entry.restrictions.delete).toBeTruthy();
            if (!entry.permissions.addable) expect(entry.restrictions.add).toBeTruthy();
        }
    });

    it('gives every entry a unique identifier', () => {
        const ids = GLOBAL_ENTRIES.map((entry) => entry.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('keeps protected infrastructure keys revealable but unwritable', () => {
        const protectedKeys = ['SMS_ENCRYPTION_KEY', 'BULK_WORKER_SECRET', 'FACEBOOK_APP_SECRET'];
        for (const key of protectedKeys) {
            const rows = GLOBAL_ENTRIES.filter((entry) => entry.key === key && entry.source !== 'github-actions-secret');
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                expect(row.permissions.revealable).toBe(true);
                expect(row.permissions.editable).toBe(false);
                expect(row.permissions.replaceable).toBe(false);
                expect(row.permissions.deletable).toBe(false);
                expect(row.permissions.addable).toBe(false);
            }
        }
    });
});

describe('environment registry — new key-name validation', () => {
    it('accepts ordinary key names', () => {
        expect(validateNewKeyName('senderId').ok).toBe(true);
        expect(validateNewKeyName('APP_TIMEOUT_MS').ok).toBe(true);
    });

    it('rejects reserved platform namespaces', () => {
        for (const reserved of [
            'FIREBASE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GCLOUD_PROJECT',
            'GCP_REGION', 'GITHUB_TOKEN', 'NODE_ENV', 'NPM_TOKEN', 'npm_execpath',
            'PATH', 'HOME', 'FUNCTION_REGION', 'FUNCTIONS_EMULATOR',
        ]) {
            const result = validateNewKeyName(reserved);
            expect(result.ok).toBe(false);
            expect(result.reason).toMatch(/reserved/i);
        }
    });

    it('rejects malformed names', () => {
        for (const bad of ['', 'a', '1LEADING_DIGIT', 'has space', 'has-dash', 'has.dot', 'x'.repeat(65)]) {
            expect(validateNewKeyName(bad).ok).toBe(false);
        }
    });
});
