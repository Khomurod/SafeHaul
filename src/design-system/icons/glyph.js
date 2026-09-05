/**
 * Glyph tokens — what `@design-system/icons` hands out instead of components.
 *
 * ## Why a token rather than a re-export
 *
 * The obvious shape for this module is `export { Trash2 } from 'lucide-react'`,
 * and it would be worse than useless. The whole point of the icon contract is
 * that a glyph's SIZE comes from a six-step scale rather than from whichever
 * pixel number the call site felt like typing — and a re-exported component
 * still renders happily as `<Trash2 size={13} />`. The import path would have
 * moved and nothing else would have changed, which is the campaign's failure
 * mode dressed as its success.
 *
 * So a glyph is not a component. It is an opaque handle that only `Icon` knows
 * how to open:
 *
 *     import { Icon, Trash2 } from '@/design-system/icons';
 *     <Icon icon={Trash2} size="sm" />        // renders
 *     <Trash2 size={13} />                    // throws, by name, at the call site
 *
 * That last line is the guard, and it is the kind this repository prefers: it
 * cannot be satisfied by a check that forgot to look. A static rule would have
 * to recognise every spelling of "render this glyph", including the one it
 * structurally cannot see — `const Glyph = ICONS[status]; <Glyph size={16} />`,
 * where the name is not in the source at all.
 *
 * ## The migration hatch, and where it dies
 *
 * 178 files still import straight from `lucide-react` and hand those raw
 * components to design-system containers as props —
 * `<PageState icon={AlertTriangle} />`. Those containers therefore resolve their
 * `icon` prop through `glyphComponent`, which passes a bare component through
 * untouched. When the last of them is migrated the only way to obtain a glyph is
 * this module, every value flowing into `icon` is a token, and the passthrough
 * branch can be deleted with nothing left to catch.
 */

/**
 * `Symbol.for` rather than a module-local symbol: Vitest and Storybook can each
 * end up with their own copy of this module's graph, and a token minted in one
 * copy must still be recognised by an `Icon` from the other. A local symbol
 * would make that a silent "not a glyph" failure in exactly the environments
 * where the tests run.
 */
export const GLYPH = Symbol.for('safehaul.design-system.glyph');

/**
 * Wrap one icon component as a token.
 *
 * `name` is passed explicitly rather than read from `component.displayName`,
 * and that is not redundancy. 33 of the 171 names this application uses are
 * lucide COMPATIBILITY ALIASES whose `displayName` is the newer canonical name:
 * `AlertCircle` reports `CircleAlert`, `Home` reports `House`, `Filter` reports
 * `Funnel`. Deriving the name would have quietly renamed a fifth of the
 * registry to identifiers that appear nowhere in this codebase, so every error
 * message and every test would have named a glyph nobody could grep for.
 */
export function glyph(component, name) {
    if (typeof name !== 'string' || name.trim() === '') {
        throw new TypeError('glyph: `name` must be a non-empty string.');
    }
    if (component === null || component === undefined) {
        throw new TypeError(`glyph: no icon component was supplied for ${name}.`);
    }

    const token = function GlyphToken() {
        throw new TypeError(
            `${name} is an icon token, not a component. Render it through the `
            + `contract instead:  <Icon icon={${name}} size="md" />  — with a step `
            + 'from the scale rather than a pixel number, which is what the icon '
            + 'contract exists to replace. `Icon` names the steps if you miss.',
        );
    };
    token.displayName = `Glyph(${name})`;
    token[GLYPH] = Object.freeze({ component, name });
    return token;
}

/** The token's `{ component, name }` record, or `null` for anything else. */
export function glyphEntry(value) {
    return (typeof value === 'function' && value[GLYPH]) || null;
}

/**
 * The renderable component behind a value: a token's glyph, or — during the
 * migration described above — a bare component passed straight through.
 * `null`/`undefined` come back unchanged so callers can keep their own
 * "no icon" branch.
 */
export function glyphComponent(value) {
    return glyphEntry(value)?.component ?? value;
}
