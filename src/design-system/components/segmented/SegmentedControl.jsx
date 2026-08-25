import React from 'react';
import './SegmentedControl.css';

/**
 * A single-select group of toggle buttons.
 *
 * Four places had hand-rolled this as a `role="group"` of raw
 * `<button aria-pressed>` cards, each recorded as its own exception:
 * `CallOutcomeModalUI`'s outcome grid, the dossier's summary/full toggle, the
 * PEV FMCSA suggestion rows and `EnvelopeSidebar`'s delivery-method toggle.
 *
 * ## Why `aria-pressed` and not a radiogroup
 *
 * A radiogroup would be the textbook choice for single-select — but it brings
 * the roving-focus keyboard model with it, where arrow keys move *and* select,
 * and Tab leaves the group. Every one of the four call sites is a grid of
 * tappable cards that users reach one at a time with Tab, and two of them sit
 * inside a form where the arrow keys already mean something else.
 *
 * `role="group"` with `aria-pressed` keeps each option individually tabbable
 * and announces its state, which is what those call sites already do and what
 * their tests already assert. The trade-off is real and deliberate: this is not
 * the pattern for a long list of mutually exclusive options — for that, use
 * `ChoiceGroup` with `Radio`, which is a real radiogroup.
 *
 * The group needs an accessible name, because "pressed" on its own does not say
 * what was chosen.
 */
const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);

export function SegmentedControl({
  ariaLabel,
  options,
  value,
  onChange,
  columns = 1,
  className = '',
  ...props
}) {
  if (typeof ariaLabel !== 'string' || ariaLabel.trim() === '') {
    throw new TypeError('SegmentedControl requires an ariaLabel naming the choice.');
  }
  if (!Array.isArray(options) || options.length === 0) {
    throw new TypeError('SegmentedControl requires at least one option.');
  }
  for (const option of options) {
    if (option.tone && !TONES.has(option.tone)) {
      throw new TypeError(`Unsupported SegmentedControl tone: ${option.tone}`);
    }
  }

  return (
    <div
      {...props}
      role="group"
      aria-label={ariaLabel}
      className={`ds-segmented ${className}`.trim()}
      data-columns={columns}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            disabled={option.disabled}
            onClick={() => onChange?.(option.value)}
            className="ds-segmented__option"
            data-tone={option.tone || 'neutral'}
            data-selected={isSelected || undefined}
          >
            {Icon && <Icon aria-hidden="true" />}
            <span className="ds-segmented__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
