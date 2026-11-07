/**
 * Runs the shared vectors against the screens' maskSsn. The server's copy
 * (`functions/shared/maskSsn.js`) runs the same vectors under jest
 * (`functions/test/unit/maskSsn.test.js`), so the two cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import vectors from '../../../functions/shared/maskSsn.vectors.json';
import { maskSsn } from './maskSsn';

describe('maskSsn (screens) — shared vectors', () => {
    it.each(vectors.maskSsn.map(({ input, expected }) => [JSON.stringify(input), input, expected]))(
        '%s → %j',
        (_label, input, expected) => {
            expect(maskSsn(input)).toBe(expected);
        },
    );
});
