/**
 * A design-system prop check throws outside a production build and reports in one.
 *
 * One check, run on a production build, once took a whole step of the driver
 * application down over a company question with a blank option. A production
 * build now reports a violation once per message, to the console and Sentry,
 * and returns, so the component draws its default; everywhere else the check
 * still throws where the misuse is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/react', () => ({ captureException }));

import { contractViolation } from './contract';

let consoleError;

beforeEach(() => {
    captureException.mockReset();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    consoleError.mockRestore();
});

describe('contractViolation', () => {
    it('throws a TypeError with the message outside a production build', () => {
        expect(() => contractViolation('Unsupported Badge tone: loud')).toThrow(
            new TypeError('Unsupported Badge tone: loud'),
        );
        expect(captureException).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
    });

    it('reports to the console and Sentry and returns in a production build', () => {
        vi.stubEnv('PROD', true);

        expect(contractViolation('Unsupported Chip size: huge')).toBeUndefined();

        expect(consoleError).toHaveBeenCalledTimes(1);
        const [error, context] = captureException.mock.calls[0];
        expect(error).toBeInstanceOf(TypeError);
        expect(error.message).toBe('Unsupported Chip size: huge');
        expect(context).toEqual({
            level: 'warning',
            tags: { area: 'design-system-contract' },
            fingerprint: ['design-system-contract', 'Unsupported Chip size: huge'],
        });
    });

    it('reports a message once, however often it is rendered, and a new one again', () => {
        vi.stubEnv('PROD', true);

        contractViolation('Unsupported Card padding: xl');
        contractViolation('Unsupported Card padding: xl');
        contractViolation('Unsupported Card padding: xs');

        expect(captureException.mock.calls.map(([error]) => error.message)).toEqual([
            'Unsupported Card padding: xl',
            'Unsupported Card padding: xs',
        ]);
        expect(consoleError).toHaveBeenCalledTimes(2);
    });
});
