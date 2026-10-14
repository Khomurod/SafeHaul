import { describe, expect, it } from 'vitest';
import { returnPathFrom } from './returnPath';

describe('the page signing in returns to', () => {
    it('is the path the protected route handed over, with its query and fragment', () => {
        expect(returnPathFrom({ from: '/company/drivers/applications?tab=leads#row-3' }))
            .toBe('/company/drivers/applications?tab=leads#row-3');
    });

    it('is none when no page was asked for', () => {
        expect(returnPathFrom(undefined)).toBeNull();
        expect(returnPathFrom(null)).toBeNull();
        expect(returnPathFrom({})).toBeNull();
        expect(returnPathFrom({ from: { pathname: '/company/dashboard' } })).toBeNull();
    });

    it('is never another site', () => {
        for (const from of ['//elsewhere.example/a', '/\\elsewhere.example/a', 'https://elsewhere.example/a', 'company/dashboard']) {
            expect(returnPathFrom({ from })).toBeNull();
        }
    });
});
