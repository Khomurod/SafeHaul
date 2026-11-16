/**
 * Runs the shared vectors against the server's maskSsn. The screens' copy
 * (`src/shared/utils/maskSsn.js`) runs the same vectors under vitest
 * (`src/shared/utils/maskSsn.test.js`), so the two cannot drift apart.
 */
const vectors = require('../../shared/maskSsn.vectors.json');
const { maskSsn } = require('../../shared/maskSsn');
const applicationText = require('../../shared/pdf/applicationText');

describe('maskSsn (server) — shared vectors', () => {
    it.each(vectors.maskSsn.map(({ input, expected }) => [JSON.stringify(input), input, expected]))(
        '%s → %j',
        (_label, input, expected) => {
            expect(maskSsn(input)).toBe(expected);
        },
    );
});

describe('the application PDF prints the SSN with the shared rule', () => {
    const answer = (value) => ({ fieldId: 'ssn', sensitive: true, value, displayValue: value });

    it('prints a nine-digit SSN as it always has', () => {
        expect(applicationText.scalarValue(answer('412-88-7391'), { includeFullSsn: false })).toBe('***-**-7391');
        expect(applicationText.scalarValue(answer('412887391'), { includeFullSsn: false })).toBe('***-**-7391');
    });

    it('never prints a piece of a value that is not a number', () => {
        expect(applicationText.scalarValue(answer('Unknown'), { includeFullSsn: false })).toBe('***-**-****');
    });

    it('leaves a blank answer to the "Not provided" line', () => {
        expect(applicationText.scalarValue(answer('  '), { includeFullSsn: false })).toBeNull();
    });
});
