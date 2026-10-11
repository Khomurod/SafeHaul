const { trustedClientIp } = require('../../shared/clientIp');

describe('trustedClientIp', () => {
    it('takes the entry Google appended, whatever the caller put before it', () => {
        expect(trustedClientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, ip: '6.6.6.6' })).toBe('203.0.113.9');
        expect(trustedClientIp({ headers: { 'x-forwarded-for': '203.0.113.9' } })).toBe('203.0.113.9');
        expect(trustedClientIp({ headers: { 'x-forwarded-for': ['1.1.1.1', '2001:db8::7'] } })).toBe('2001:db8::7');
    });

    it("uses Express's address only when no proxy header came at all", () => {
        expect(trustedClientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
    });

    it('records no junk', () => {
        expect(trustedClientIp({ headers: { 'x-forwarded-for': '1.1.1.1, <script>' } })).toBe('0.0.0.0');
        expect(trustedClientIp(undefined)).toBe('0.0.0.0');
    });
});
