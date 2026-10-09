/**
 * What an API key is: a bearer credential shown once and stored only as a
 * hash, and the permissions it may carry. Pure; nothing here touches Firestore.
 */

const {
    BASE_SCOPE,
    SCOPES,
    cleanKeyName,
    hasScope,
    hashKey,
    keyIdOf,
    keyMatches,
    keyView,
    mintKey,
    normalizeScopes,
} = require('../../companyApi/apiKeys');

describe('a minted key', () => {
    it('names its own id, so a request finds it in one read', () => {
        const { keyId, key } = mintKey();
        expect(keyId).toMatch(/^[0-9a-f]{16}$/);
        expect(key).toMatch(new RegExp(`^shk_${keyId}_[A-Za-z0-9_-]{43}$`));
        expect(keyIdOf(key)).toBe(keyId);
    });

    it('is different every time', () => {
        const keys = new Set(Array.from({ length: 50 }, () => mintKey().key));
        expect(keys.size).toBe(50);
    });

    it('matches its own hash and nothing else, and the hash is not the key', () => {
        const { keyId, key } = mintKey();
        const stored = hashKey(key);
        // The secret is all that follows the id: base64url, so it can hold an underscore of its own.
        expect(stored).not.toContain(key.slice(`shk_${keyId}_`.length));
        expect(keyMatches(stored, key)).toBe(true);
        expect(keyMatches(stored, mintKey().key)).toBe(false);
        expect(keyMatches(stored, `${key}x`)).toBe(false);
        expect(keyMatches(null, key)).toBe(false);
    });

    it('is not recognised in any other shape', () => {
        const { key } = mintKey();
        for (const wrong of ['', 'Bearer x', key.toUpperCase(), key.replace('shk_', 'sk_'), key.slice(0, -1), null]) {
            expect(keyIdOf(wrong)).toBeNull();
        }
    });
});

describe('the permissions a key is given', () => {
    it('always include reading applications, and nothing else unless asked', () => {
        expect(normalizeScopes(undefined)).toEqual({ scopes: [BASE_SCOPE] });
        expect(normalizeScopes([])).toEqual({ scopes: [BASE_SCOPE] });
    });

    it('add documents and the SSN only when asked, in a fixed order', () => {
        expect(normalizeScopes(['ssn:read', 'documents:read'])).toEqual({
            scopes: ['applications:read', 'documents:read', 'ssn:read'],
        });
    });

    it('refuse a permission this API does not know, rather than dropping it', () => {
        expect(normalizeScopes(['documents:read', 'applications:write'])).toEqual({ unknown: ['applications:write'] });
    });

    it('each say in words what they give', () => {
        for (const sentence of Object.values(SCOPES)) expect(sentence).toMatch(/^[A-Z]/);
        expect(hasScope(['applications:read'], 'ssn:read')).toBe(false);
        expect(hasScope(undefined, BASE_SCOPE)).toBe(false);
    });
});

describe('a key as the settings list it', () => {
    it('shows the id and the name, never the hash', () => {
        const view = keyView('0123456789abcdef', {
            name: 'TMS', hash: 'secret-hash', scopes: ['applications:read'],
            createdAt: new Date('2026-10-09T10:00:00Z'), lastUsedAt: null, revokedAt: null,
        });
        expect(view).toEqual(expect.objectContaining({
            keyId: '0123456789abcdef', name: 'TMS', prefix: 'shk_0123456789abcdef_…',
            createdAt: '2026-10-09T10:00:00.000Z', lastUsedAt: null, revokedAt: null,
        }));
        expect(JSON.stringify(view)).not.toContain('secret-hash');
    });

    it('takes a name of up to 60 characters, spaces tidied', () => {
        expect(cleanKeyName('  Our   TMS ')).toBe('Our TMS');
        expect(cleanKeyName('')).toBeNull();
        expect(cleanKeyName('x'.repeat(61))).toBeNull();
        expect(cleanKeyName(42)).toBeNull();
    });
});
