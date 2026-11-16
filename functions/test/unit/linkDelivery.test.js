/**
 * The rules every driver link the server emails follows (`shared/linkDelivery.js`):
 * the record's own, real address; a masked answer; a link on the app's own site;
 * one press, one email.
 */
jest.mock('../../firebaseAdmin', () => ({ admin: {}, db: {} }));
jest.mock('../../emailService', () => ({ sendDynamicEmail: jest.fn() }));

const {
    DELIVERY_COOLDOWN_MS, appOriginFor, deliverableEmail, deliveryClaim, deliveryCoolingDown,
    linkEmailHtml, maskEmail, readDeliver,
} = require('../../shared/linkDelivery');

describe('the address a link is emailed to', () => {
    it('is the record’s own, trimmed and lower-cased', () => {
        expect(deliverableEmail('  Dana@Example.TEST ')).toBe('dana@example.test');
    });

    it.each([
        ['no address', ''],
        ['not a string', 42],
        ['not an address', 'dana@'],
        ['a placeholder an import made up', 'driver-17@placeholder.safehaulapp.com'],
        ['a legacy placeholder', 'someone@system.local'],
    ])('is refused for %s', (_label, value) => {
        expect(deliverableEmail(value)).toBe('');
    });

    it('is told to the caller masked, the domain kept so they can tell which inbox', () => {
        expect(maskEmail('dana@example.test')).toBe('d***@example.test');
        expect(maskEmail('a@b.co')).toBe('a***@b.co');
    });
});

describe('where the emailed link points', () => {
    it.each([
        'https://app.safehaul.io',
        'https://safehaul-app-production.web.app',
        'https://safehaul-app-production.firebaseapp.com',
        'https://truckerapp-system.web.app',
        'https://truckerapp-system.firebaseapp.com',
    ])('keeps the app’s own site %s, so Testing links open Testing', (origin) => {
        expect(appOriginFor(origin)).toBe(origin);
        expect(appOriginFor(`${origin}/company/drivers`)).toBe(origin);
    });

    it.each([
        ['another site', 'https://evil.example'],
        ['a look-alike', 'https://app.safehaul.io.evil.example'],
        ['plain http', 'http://app.safehaul.io'],
        ['another port', 'https://app.safehaul.io:8443'],
        ['a local dev server', 'http://localhost:5000'],
        ['nothing', undefined],
        ['not a URL', 'app.safehaul.io'],
    ])('falls back to Production for %s, so a caller cannot point a driver elsewhere', (_label, value) => {
        expect(appOriginFor(value)).toBe('https://app.safehaul.io');
    });
});

describe('asking for delivery', () => {
    it('is off unless asked, and email is the one channel', () => {
        expect(readDeliver({})).toBeNull();
        expect(readDeliver(undefined)).toBeNull();
        expect(readDeliver({ deliver: null })).toBeNull();
        expect(readDeliver({ deliver: 'email' })).toBe('email');
    });

    it.each(['sms', 'EMAIL', true, 1])('refuses %p', (deliver) => {
        expect(() => readDeliver({ deliver })).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    });
});

describe('one press, one email', () => {
    const now = Date.parse('2026-11-04T12:00:00Z');

    it('claims with the masked address and nothing that opens the link', () => {
        const claim = deliveryClaim({ uid: 'u1', to: 'dana@example.test', now });
        expect(claim).toMatchObject({
            channel: 'email', status: 'sending', to: 'd***@example.test', by: 'u1', sentAt: null, failedAt: null,
        });
        expect(claim.claimId).toEqual(expect.any(String));
        expect(claim.claimedAt.getTime()).toBe(now);
    });

    it('cools down a claim being sent or sent within the minute, and not a failed or older one', () => {
        const at = (ms, status) => ({ status, claimedAt: new Date(now - ms) });
        expect(deliveryCoolingDown(at(1000, 'sending'), now)).toBe(true);
        expect(deliveryCoolingDown(at(DELIVERY_COOLDOWN_MS - 1, 'sent'), now)).toBe(true);
        expect(deliveryCoolingDown(at(DELIVERY_COOLDOWN_MS, 'sent'), now)).toBe(false);
        expect(deliveryCoolingDown(at(1000, 'failed'), now)).toBe(false);
        expect(deliveryCoolingDown(null, now)).toBe(false);
        // A Firestore Timestamp as read back.
        expect(deliveryCoolingDown({ status: 'sent', claimedAt: { toMillis: () => now - 5 } }, now)).toBe(true);
    });
});

describe('the email', () => {
    it('escapes what it is given and links the button to the URL', () => {
        const html = linkEmailHtml({
            heading: 'Your <application>',
            greeting: 'Hello <b>Dana</b>,',
            paragraphs: ['A & B'],
            buttonLabel: 'Open it',
            url: 'https://app.safehaul.io/apply/x?invite=t&k=k',
            footnote: 'Just for you.',
        });
        expect(html).toContain('Your &lt;application&gt;');
        expect(html).toContain('Hello &lt;b&gt;Dana&lt;/b&gt;,');
        expect(html).toContain('A &amp; B');
        expect(html).toContain('href="https://app.safehaul.io/apply/x?invite=t&amp;k=k"');
    });
});
