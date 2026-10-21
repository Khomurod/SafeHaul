import React from 'react';
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
 */
const TONES = new Set(['primary', 'success', 'danger']);

export function Switch({
  checked = false,
  onChange,
  label,
  tone = 'primary',
  disabled = false,
  className = '',
  ...props
}) {
  if (typeof label !== 'string' || label.trim() === '') {
    contractViolation('Switch requires a non-empty label naming what it turns on.');
  }
  if (!TONES.has(tone)) {
    contractViolation(`Unsupported Switch tone: ${tone}`);
  }

  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`ds-switch ${className}`.trim()}
      data-tone={tone}
    >
      <span aria-hidden="true" className="ds-switch__thumb" />
    </button>
  );
}
