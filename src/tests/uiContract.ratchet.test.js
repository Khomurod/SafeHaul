/**
 * Proves the UI contract guard can actually fail.
 *
 * `scripts/check-ui-contract.mjs` is the thing standing between this codebase
 * and the state it was in before the design-system campaign: 680 raw palette
 * classes, off-scale type, sub-12px text and hand-built controls, every one of
 * which passed review, lint, 234 test files and CI. A guard that cannot fail on
 * a broken input is not a guard — the repository learned that from
 * `check:table-layout`, and this holds the same line.
 *
 * These tests run the real rule engine over seeded source strings rather than
 * over the tree, so they stay fast and stay honest about *which* rule fires.
 */
import { describe, expect, it } from 'vitest';
import { countViolations, stripComments } from '../../scripts/check-ui-contract.mjs';

const count = (source, rule) => countViolations(source)[rule] ?? 0;

describe('the guard fires on the defects it exists for', () => {
    it.each([
        ['raw-palette-class', '<div className="bg-blue-600 text-gray-500" />'],
        ['raw-hex-colour', '<div className="bg-[#ff0000]" />'],
        ['sub-12px-type', '<span className="text-[10px]">x</span>'],
        ['off-scale-type', '<span className="text-xs">x</span>'],
        ['arbitrary-type-size', '<span className="text-[17px]">x</span>'],
        ['hand-built-overlay', '<div className="fixed inset-0 bg-black" />'],
        ['raw-table', '<table><tbody /></table>'],
        ['hand-styled-button', '<button className="px-4 py-2 bg-ds-surface rounded">Go</button>'],
        ['hand-styled-field', '<input className="border rounded px-3" />'],
        ['hand-styled-anchor', '<a href="/x" className="px-4 py-2 rounded border">Go</a>'],
        ['tailwind-radius', '<div className="rounded-lg" />'],
        ['tailwind-shadow', '<div className="shadow-sm" />'],
    ])('catches %s', (rule, source) => {
        expect(count(source, rule)).toBeGreaterThan(0);
    });

    it('counts every occurrence, not just the first', () => {
        // A file that adds five is not the same as a file that adds one, and the
        // ratchet compares numbers.
        const source = '<div className="bg-blue-600 text-red-500 border-gray-200" />';
        expect(count(source, 'raw-palette-class')).toBe(3);
    });
});

/**
 * The other half. A guard that fires on correct code gets an exemption added
 * instead of a fix, or gets switched off — so every one of these must stay
 * silent.
 */
describe('the guard stays silent on correct code', () => {
    it.each([
        ['semantic tokens', '<div className="bg-ds-surface text-ds-content border-ds-border" />'],
        ['the ds type scale', '<span className="text-ds-xs">x</span><span className="text-ds-heading-md">y</span>'],
        ['an unstyled semantic button', '<button type="button" onClick={go}>Go</button>'],
        ['a layout-only button', '<button type="button" className="flex items-center gap-ds-2">Go</button>'],
        ['a plain anchor', '<a href="/records">All records</a>'],
        ['a design-system component', '<Button variant="primary">Go</Button>'],
        ['a Link with external', '<Link href="https://x.example" external>Docs</Link>'],
        ['the ds radius scale', '<div className="rounded-ds-md rounded-t-ds-lg" />'],
        ['the ds shadow scale', '<div className="shadow-ds-xs shadow-ds-lg" />'],
        ['a focus ring, which is not a shadow step', '<div className="focus-visible:shadow-ds-focus" />'],
    ])('does not flag %s', (_name, source) => {
        expect(countViolations(source)).toEqual({});
    });

    /*
     * Tailwind's radius and shadow scales share their names with the `--ds-*`
     * ones and sit one step off them: `rounded-lg` is 8px where
     * `rounded-ds-lg` is 12px. A rule written to match the bare names must not
     * also swallow the prefixed ones, or the guard silently stops guarding the
     * thing it was written for.
     */
    it('tells the two radius scales apart rather than matching on the suffix', () => {
        const source = '<div className="rounded-ds-lg rounded-t-ds-full rounded-ds-card" />';
        expect(count(source, 'tailwind-radius')).toBe(0);
        expect(count('<div className="rounded-lg rounded-t-full" />', 'tailwind-radius')).toBe(2);
    });

    it('tells the two shadow scales apart, and leaves the focus ring alone', () => {
        expect(count('<div className="shadow-ds-md shadow-ds-focus" />', 'tailwind-shadow')).toBe(0);
        expect(count('<div className="shadow-md shadow-inner" />', 'tailwind-shadow')).toBe(2);
    });

    it('does not flag an overlayClassName passed to Modal', () => {
        // The roadmap approves this: a scan should return `Modal` itself and its
        // `overlayClassName` callers. Counting them would have fired on 20
        // correct call sites.
        const source = '<Modal overlayClassName="fixed inset-0 z-50 flex bg-ds-overlay p-4">{body}</Modal>';
        expect(count(source, 'hand-built-overlay')).toBe(0);
    });

    it('still flags a hand-built overlay in a file that also passes overlayClassName', () => {
        // The exemption must not become a blanket pass for the whole file.
        const source = [
            '<Modal overlayClassName="fixed inset-0 z-50 flex">{body}</Modal>',
            '<div className="fixed inset-0 z-40" />',
        ].join('\n');
        expect(count(source, 'hand-built-overlay')).toBe(1);
    });
});

/**
 * Comments are stripped, strings are not.
 *
 * This is the exact opposite of `noBlockingBrowserDialogs.test.js`, and for the
 * opposite reason: a class name lives *inside* a string literal, so stripping
 * strings would blind every rule. But this repository documents the defects it
 * fixed in prose, and several files name the exact `bg-blue-600` they removed.
 */
describe('comment handling', () => {
    it('ignores a violation named in a line comment', () => {
        expect(countViolations('// this used to be bg-blue-600\nconst a = 1;')).toEqual({});
    });

    it('ignores a violation named in a block comment', () => {
        expect(countViolations('/* was text-[10px], now text-ds-xs */\nconst a = 1;')).toEqual({});
    });

    it('does not ignore a violation in a string, which is where class names live', () => {
        expect(count('const c = "bg-blue-600";', 'raw-palette-class')).toBe(1);
    });

    it('does not treat a // inside a string as the start of a comment', () => {
        // A URL in a className-adjacent string must not blind the rest of the line.
        const source = 'const u = "https://x.example"; const c = "bg-blue-600";';
        expect(count(source, 'raw-palette-class')).toBe(1);
    });

    it('keeps template literals, which is how conditional class lists are written', () => {
        const source = 'const c = `px-2 ${on ? "bg-blue-600" : "bg-ds-surface"}`;';
        expect(count(source, 'raw-palette-class')).toBe(1);
    });

    it('preserves line numbering when stripping, so offsets stay usable', () => {
        const stripped = stripComments('/* a\nb\nc */\nconst x = 1;');
        expect(stripped.split('\n')).toHaveLength(4);
    });
});
