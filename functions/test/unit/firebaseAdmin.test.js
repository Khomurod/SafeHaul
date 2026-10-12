// firebase-admin 14 has no namespace export, so `firebaseAdmin.js` builds the
// `admin.*` calls the code makes from the modular API. Nearly every suite mocks
// that module, which means a call it does not provide passes every test and
// throws only in production. This file is the one place the real module runs:
// every `admin.<path>` a runtime file uses must exist on it, and nothing may go
// back to the removed namespace. The deployed entry point loading under plain
// Node, where the real SDK (and its ESM-only `jose`) is used, is
// `deployedEntryPoint.test.js`.

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..');
const IMPORTS_WRAPPER_ADMIN = /\{[^}]*\badmin\b[^}]*\}\s*=\s*require\(\s*['"][./]*firebaseAdmin['"]\s*\)/;
const ROOT_NAMESPACE_REQUIRE = /require\(\s*['"]firebase-admin['"]\s*\)/;

function runtimeFiles(dir = FUNCTIONS_DIR) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return ['node_modules', 'test'].includes(entry.name) ? [] : runtimeFiles(full);
        }
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

const relative = (file) => path.relative(FUNCTIONS_DIR, file);

describe('firebaseAdmin', () => {
    const { admin, db, auth, storage } = require('../../firebaseAdmin');
    const { FieldValue, FieldPath, Timestamp } = require('firebase-admin/firestore');

    it('hands out the shared instances, settings included', () => {
        expect(admin.firestore()).toBe(db);
        expect(admin.auth()).toBe(auth);
        expect(admin.storage()).toBe(storage);
    });

    it('exposes the Firestore value types the code writes with', () => {
        expect(admin.firestore.FieldValue.serverTimestamp()).toBeInstanceOf(FieldValue);
        expect(admin.firestore.FieldPath.documentId()).toBeInstanceOf(FieldPath);
        expect(admin.firestore.Timestamp.fromMillis(0)).toBeInstanceOf(Timestamp);
    });

    it('provides every admin.<path> a runtime file calls', () => {
        const users = runtimeFiles().filter((file) => IMPORTS_WRAPPER_ADMIN.test(fs.readFileSync(file, 'utf8')));
        const missing = [];
        for (const file of users) {
            const source = fs.readFileSync(file, 'utf8');
            for (const [, chain] of source.matchAll(/\badmin((?:\.[A-Za-z_$][\w$]*)+)/g)) {
                let value = admin;
                for (const key of chain.slice(1).split('.')) value = value == null ? undefined : value[key];
                if (value === undefined) missing.push(`${relative(file)}: admin${chain}`);
            }
        }
        expect(users.length).toBeGreaterThan(50);
        expect(missing).toEqual([]);
    });

    it('leaves no runtime file on the removed root namespace', () => {
        const offenders = runtimeFiles()
            .filter((file) => ROOT_NAMESPACE_REQUIRE.test(fs.readFileSync(file, 'utf8')))
            .map(relative);
        expect(offenders).toEqual([]);
    });
});
