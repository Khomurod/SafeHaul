/**
 * What the CONTRACT wants — the deciding half of the lucide codemod.
 *
 * The icon scale, the rule for turning a call site's stated size into a step on
 * it, and the attributes the contract now supplies so a call site should stop
 * stating them. This is the half that changes when the design system changes;
 * `read.mjs` is the half that changes when JavaScript does.
 */
import { SIZING_CONTAINERS } from './read.mjs';

/** Pixel → step, from `foundation.css` `--ds-icon-size-*`. */
export const STEP_FOR_PIXELS = new Map([
    [12, 'xs'], [14, 'sm'], [16, 'md'], [18, 'lg'], [20, 'xl'], [24, '2xl'], [32, '3xl'],
]);

/** Tailwind's `h-N`/`w-N` are quarter-rem: `h-4` is 1rem is 16px. */
export const PIXELS_FOR_TAILWIND_STEP = new Map([
    [3, 12], [3.5, 14], [4, 16], [5, 20], [6, 24], [8, 32],
]);

/**
 * Containers that size the glyph they are handed, so a bare glyph inside one
 * was never 24px and must not gain a size. Used only to sharpen a flag's
 * wording — the flag is raised either way, because an ancestor is not something
 * a line-oriented scan can prove.
 */

/**
 * Decide the size step for one open tag.
 *
 * Returns `{ step, tag }` when the answer is provable, or `{ flag }` when it is
 * a design decision. `tag` comes back with the attributes the transform consumed
 * already removed, so the caller never has to strip them twice.
 */
export function resolveSize(tag) {
    const pixels = tag.match(/\s+size=\{(\d+)\}/);
    if (pixels) {
        const value = Number(pixels[1]);
        const step = STEP_FOR_PIXELS.get(value);
        if (!step) {
            return {
                flag: `size={${value}} is not a step on the scale `
                    + `(${[...STEP_FOR_PIXELS.keys()].join('/')}). Snapping it changes what `
                    + 'is on screen — decide whether the glyph belongs in a container that '
                    + 'owns this size (StatusMedallion, PageState) or whether the nearest '
                    + 'step is right.',
            };
        }
        return { step, tag: tag.replace(pixels[0], '') };
    }

    const geometry = tag.match(/\s+className="([^"]*)"/);
    if (geometry) {
        const height = geometry[1].match(/(?:^|\s)h-(\d+(?:\.5)?)(?=\s|$)/);
        const width = geometry[1].match(/(?:^|\s)w-(\d+(?:\.5)?)(?=\s|$)/);
        if (height && width) {
            if (height[1] !== width[1]) {
                return { flag: `h-${height[1]} and w-${width[1]} disagree — a glyph is square.` };
            }
            const value = PIXELS_FOR_TAILWIND_STEP.get(Number(height[1]));
            const step = value && STEP_FOR_PIXELS.get(value);
            if (!step) {
                return {
                    flag: `h-${height[1]} w-${width[1]} is not a step on the scale. Same `
                        + 'decision as an off-scale pixel size.',
                };
            }
            const stripped = geometry[1]
                .replace(/(?:^|\s)[hw]-\d+(?:\.5)?(?=\s|$)/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const attribute = stripped ? ` className="${stripped}"` : '';
            // The whole run of whitespace was consumed with the attribute, so a
            // surviving className brings its own single space back.

            return { step, tag: tag.replace(geometry[0], attribute) };
        }
    }

    return {
        flag: 'no size at all. lucide renders 24px by default and the contract renders 16 — '
            + 'so this is size="2xl" if the glyph stands alone, and no size at all if a '
            + 'container already sizes it'
            + (SIZING_CONTAINERS.test(tag) ? ' (a sizing container is on this very tag)' : '')
            + '. The two look identical here.',
    };
}

/**
 * Attributes the contract now supplies, which a call site should stop stating.
 *
 * `\s+` and not `\s`, because a tag written across several lines puts a newline
 * and an indent in front of each attribute. Consuming one space left the rest
 * behind, and a four-line tag came out with two whitespace-only lines in the
 * middle of it:
 *
 *     <Icon icon={FileSignature} size="lg"
 *
 *
 *         className={…} />
 *
 * Lint passes on that and a reviewer should not have to. Taking the whole run
 * closes the gap the attribute leaves, so a one-line tag stays on one line and a
 * multi-line tag keeps its shape with one fewer line.
 */
export function dropDefaults(tag) {
    return tag
        .replace(/\s+aria-hidden=(?:"true"|\{true\})/g, '')
        .replace(/\s+strokeWidth=\{2\}/g, '')
        .replace(/\s+focusable="false"/g, '');
}
