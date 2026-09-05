/**
 * `@design-system/icons` — the icon contract's public surface.
 *
 * Import both halves from here:
 *
 *     import { Icon, Trash2 } from '@/design-system/icons';
 *     <Icon icon={Trash2} size="sm" />
 *
 * `glyph` is exported for the registry itself and for tests; application code
 * has no reason to mint a token by hand — add the name to `glyphs.js` instead,
 * which is two lines and is what `check:icon-contract` measures.
 */

export { Icon, ICON_SIZES } from './Icon.jsx';
export { GLYPH, glyph, glyphEntry, glyphComponent } from './glyph.js';
export * from './glyphs.js';
