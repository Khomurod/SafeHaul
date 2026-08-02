import React, { useId } from 'react';
import { FieldMessage } from '@/design-system/components';

/**
 * Feature-local accessible radio group for the verification portal.
 *
 * Behavior is unchanged from the original: native `<input type="radio">`
 * controls grouped by `name` (so arrow keys move within the group), exact
 * `options[].value` selection via `onChange(value)`, and the same visual dot.
 * This is NOT a design-system primitive — the design-system Radio/Checkbox is a
 * separate, not-yet-started roadmap item; the verification feature owns this
 * control until that lands.
 *
 * Accessibility added on top of the original: a `<fieldset>`/`<legend>` group
 * label, a visible keyboard focus ring (`focus-within`), an associated
 * description and error (`aria-describedby`), and `aria-required`.
 */
export const RadioGroup = ({
    name,
    legend,
    description,
    required = false,
    value,
    onChange,
    options,
    error: fieldError,
}) => {
    const rawId = useId().replace(/:/g, '');
    const descriptionId = description ? `${name}-${rawId}-description` : undefined;
    const errorId = fieldError ? `${name}-${rawId}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <fieldset className="m-0 min-w-0 border-0 p-0">
            {legend && (
                <legend className="mb-1 p-0 text-ds-sm font-semibold text-ds-content">
                    {legend}
                    {required && (
                        <>
                            <span className="text-ds-status-danger-fg" aria-hidden="true"> *</span>
                            <span className="ds-visually-hidden"> required</span>
                        </>
                    )}
                </legend>
            )}
            {/*
              DEFECT FIX (2026-07-27): this was `text-ds-content-muted`. That is
              slate-500, and the roadmap already records `content-muted` as
              **approved on `surface` only** — it fails AA on tinted surfaces.
              Two of these groups render inside the drug-and-alcohol block, whose
              background is `--ds-color-status-warning-bg`, where it measured
              4.27:1 in Chromium against the required 4.5:1. Real-browser axe
              reported it as a serious `color-contrast` violation.

              `content-secondary` is the remedy the token blocker already
              prescribes for exactly this pairing, and it is darker on every
              surface, so the untinted groups improve too.
            */}
            {description && (
                <p id={descriptionId} className="mb-2 text-ds-xs text-ds-content-secondary">
                    {description}
                </p>
            )}
            <div className="mt-1 flex flex-wrap gap-ds-4">
                {options.map((opt) => (
                    <label
                        key={String(opt.value)}
                        className="group inline-flex cursor-pointer items-center gap-ds-2 rounded-ds-md px-1 py-0.5 focus-within:shadow-ds-focus"
                    >
                        <span
                            aria-hidden="true"
                            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                                value === opt.value
                                    ? 'border-ds-action-primary bg-ds-action-primary'
                                    : 'border-ds-border group-hover:border-ds-content-muted'
                            }`}
                        >
                            {value === opt.value && <span className="h-2 w-2 rounded-full bg-ds-content-inverse" />}
                        </span>
                        <input
                            type="radio"
                            name={name}
                            className="sr-only"
                            checked={value === opt.value}
                            onChange={() => onChange(opt.value)}
                            aria-describedby={describedBy}
                            aria-required={required || undefined}
                        />
                        <span
                            className={`text-ds-sm font-medium ${
                                value === opt.value ? 'text-ds-content' : 'text-ds-content-secondary'
                            }`}
                        >
                            {opt.label}
                        </span>
                    </label>
                ))}
            </div>
            {fieldError && (
                <FieldMessage id={errorId} tone="error" className="mt-1">
                    {fieldError}
                </FieldMessage>
            )}
        </fieldset>
    );
};

export default RadioGroup;
