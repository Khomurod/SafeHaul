const { trustedClientIp, forwardedChain } = require('../../shared/clientIp');

const xff = (value, ip) => ({ headers: { 'x-forwarded-for': value }, ip });

describe('trustedClientIp', () => {
    it('takes the address the front end appended, whatever the caller put before it', () => {
        expect(trustedClientIp(xff('6.6.6.6, 203.0.113.9', '6.6.6.6'))).toBe('203.0.113.9');
        expect(trustedClientIp(xff('203.0.113.9'))).toBe('203.0.113.9');
        expect(trustedClientIp(xff(['1.1.1.1', '2001:db8::7']))).toBe('2001:db8::7');
    });

    it("walks past Google's own proxies and private addresses on the right", () => {
        expect(trustedClientIp(xff('6.6.6.6, 203.0.113.9, 35.191.20.4'))).toBe('203.0.113.9');
        expect(trustedClientIp(xff('6.6.6.6, 203.0.113.9, 130.211.0.17'))).toBe('203.0.113.9');
        expect(trustedClientIp(xff('203.0.113.9, 10.8.0.1, 169.254.1.1'))).toBe('203.0.113.9');
        expect(trustedClientIp(xff('2001:db8::7, fe80::1'))).toBe('2001:db8::7');
        // An office proxy's private address on the left is not the caller either.
        expect(trustedClientIp(xff('192.168.1.20, 198.51.100.4'))).toBe('198.51.100.4');
    });

    it("uses Express's address only when no proxy header came at all", () => {
        expect(trustedClientIp({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
    });

    it('records no junk', () => {
        expect(trustedClientIp(xff('1.1.1.1, <script>'))).toBe('0.0.0.0');
        expect(trustedClientIp(undefined)).toBe('0.0.0.0');
    });
});

describe('forwardedChain', () => {
    it('keeps every address, cleaned and cut short', () => {
        expect(forwardedChain(xff('6.6.6.6, 203.0.113.9'))).toBe('6.6.6.6, 203.0.113.9');
        expect(forwardedChain(xff('1.1.1.1, <script>alert(1)</script>'))).not.toMatch(/[<>()/s-z]/);
        expect(forwardedChain(xff('9.9.9.9, '.repeat(100))).length).toBe(256);
        expect(forwardedChain({ headers: {} })).toBe('');
    });
});
