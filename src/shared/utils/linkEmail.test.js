import { describe, expect, it } from 'vitest';
import { canEmailLinkTo } from './linkEmail';

/** The browser's half of `deliverableEmail` (`functions/shared/linkDelivery.js`): whether to offer the button. */
describe('canEmailLinkTo', () => {
    it('offers a real address', () => {
        expect(canEmailLinkTo('dana@example.test')).toBe(true);
        expect(canEmailLinkTo('  Dana@Example.test ')).toBe(true);
    });

    it.each([
        ['nothing', undefined],
        ['an empty address', ''],
        ['not an address', 'dana@'],
        ['a placeholder an import made up', 'lead-1@placeholder.safehaulapp.com'],
        ['a legacy placeholder', 'x@system.local'],
    ])('does not offer %s', (_label, email) => {
        expect(canEmailLinkTo(email)).toBe(false);
    });
});
