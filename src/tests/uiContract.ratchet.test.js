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
// Imported from the library modules, not the CLI entry: Vitest rewrites
// `import.meta.url`, so anything evaluated at the CLI's module scope would run
// inside that rewrite. `scripts/test-ui-contract.mjs` pins that nothing under
// `src/` imports `check-ui-contract.mjs`.
import { countViolations } from '../../scripts/ui-contract/counting.mjs';
import { stripComments } from '../../scripts/ui-contract/source-text.mjs';

const count = (source, rule) => countViolations(source)[rule] ?? 0;

describe('the guard fires on the defects it exists for', () => {
    it.each([
        ['raw-palette-class', '<div className="bg-blue-600 text-gray-500" />'],
        ['raw-hex-colour', '<div className="bg-[#ff0000]" />'],
        // The two shapes the rule could not see until 2026-09-05. Every raw
        // colour still in this tree is spelled one of these ways: the brand
        // marks used SVG attributes, and the signature pads assign to a canvas
        // context. Widening the rule to cover them found four unrecorded sites.
        ['raw-hex-colour in an SVG attribute', '<path fill="#004C68" />'],
        ['raw-hex-colour on a gradient stop', '<stop stopColor="#0CE1A5" />'],
        ['raw-hex-colour assigned to a canvas context', "ctx.strokeStyle = '#333';"],
        ['raw-hex-colour in a declaration', "const SIGNATURE_INK = '#0f172a';"],
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
        ['jsx-label-on-throwing-primitive', '<FormField id="x" label={(<span>Date</span>)}>{c}</FormField>'],
    ])('catches %s', (rule, source) => {
        // The label carries the shape for readability; the rule is its first word.
        expect(count(source, rule.split(' ')[0])).toBeGreaterThan(0);
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
        ['a string label', '<FormField id="x" label="Filter by date">{c}</FormField>'],
        ['a JSX title on PageHeader, which accepts one', '<PageHeader title={(<span>My Profile</span>)} />'],
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

    /*
     * The rule names the primitives that THROW on a non-string label. Widening
     * it to every `label={(` would fire on `PageHeader`, which accepts JSX
     * titles quite legitimately — and a check that flags correct code is a check
     * someone turns off.
     */
    it('catches the JSX label on each throwing primitive, and only those', () => {
        for (const tag of ['FormField', 'Checkbox', 'Switch', 'IconButton', 'FileInput']) {
            expect(count(`<${tag} label={<span>x</span>} />`, 'jsx-label-on-throwing-primitive')).toBe(1);
        }
        expect(count('<PageHeader title={<span>x</span>} />', 'jsx-label-on-throwing-primitive')).toBe(0);
        expect(count('<Badge label={<span>x</span>} />', 'jsx-label-on-throwing-primitive')).toBe(0);
    });

    /*
     * A `#` is only sometimes a colour, and the widened rule has to tell the
     * difference. These are the forms that live in this tree and must stay
     * silent — a rule that fires on `url(#grad)` or an anchor target would be
     * switched off within a day.
     */
    it.each([
        ['currentColor', '<path fill="currentColor" />'],
        ['an explicit no-fill', '<path fill="none" />'],
        ['a token reference', '<path fill="var(--ds-color-brand-deep)" />'],
        ['a gradient reference', '<path fill="url(#paint0_linear_logo)" />'],
        ['an in-page anchor', '<a href="#main">Skip to content</a>'],
        ['a placeholder that looks like a hex', '<input placeholder="#1234567" />'],
        ['an id selector in a query', "const node = document.querySelector('#signature-canvas');"],
    ])('does not read %s as a colour', (_name, source) => {
        expect(count(source, 'raw-hex-colour')).toBe(0);
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
