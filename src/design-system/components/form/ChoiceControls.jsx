import React, { forwardRef, useId } from 'react';
import { FieldMessage } from './FormControls';
import './ChoiceControls.css';

/**
 * Native-first checkbox / radio contract.
 *
 * These close the Phase 4 "Checkbox, Radio" gap recorded in the roadmap. They
 * are business-neutral: they own the control size, the 44 px hit area, the
 * label/description association, the focus ring, the invalid treatment, and the
 * group naming. They never decide what a choice means, which options exist, or
 * what happens on change — callers pass native `checked`/`onChange` handlers.
 *
 * Why native inputs rather than a custom widget: the browser already provides
 * the correct roving-focus keyboard model for radio groups (arrow keys move and
 * select within a `name`, Tab leaves the group), required-group validation, and
 * platform form autofill. A div-with-role reimplementation loses all three.
 */

const ORIENTATIONS = new Set(['vertical', 'horizontal']);

function joinIds(...ids) {
  return ids.filter(Boolean).join(' ') || undefined;
}

/**
 * One checkbox or radio row: control, its own label, and optional description.
 *
 * `label` is the control's accessible name and is always required — a bare
 * unlabelled box is the single most common defect this primitive exists to
 * prevent.
 */
const ChoiceControl = forwardRef(function ChoiceControl({
  type,
  id,
  label,
  description,
  error,
  required = false,
  // A radio inside a `ChoiceGroup` still needs the native `required` attribute
  // (that is how the browser enforces "answer this group"), but the visible and
  // announced required marker belongs on the group's legend — repeating it on
  // every option would read as "Yes required, No required".
  requiredMark = required,
  // Hides the label visually while keeping it as the accessible name. Added
  // 2026-07-28 for the Super Admin feature matrix, where each cell is one
  // checkbox in a grid whose row and column headers already carry the meaning
  // for sighted users — printing "PEV for Artificial Freight Co" inside every
  // cell would be unusable. `label` stays required: this changes whether the
  // name is *shown*, never whether it exists.
  labelHidden = false,
  className = '',
  ...props
}, ref) {
  const generatedId = useId().replace(/:/g, '');
  const controlId = id || `ds-choice-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError(`${type === 'radio' ? 'Radio' : 'Checkbox'} requires a non-empty label.`);
  }

  return (
    <div className={`ds-choice ${className}`.trim()} data-invalid={Boolean(error) || undefined}>
      <input
        {...props}
        ref={ref}
        id={controlId}
        type={type}
        required={required || undefined}
        aria-required={props['aria-required'] ?? (required || undefined)}
        aria-invalid={props['aria-invalid'] ?? (error ? true : undefined)}
        aria-describedby={joinIds(props['aria-describedby'], descriptionId, errorId)}
        className="ds-choice__control"
      />
      <div className="ds-choice__text">
        <label
          htmlFor={controlId}
          className={labelHidden ? 'ds-visually-hidden' : 'ds-choice__label'}
        >
          <span>{label}</span>
          {requiredMark && (
            <>
              <span className="ds-choice__required-mark" aria-hidden="true">*</span>
              <span className="ds-visually-hidden"> required</span>
            </>
          )}
        </label>
        {description && (
          <p id={descriptionId} className="ds-choice__description">{description}</p>
        )}
        {error && <FieldMessage id={errorId} tone="error">{error}</FieldMessage>}
      </div>
    </div>
  );
});

export const Checkbox = forwardRef(function Checkbox(props, ref) {
  return <ChoiceControl {...props} ref={ref} type="checkbox" />;
});

export const Radio = forwardRef(function Radio(props, ref) {
  if (typeof props.name !== 'string' || props.name.trim() === '') {
    throw new TypeError('Radio requires a non-empty name so the browser can group it.');
  }
  return <ChoiceControl {...props} ref={ref} type="radio" />;
});

/**
 * Grouping wrapper for a set of related choices.
 *
 * A real `<fieldset>`/`<legend>` is used deliberately: it is the only grouping
 * that assistive technology announces before each option without repeating the
 * question inside every label.
 */
export function ChoiceGroup({
  legend,
  description,
  error,
  required = false,
  orientation = 'vertical',
  children,
  className = '',
  ...props
}) {
  const generatedId = useId().replace(/:/g, '');
  const descriptionId = description ? `ds-choice-group-${generatedId}-description` : undefined;
  const errorId = error ? `ds-choice-group-${generatedId}-error` : undefined;

  if (typeof legend !== 'string' || legend.trim() === '') {
    throw new TypeError('ChoiceGroup requires a non-empty legend.');
  }
  if (!ORIENTATIONS.has(orientation)) {
    throw new TypeError(`Unsupported ChoiceGroup orientation: ${orientation}`);
  }

  return (
    <fieldset
      {...props}
      className={`ds-choice-group ${className}`.trim()}
      data-orientation={orientation}
      data-invalid={Boolean(error) || undefined}
      aria-describedby={joinIds(props['aria-describedby'], descriptionId, errorId)}
    >
      <legend className="ds-choice-group__legend">
        <span>{legend}</span>
        {required && (
          <>
            <span className="ds-choice-group__required-mark" aria-hidden="true">*</span>
            <span className="ds-visually-hidden"> required</span>
          </>
        )}
      </legend>
      {description && (
        <p id={descriptionId} className="ds-choice-group__description">{description}</p>
      )}
      <div className="ds-choice-group__options">{children}</div>
      {error && <FieldMessage id={errorId} tone="error">{error}</FieldMessage>}
    </fieldset>
  );
}
