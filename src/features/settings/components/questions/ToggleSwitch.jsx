import React from 'react';

/**
 * Accessible on/off switch (WAI-ARIA switch pattern).
 *
 * Feature-level composition: the design system has no approved Switch/Checkbox
 * primitive yet (see the roadmap Radio/checkbox item), so this business-neutral
 * control lives with the feature that needs it and is styled only with `--ds-*`
 * tokens. It adds no SafeHaul, question, or compliance knowledge.
 *
 * - A native `<button role="switch">` exposes state via `aria-checked` (not
 *   color alone) and is keyboard-operable by default (Space/Enter).
 * - `label` is required and becomes the unique accessible name
 *   (e.g. "Require Social Security Number").
 * - The thumb position is a non-color visual cue; `tone` only tints the on
 *   state to preserve the original required=positive / hidden=negative meaning.
 */
const TONES = new Set(['primary', 'success', 'danger']);

export function ToggleSwitch({
    checked = false,
    onChange,
    label,
    tone = 'primary',
    disabled = false,
    id,
}) {
    if (typeof label !== 'string' || label.trim() === '') {
        throw new TypeError('ToggleSwitch requires a non-empty label.');
    }
    if (!TONES.has(tone)) {
        throw new TypeError(`Unsupported ToggleSwitch tone: ${tone}`);
    }

    const onBackground = {
        primary: 'bg-ds-action-primary',
        success: 'bg-ds-status-success-fg',
        danger: 'bg-ds-status-danger-fg',
    }[tone];

    return (
        <button
            type="button"
            role="switch"
            id={id}
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className={[
                'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors',
                'focus-visible:outline-none focus-visible:shadow-ds-focus',
                'disabled:cursor-not-allowed disabled:opacity-60',
                checked ? `${onBackground} border-transparent` : 'bg-ds-surface-subtle border-ds-border',
            ].join(' ')}
        >
            <span
                aria-hidden="true"
                className={[
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-ds-surface shadow-ds-xs transition-transform',
                    checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
                ].join(' ')}
            />
        </button>
    );
}

export default ToggleSwitch;
