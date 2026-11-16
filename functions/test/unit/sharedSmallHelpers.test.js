/**
 * The small helpers several modules used to carry a copy of each
 * (`shared/secretTokens.js`, `shared/millisOf.js`, `trimTo` in
 * `shared/plainText.js`), and that each former copy is now the shared one.
 * Every token and time is artificial.
 */
jest.mock('../../firebaseAdmin', () => ({ admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} }));

const crypto = require('crypto');
const { hashSecret, secretMatches } = require('../../shared/secretTokens');
const { millisOf } = require('../../shared/millisOf');
const { trimTo } = require('../../shared/plainText');

describe('secretTokens', () => {
    it('stores a secret as its SHA-256 and matches only that secret', () => {
        const hash = hashSecret('artificial-token');
        expect(hash).toBe(crypto.createHash('sha256').update('artificial-token').digest('hex'));
        expect(secretMatches(hash, 'artificial-token')).toBe(true);
        expect(secretMatches(hash, 'artificial-token2')).toBe(false);
        expect(secretMatches('', 'artificial-token')).toBe(false);
        expect(secretMatches(hash.slice(1), 'artificial-token')).toBe(false);
        expect(hashSecret(undefined)).toBe(hashSecret(''));
    });

    it('is what resume tokens, invite tokens and API keys are hashed and compared with', () => {
        const draft = require('../../shared/applicationDraft');
        const invites = require('../../companyApplications/inviteTokens');
        const keys = require('../../companyApi/apiKeys');
        expect([draft.hashResumeToken, invites.hashInvite, keys.hashKey]).toEqual([hashSecret, hashSecret, hashSecret]);
        expect([draft.resumeTokenMatches, invites.inviteMatches, keys.keyMatches]).toEqual([secretMatches, secretMatches, secretMatches]);
        const { token, hash } = draft.mintResumeToken();
        expect(secretMatches(hash, token)).toBe(true);
    });
});

describe('millisOf', () => {
    it('reads a Timestamp and a Date, and nothing else', () => {
        expect(millisOf({ toMillis: () => 1700000000123 })).toBe(1700000000123);
        expect(millisOf(new Date(1700000000000))).toBe(1700000000000);
        for (const value of [null, undefined, 0, '', '2026-11-07T00:00:00Z', 1700000000000, { seconds: 1700000000 }]) {
            expect(millisOf(value)).toBeNull();
        }
    });
});

describe('trimTo', () => {
    it('trims a string and cuts it to the bound, and makes anything else empty', () => {
        expect(trimTo('  Artificial Freight  ', 120)).toBe('Artificial Freight');
        expect(trimTo('abcdef', 3)).toBe('abc');
        expect(trimTo(42, 10)).toBe('');
        expect(trimTo(null, 10)).toBe('');
    });
});
