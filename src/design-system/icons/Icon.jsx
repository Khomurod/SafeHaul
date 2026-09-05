import React from 'react';
import { glyphComponent, glyphEntry } from './glyph.js';
import './Icon.css';

/**
 * The icon contract.
 *
 * ## What it is for
 *
 * 209 files import glyphs straight from `lucide-react` and pass a pixel number:
 * `size={18}`, `size={13}`, `size={22}`. Nothing is wrong with any one of them,
 * and together they are the problem the rest of this system was built to end —
 * a decision taken 209 times instead of once. This turns the number into a step
 * on a scale, and the package name into a design-system import.
 *
 * ## The accessibility rule, and why it is a rule rather than a default
 *
 * A glyph is either **decoration beside a word**, in which case a screen reader
 * announcing it is noise, or it is **the whole control**, in which case it must
 * carry a name or the control is announced as nothing at all.
 *
 * There is no safe default between those, so the prop decides:
 *
 *     <Icon icon={Trash2} />                  aria-hidden, announced by nothing
 *     <Icon icon={Trash2} label="Delete" />   role="img", announced as "Delete"
 *
 * The common case is the first, which is why it is what you get for free. The
 * second is opt-in because a name is a content decision — only the call site
 * knows what the glyph means there.
 *
 * A blank or whitespace `label` throws rather than rendering an unnamed
 * `role="img"`, which is worse than either honest option: it announces an image
 * and then says nothing about it. That is the contract `IconButton` and
 * `FormField` already hold, for the same reason.
 *
 * ## What `icon` accepts
 *
 * A **glyph token** from `@design-system/icons` — and, until the lucide backlog
 * reaches zero, a bare icon component, because 178 unmigrated files still hand
 * raw `lucide-react` components to design-system containers as props. See
 * `glyph.js`; that branch is deleted with the backlog.
 */

/** The seven steps, and the CSS attribute each maps to. */
export const ICON_SIZES = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];

export function Icon({
    icon,
    size = 'md',
    label,
    className = '',
    ...svgProps
}) {
    const Glyph = glyphComponent(icon);
    if (typeof Glyph !== 'function' && (typeof Glyph !== 'object' || Glyph === null)) {
        throw new TypeError(
            'Icon: `icon` must be a glyph from `@design-system/icons` — received '
            + `${icon === undefined ? 'nothing' : typeof icon}. Import the name from the `
            + 'design system rather than from an icon package directly.',
        );
    }
    if (!ICON_SIZES.includes(size)) {
        const named = glyphEntry(icon)?.name;
        throw new TypeError(
            `Icon: unsupported size ${JSON.stringify(size)}${named ? ` for ${named}` : ''}. `
            + `Expected one of ${ICON_SIZES.map((step) => `'${step}'`).join(', ')}. A pixel `
            + 'number is what this contract exists to replace — 209 call sites had each '
            + 'picked their own.',
        );
    }
    if (label !== undefined && (typeof label !== 'string' || label.trim() === '')) {
        throw new TypeError(
            'Icon: `label` must be a non-empty string. Omit it entirely for a decorative '
            + 'glyph — an empty label renders `role="img"` with no name, which announces '
            + 'an image and then says nothing about it.',
        );
    }

    const named = label !== undefined;
    return (
        <Glyph
            {...svgProps}
            className={`ds-icon ${className}`.trim()}
            data-size={size}
            /*
             * The size is the CSS's job, not the glyph's. Passing `size` through
             * would set width/height ATTRIBUTES, which a stylesheet cannot
             * override at a breakpoint — and the container-sizes-its-own-glyph
             * rules in `Button.css` and `Tabs.css` depend on being able to.
             * lucide's own default attributes stay, and lose to the CSS below,
             * which is why nothing here has to fight them.
             */
            strokeWidth={svgProps.strokeWidth ?? 2}
            focusable="false"
            aria-hidden={named ? undefined : 'true'}
            role={named ? 'img' : undefined}
            aria-label={named ? label : undefined}
        />
    );
}

export default Icon;
