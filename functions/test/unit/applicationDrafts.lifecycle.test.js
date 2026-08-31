/**
 * Restoring a draft, starting over, and the browser write counter.
 *
 * Part of the `applicationDrafts` suite. The Firestore double, the fixtures and
 * the properties this surface has to hold are in
 * `applicationDrafts.support.js`. Each `jest.mock` below has to stay in this
 * file, because Jest hoists it per file and cannot register one from a helper.
 */

process.env.SMS_ENCRYPTION_KEY = 'x'.repeat(32);

jest.mock('firebase-functions/v2/https', () => require('./applicationDrafts.support').httpsV2Mock());
jest.mock('firebase-functions/v1', () => require('./applicationDrafts.support').httpsV1Mock());
jest.mock('../../shared/companyAccess', () => require('./applicationDrafts.support').companyAccessMock());
jest.mock('../../firebaseAdmin', () => require('./applicationDrafts.support').firebaseAdminMock());
jest.mock('../../shared/rateLimiter', () => require('./applicationDrafts.support').rateLimiterMock());
jest.mock('../../shared/companyTenant', () => require('./applicationDrafts.support').companyTenantMock());

const drafts = require('../../applicationDrafts');
const draft = require('../../shared/applicationDraft');
const {
    mockStore, COMPANY, CONTEXT, keyFor, saveFirstPage, resetDraftState,
} = require('./applicationDrafts.support');

beforeEach(resetDraftState);

describe('restoring a draft', () => {
    it('returns the saved answers for a valid token', async () => {
        const saved = await saveFirstPage();

        const restored = await drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: saved.applicantKey,
            resumeToken: saved.resumeToken,
        }, CONTEXT);

        expect(restored.restored).toBe(true);
        expect(restored.draft.formData.firstName).toBe('Dana');
        expect(restored.draft.lastStep).toBe(1);
    });

    it('never returns an SSN, an identity hash or a token hash', async () => {
        const saved = await saveFirstPage();

        const restored = await drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: saved.applicantKey,
            resumeToken: saved.resumeToken,
        }, CONTEXT);

        const serialized = JSON.stringify(restored);
        expect(serialized).not.toContain('identityKey');
        expect(serialized).not.toContain('resumeTokenHash');
        expect(serialized).not.toContain('123-45-6789');
    });

    it('refuses a wrong token and an unknown application identically', async () => {
        const saved = await saveFirstPage();

        const wrongToken = await drafts.resumeApplicationDraft({
            companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: 'a'.repeat(64),
        }, CONTEXT).catch((error) => error);
        const unknownKey = await drafts.resumeApplicationDraft({
            companyId: COMPANY, applicantKey: 'deadbeef', resumeToken: saved.resumeToken,
        }, CONTEXT).catch((error) => error);

        expect(wrongToken.code).toBe('not-found');
        expect(unknownKey.code).toBe('not-found');
        expect(wrongToken.message).toBe(unknownKey.message);
    });

    it('compares the token in constant time', () => {
        const { token, hash } = draft.mintResumeToken();

        expect(draft.resumeTokenMatches(hash, token)).toBe(true);
        // Deterministically different: flipping to a character the token cannot
        // already end with, so this can never accidentally compare equal.
        expect(draft.resumeTokenMatches(hash, `${token.slice(0, -1)}z`)).toBe(false);
        // A length mismatch must not throw, which is what a naive
        // timingSafeEqual call does.
        expect(draft.resumeTokenMatches(hash, 'short')).toBe(false);
        expect(draft.resumeTokenMatches(undefined, token)).toBe(false);
    });
});

describe('starting over', () => {
    it('discards the draft and leaves nothing behind', async () => {
        const saved = await saveFirstPage();

        const result = await drafts.startNewApplication({
            companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: saved.resumeToken,
        }, CONTEXT);

        expect(result.discarded).toBe(true);
        expect([...mockStore.keys()].filter((key) => key.includes('/application_drafts/'))).toHaveLength(0);
    });

    it('cannot be used to delete a draft the caller cannot prove they own', async () => {
        // The reason start over does not sweep the identity. Knowing a last name, a
        // date of birth and an SSN is enough to *create* a draft that inherits the
        // victim's identity HMAC and to be handed a valid token for it — so "I own a
        // draft with this identity" is true of a stranger. A sweep authorized by that
        // would delete the real applicant's work, which is precisely the primitive
        // the save path's per-draft gate removed.
        const victim = await saveFirstPage();

        // The attacker's own draft: their contact details, the victim's identity.
        const attacker = await saveFirstPage({
            email: 'attacker@example.test',
            phone: '(214) 555-0199',
        });
        expect(attacker.resumeToken).toBeTruthy();

        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: attacker.resumeToken,
        }, CONTEXT);

        // Their own draft is gone, and only their own.
        expect(mockStore.has(`companies/${COMPANY}/application_drafts/${keyFor(COMPANY, 'attacker@example.test')}`))
            .toBe(false);
        const survivor = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(survivor).toBeDefined();
        expect(victim.resumeToken).toBeTruthy();
    });

    it('discards the application it was offered, leaving a sibling it cannot prove it owns', async () => {
        // The honest semantic, written down because the comment here used to promise
        // the opposite. A second device with no token creates a sibling; start over on
        // one device discards that device's application, and the other draft — whose
        // token only that other browser holds — survives to be offered later or to
        // expire with the TTL.
        await saveFirstPage();
        const secondDevice = await saveFirstPage({ email: 'dana.alvarez@example.test' });
        expect([...mockStore.keys()].filter((key) => key.includes('/application_drafts/'))).toHaveLength(2);

        await drafts.startNewApplication({
            companyId: COMPANY, resumeToken: secondDevice.resumeToken,
        }, CONTEXT);

        const remaining = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(remaining).toHaveLength(1);
        expect(remaining[0]).toContain(keyFor());
    });

    it('leaves exactly one consistent state, never two live drafts', async () => {
        const saved = await saveFirstPage();
        await drafts.startNewApplication({
            companyId: COMPANY, applicantKey: saved.applicantKey, resumeToken: saved.resumeToken,
        }, CONTEXT);

        // Beginning again writes one draft, and the old one is not among them.
        const fresh = await saveFirstPage({ email: 'dana.new@example.test' });
        const paths = [...mockStore.keys()].filter((key) => key.includes('/application_drafts/'));
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain(fresh.applicantKey);
    });

    it('refuses without a valid token, so nothing is deleted by guessing', async () => {
        await saveFirstPage();

        await expect(drafts.startNewApplication({
            companyId: COMPANY, resumeToken: 'b'.repeat(64),
        }, CONTEXT)).rejects.toMatchObject({ code: 'not-found' });
        expect([...mockStore.keys()].filter((key) => key.includes('/application_drafts/'))).toHaveLength(1);
    });

    it('cannot reach a submitted application', async () => {
        // The callables only ever address the draft subcollection, so a signed
        // application and its immutable snapshot are out of their reach entirely.
        //
        // Read the WHOLE surface, not just the entry. `applicationDrafts.js` is
        // now a re-export, so pointing this at it alone would leave both negative
        // assertions passing over a file with no queries in it at all — which is
        // the failure mode this assertion exists to prevent, one level up.
        const fs = require('fs');
        const path = require('path');
        const root = path.resolve(__dirname, '../..');
        const files = [
            path.join(root, 'applicationDrafts.js'),
            ...fs.readdirSync(path.join(root, 'drafts'))
                .filter((name) => name.endsWith('.js'))
                .map((name) => path.join(root, 'drafts', name)),
        ];
        // The surface is more than one file, and the directory listing is what
        // keeps a newly added module from escaping this check.
        expect(files.length).toBeGreaterThan(4);

        const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
        // Strip comments first: the prose in these files legitimately explains
        // that submitted applications are out of reach, and matching that text
        // would make this assertion a test of the documentation.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        expect(code.length).toBeGreaterThan(5000);

        expect(code).not.toMatch(/collection\(\s*['"]applications['"]\s*\)/);
        expect(code).not.toMatch(/['"]submission['"]/);
        // Draft storage is reached only through the shared module, whose
        // `draftsCollection` is bound to the draft subcollection; the only other
        // collection these files name is their own value-free audit trail.
        expect(code).toMatch(/require\('\.\.\/shared\/applicationDraft'\)/);
        expect(code).toMatch(/application_draft_audit/);
    });
});

/**
 * The recruiter half. Without it a draft is only ever useful to an applicant who
 * comes back on their own, and a carrier watching people drop off at the licence
 * page still has nobody to call.
 */
describe('the browser write counter', () => {
    it('stores the sequence a save carried and hands it back on resume', async () => {
        const saved = await saveFirstPage({ clientSeq: 7 });
        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.clientSeq).toBe(7);

        const resumed = await drafts.resumeApplicationDraft({
            companyId: COMPANY,
            applicantKey: saved.applicantKey,
            resumeToken: saved.resumeToken,
        }, CONTEXT);

        // The browser compares this with the sequence it believes is synced. It is
        // the whole reason a stale server draft can no longer overwrite newer local
        // work, and it needs no clock on either side.
        expect(resumed.draft.clientSeq).toBe(7);
    });

    it('records null rather than a neighbour\'s number when a save omits it', async () => {
        // A cached older browser saves without the field. Claiming the previous
        // device's sequence would be a lie about whose copy this is, so the client
        // is told there is none and falls back to comparing progress.
        await saveFirstPage({ clientSeq: 7 });
        await saveFirstPage({ lastStep: 2 });

        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(stored.clientSeq).toBeNull();
    });

    it('bounds and rejects a counter that is not a plain integer', async () => {
        for (const value of ['9', 1.5, -3, NaN, {}, 10 ** 9]) {
            await saveFirstPage({ clientSeq: value });
            const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
            expect(stored.clientSeq === null || Number.isInteger(stored.clientSeq)).toBe(true);
            expect(stored.clientSeq === null || stored.clientSeq <= 100000).toBe(true);
        }
    });

    it('still stores no SSN when a sequence is supplied', async () => {
        await saveFirstPage({ clientSeq: 3, formData: { firstName: 'Dana', ssn: '123-45-6789' } });

        const stored = mockStore.get(`companies/${COMPANY}/application_drafts/${keyFor()}`);
        expect(JSON.stringify(stored)).not.toContain('123-45-6789');
        expect(stored.formData).not.toHaveProperty('ssn');
    });
});
