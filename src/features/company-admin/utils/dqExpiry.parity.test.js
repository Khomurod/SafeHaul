/**
 * The DQ tab reads a record's valid-until date with `calendarDay`, and the
 * server's `dqExpiresNext` (`functions/shared/dqExpiry.js`) with its own copy.
 * If they read a date differently, Needs attention and the DQ tab disagree on
 * which document runs out first. The server module loads the Admin SDK, which
 * the site's tests do not have, so the two copies are compared as written:
 * the function and the pattern it reads with, character for character.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { calendarDay } from './dqExpiry';

const read = (path) => readFileSync(resolve(__dirname, path), 'utf8');
const site = read('./dqExpiry.js');
const server = read('../../../../functions/shared/dqExpiry.js');

/** `function calendarDay(...) {` through its closing brace at the start of a line. */
const calendarDaySource = (source) => {
    const start = source.indexOf('function calendarDay(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n}\n', start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end + 2);
};
const dayPattern = (source) => source.split('\n').find((line) => line.startsWith('const DAY = '));

describe('calendarDay: the DQ tab and the server', () => {
    it('is the same function, reading with the same pattern', () => {
        expect(calendarDaySource(site)).toBe(calendarDaySource(server));
        expect(dayPattern(site)).toBeDefined();
        expect(dayPattern(site)).toBe(dayPattern(server));
    });

    it.each([
        ['2026-11-07', '2026-11-07'],
        [' 2026-11-07T12:00:00Z', '2026-11-07'],
        ['2026-02-29', null],
        ['2028-02-29', '2028-02-29'],
        ['11/07/2026', null],
        ['', null],
        [null, null],
    ])('reads %j as %j', (value, expected) => {
        expect(calendarDay(value)).toBe(expected);
    });
});
