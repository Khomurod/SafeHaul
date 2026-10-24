import React, { useId } from 'react';
import { contractViolation } from '../../contract';
import './Switch.css';

/**
 * The WAI-ARIA `switch` pattern: an immediate on/off control.
 *
 * **A switch is not a checkbox.** A checkbox is a value you set and then
 * submit; a switch takes effect the moment it moves. Use `Checkbox` inside a
 * form with a Save button, and `Switch` where the change is applied at once.
 * Getting this backwards produces a control that either announces a state it
 * has not reached yet, or a form field that saves behind the user's back.
 *
 * A company's features on the owner panel are a column of these: each applies
 * at once, and a `Checkbox` there would announce the wrong role.
 *
 * State is exposed through `aria-checked` and through the thumb's position, so
 * it never depends on colour alone. `tone` only tints the *on* state, for the
 * cases where on is affirmative (a feature enabled) or destructive (a
 * restriction applied) rather than neutral.
 *
 * `showLabel` prints the label beside the switch, for a switch that stands
 * alone in a toolbar ("Only mine"). The text is then a `<label>` for the
 * button, so pressing the words moves the switch too, and the button takes its
 * name from it. Without `showLabel` the label is the button's `aria-label`, for
 * a switch whose row or column already says what it is.
 */
const TONES = new Set(['primary', 'success', 'danger']);

export function Switch({
  checked = false,
  onChange,
  label,
  showLabel = false,
  tone = 'primary',
  disabled = false,
  className = '',
  id,
  ...props
}) {
  const generatedId = useId();
  if (typeof label !== 'string' || label.trim() === '') {
    contractViolation('Switch requires a non-empty label naming what it turns on.');
  }
  if (!TONES.has(tone)) {
    contractViolation(`Unsupported Switch tone: ${tone}`);
  }

  const controlId = id ?? `${generatedId}-switch`;
  const labelId = `${generatedId}-label`;
  const control = (
    <button
      {...props}
      id={showLabel ? controlId : id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={showLabel ? undefined : label}
      aria-labelledby={showLabel ? labelId : undefined}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={showLabel ? 'ds-switch' : `ds-switch ${className}`.trim()}
      data-tone={tone}
    >
      <span aria-hidden="true" className="ds-switch__thumb" />
    </button>
  );

  if (!showLabel) return control;

  // `className` goes on the outermost element: here the pair, so a toolbar
  // places the switch and its words together.
  return (
    <span className={`ds-switch-field ${className}`.trim()} data-disabled={disabled || undefined}>
      {control}
      <label id={labelId} htmlFor={controlId} className="ds-switch-field__label">
        {label}
      </label>
    </span>
  );
}
