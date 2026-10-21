/**
 * Data cleanup → old SMTP password copies. The one rule that matters: every
 * company sends email with exactly the settings it sent with before, and the
 * copies outside `email_config` go only once `email_config` holds that
 * password encrypted. A company where that cannot be shown is left untouched.
 *
 * Every address, password and key below is artificial.
 */
process.env.SMS_ENCRYPTION_KEY = '12345678901234567890123456789012';

jest.mock('firebase-functions/v2/https', () => require('./dataCleanup.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./dataCleanup.support').world.firebaseAdmin);

const { world, request } = require('./dataCleanup.support');
const { dataCleanup, __private } = require('../../maintenance/dataCleanup');
const { isSealed, readSmtpSettings, sealPassword } = require('../../shared/smtpSettings');

const check = () => dataCleanup(request({ mode: 'check', item: 'smtpCopies' }));
const run = () => dataCleanup(request({ mode: 'run', item: 'smtpCopies' }));

const config = (id) => `companies/${id}/system_settings/email_config`;
const oldest = (id) => `companies/${id}/integrations/email_settings`;
const COMPANIES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];

function seed() {
    world.reset({
        firestore: {
            // Encrypted where email is sent from; two stale plain copies elsewhere.
            'companies/c1': { companyName: 'One', emailSettings: { smtpHost: 'smtp.one.test', smtpUser: 'hr@one.test', smtpPass: 'old-plain-1' } },
            [config('c1')]: { smtpHost: 'smtp.one.test', smtpPort: 587, smtpUser: 'hr@one.test', smtpPass: sealPassword('current-1'), signature: 'One' },
            [oldest('c1')]: { email: 'hr@one.test', password: 'older-plain-1' },
            // A plain-text password where email is sent from.
            'companies/c2': { companyName: 'Two' },
            [config('c2')]: { smtpHost: 'smtp.two.test', smtpPort: 465, smtpUser: 'hr@two.test', smtpPass: 'plain-2' },
            // Only the company document's settings.
            'companies/c3': {
                companyName: 'Three',
                emailSettings: { smtpHost: 'smtp.three.test', smtpPort: 2525, smtpUser: 'hr@three.test', smtpPass: 'plain-3', signature: 'Three', isVerified: true },
            },
            // Only the oldest place: other field names, and no server for a Gmail account.
            'companies/c4': { companyName: 'Four' },
            [oldest('c4')]: { email: 'hr@four.test', password: 'plain-4' },
            // A stored password that cannot be decrypted.
            'companies/c5': { companyName: 'Five', emailSettings: { smtpPass: 'plain-5' } },
            [config('c5')]: { smtpHost: 'smtp.five.test', smtpUser: 'hr@five.test', smtpPass: 'enc:v1:00:00' },
            // Nothing stored at all.
            'companies/c6': { companyName: 'Six' },
            // email_config without a password, holding a server under a name no save writes.
            'companies/c7': { companyName: 'Seven', emailSettings: { smtpHost: '', smtpUser: 'hr@seven.test', smtpPass: 'plain-7' } },
            [config('c7')]: { host: 'smtp.odd.test' },
            // An encrypted copy left on the company document.
            'companies/c8': { companyName: 'Eight', emailSettings: { smtpUser: 'hr@eight.test', smtpPass: sealPassword('current-8') } },
            [config('c8')]: { smtpHost: 'smtp.eight.test', smtpUser: 'hr@eight.test', smtpPass: sealPassword('current-8') },
        },
    });
}

async function sendingSettings() {
    const out = {};
    for (const id of COMPANIES) {
        try {
            out[id] = (await readSmtpSettings(id)).settings;
        } catch (error) {
            out[id] = `error: ${error.message}`;
        }
    }
    return out;
}

const EXPECTED = { companies: 5, resealed: 1, copiedToConfig: 2, copiesRemoved: 5, unverifiable: 2 };

describe('data cleanup — SMTP password copies', () => {
    beforeEach(seed);

    it('counts without writing', async () => {
        const result = await check();
        expect(result).toMatchObject({ done: true, counts: EXPECTED, total: 5 });
        expect(world.writes).toBe(0);
    });

    it('keeps every company sending with the same settings', async () => {
        const before = await sendingSettings();
        await run();
        expect(await sendingSettings()).toEqual(before);
        expect(before.c4).toMatchObject({ host: '', user: 'hr@four.test', pass: 'plain-4' });
    });

    it('encrypts into email_config first, then deletes the copies', async () => {
        await run();
        expect(world.doc('companies/c1').emailSettings).toEqual({ smtpHost: 'smtp.one.test', smtpUser: 'hr@one.test' });
        expect(world.doc(oldest('c1'))).toEqual({ email: 'hr@one.test' });

        expect(isSealed(world.doc(config('c2')).smtpPass)).toBe(true);

        expect(world.doc(config('c3'))).toMatchObject({
            smtpHost: 'smtp.three.test', smtpPort: 2525, smtpUser: 'hr@three.test', signature: 'Three', isVerified: true,
            migratedFrom: 'company_emailSettings',
        });
        expect(isSealed(world.doc(config('c3')).smtpPass)).toBe(true);
        expect(world.doc('companies/c3').emailSettings).toEqual({
            smtpHost: 'smtp.three.test', smtpPort: 2525, smtpUser: 'hr@three.test', signature: 'Three', isVerified: true,
        });

        expect(world.doc(config('c4'))).toMatchObject({ smtpHost: '', smtpUser: 'hr@four.test', migratedFrom: 'integrations_email_settings' });
        expect(world.doc(oldest('c4'))).toEqual({ email: 'hr@four.test' });
        expect(world.doc('companies/c8').emailSettings).toEqual({ smtpUser: 'hr@eight.test' });

        // Nothing stored in plain text is left, except where the company was left alone.
        const plain = [...world.docs.entries()]
            .flatMap(([path, data]) => [data.smtpPass, data.password, data.emailSettings?.smtpPass].map((value) => [path, value]))
            .filter(([, value]) => typeof value === 'string' && !isSealed(value));
        expect(plain.map(([path]) => path).sort()).toEqual(['companies/c5', 'companies/c7']);
    });

    it('leaves a company it cannot verify exactly as it was', async () => {
        const c5 = { company: world.doc('companies/c5'), config: world.doc(config('c5')) };
        const c7 = { company: world.doc('companies/c7'), config: world.doc(config('c7')) };
        await run();
        expect({ company: world.doc('companies/c5'), config: world.doc(config('c5')) }).toEqual(c5);
        expect({ company: world.doc('companies/c7'), config: world.doc(config('c7')) }).toEqual(c7);
    });

    it('changes nothing on a second run', async () => {
        await run();
        world.writes = 0;
        const again = await run();
        expect(again).toMatchObject({ total: 0, counts: { unverifiable: 2 } });
        expect(world.writes).toBe(0);
    });

    it('stops at the time budget without writing', async () => {
        const result = await __private.execute({ item: 'smtpCopies', mode: 'run', outOfTime: () => true });
        expect(result.done).toBe(false);
        expect(world.writes).toBe(0);
    });
});
