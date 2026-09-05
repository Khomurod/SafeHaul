import React, {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
} from 'react';
import { Card } from '../card';
import './FormControls.css';

function joinIds(...ids) {
  return ids.filter(Boolean).join(' ') || undefined;
}

export const Label = forwardRef(function Label({
  children,
  required = false,
  className = '',
  ...props
}, ref) {
  return (
    <label
      {...props}
      ref={ref}
      className={`ds-label ${className}`.trim()}
    >
      <span>{children}</span>
      {required && (
        <>
          <span className="ds-label__required-mark" aria-hidden="true">*</span>
          <span className="ds-visually-hidden"> required</span>
        </>
      )}
    </label>
  );
});

export function FieldMessage({
  children,
  tone = 'help',
  className = '',
  ...props
}) {
  if (!['help', 'error', 'success'].includes(tone)) {
    throw new TypeError(`Unsupported FieldMessage tone: ${tone}`);
  }

  return (
    <p
      {...props}
      className={`ds-field-message ${className}`.trim()}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : props.role}
    >
      {children}
    </p>
  );
}

export function FieldDisplay({
  label,
  children,
  emphasis = 'normal',
  className = '',
  ...props
}) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('FieldDisplay requires a non-empty label.');
  }
  if (!['normal', 'strong'].includes(emphasis)) {
    throw new TypeError(`Unsupported FieldDisplay emphasis: ${emphasis}`);
  }

  return (
    <div
      {...props}
      className={`ds-field-display ${className}`.trim()}
      data-emphasis={emphasis}
    >
      <span className="ds-field-display__label">{label}</span>
      <p className="ds-field-display__value">{children}</p>
    </div>
  );
}

export function FormField({
  id,
  label,
  description,
  error,
  required = false,
  children,
  className = '',
}) {
  const generatedId = useId().replace(/:/g, '');
  const controlId = id || `ds-field-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('FormField requires a non-empty label.');
  }
  if (!isValidElement(children)) {
    throw new TypeError('FormField requires one valid form control child.');
  }

  const control = cloneElement(children, {
    id: children.props.id || controlId,
    required: children.props.required ?? required,
    'aria-required': children.props['aria-required'] ?? (required || undefined),
    'aria-invalid': children.props['aria-invalid'] ?? (error ? true : undefined),
    'aria-describedby': joinIds(
      children.props['aria-describedby'],
      descriptionId,
      errorId,
    ),
  });

  return (
    <div className={`ds-form-field ${className}`.trim()} data-invalid={Boolean(error) || undefined}>
      <Label htmlFor={control.props.id} required={required}>{label}</Label>
      {control}
      {description && (
        <FieldMessage id={descriptionId} tone="help">{description}</FieldMessage>
      )}
      {error && (
        <FieldMessage id={errorId} tone="error">{error}</FieldMessage>
      )}
    </div>
  );
}

function controlClassName(className) {
  return `ds-form-control ${className || ''}`.trim();
}

/**
 * The control size scale, shared with `Button` so an input and the button beside
 * it are the same height by default. `md` renders no attribute at all, which
 * keeps the common case out of the DOM and lets the base rule apply.
 *
 * `size` deliberately shadows the native `size` attribute of `<input>` and
 * `<select>`. Character-width and visible-row sizing are layout decisions the
 * design system owns through the control scale, and a control whose width came
 * from a character count could not line up with anything beside it. The throw
 * below says so, because a silently ignored `size={30}` would be worse.
 */
const CONTROL_SIZES = new Set(['sm', 'md', 'lg']);

function controlSize(size, component) {
  if (!CONTROL_SIZES.has(size)) {
    throw new TypeError(
      `Unsupported ${component} size: ${size}. Expected 'sm', 'md' or 'lg' — `
      + `this is the design system's control scale, not the native size attribute. `
      + `For width, use the layout around the control.`,
    );
  }
  return size === 'md' ? undefined : size;
}

/**
 * `inline` is a field that lives INSIDE running content rather than in a form.
 *
 * Borderless, transparent and only as wide as it needs to be — the shape four
 * call sites had hand-built: two goal editors inside a labelled chip and two
 * date fields inside a date-range chip. `default` keeps the bordered control.
 *
 * ## It is not the published "inline edit" pattern, and the name is a trap
 *
 * Atlassian, PatternFly and Cloudscape all define an `InlineEdit` component: a
 * READ view that swaps to an EDIT view when activated. That is the standard
 * answer for an editable value sitting in a sentence — and it is **not** what
 * any of these four are. Every one is permanently editable and saves on blur or
 * change; none has a read view. Building `InlineEdit` here would be a primitive
 * with zero consumers, which is the mistake the roadmap's §8 records.
 *
 * ## It keeps the control scale rather than escaping it
 *
 * The variant changes the CHROME — border, background, width — and leaves
 * `size` owning the height, so an inline field still lines up with the controls
 * around it. Measured before choosing: the two date fields are already 36px
 * (`sm`), and the two goal editors have no height at all, rendering at roughly
 * 20px — **under the 24px WCAG 2.5.8 minimum for something a person clicks
 * into**. `size="sm"` leaves the first pair untouched and takes the second over
 * the line.
 *
 * ## It requires a name
 *
 * A bordered field in a form is named by its `FormField` label. An inline one
 * has no such wrapper by construction, so the name has to come from the caller
 * or it has none at all — and a spinbutton announcing only its number is the
 * defect this variant would otherwise ship four times.
 */
const INPUT_VARIANTS = new Set(['default', 'inline']);

/** Where the value sits when the box is wider than the text. */
const INLINE_ALIGNS = new Set(['start', 'center', 'end']);

/**
 * How wide an inline field is, and why this is a prop rather than a class list.
 *
 * `auto` lets the control size itself, which is what a date field wants — the
 * native picker has its own intrinsic width and forcing one clips it.
 *
 * `compact` is a field for a few characters, which is what the two goal editors
 * want. It has to be a PROP because the variant rule sets `width: auto` at two
 * selectors and a `w-14` utility carries one: measured, the goal editors
 * rendered at **220px** — the browser's default width for a number input —
 * against the 56px their class asked for, a four-fold widening that no test
 * would have caught and that only showed up in a probe reading the number.
 * The same specificity trap `SelectableCard`'s README records one component
 * over.
 */
const INLINE_WIDTHS = new Set(['auto', 'compact']);

export const Input = forwardRef(function Input({
  className = '',
  type = 'text',
  size = 'md',
  variant = 'default',
  align = 'start',
  width = 'auto',
  ...props
}, ref) {
  if (!INPUT_VARIANTS.has(variant)) {
    throw new TypeError(
      `Unsupported Input variant: ${variant}. Expected 'default' or 'inline'.`,
    );
  }
  if (!INLINE_ALIGNS.has(align)) {
    throw new TypeError(`Unsupported Input align: ${align}.`);
  }
  if (!INLINE_WIDTHS.has(width)) {
    throw new TypeError(`Unsupported Input width: ${width}. Expected 'auto' or 'compact'.`);
  }
  const named = ['aria-label', 'aria-labelledby', 'id']
    .some((attribute) => typeof props[attribute] === 'string' && props[attribute].trim() !== '');
  if (variant === 'inline' && !named) {
    throw new TypeError(
      'Input variant="inline" requires an aria-label, an aria-labelledby or an id a '
      + '<label> points at. It has no FormField wrapper to name it, so without one it '
      + 'announces as an unlabelled field.',
    );
  }

  return (
    <input
      {...props}
      ref={ref}
      type={type}
      className={controlClassName(className)}
      data-size={controlSize(size, 'Input')}
      data-variant={variant === 'default' ? undefined : variant}
      data-align={align === 'start' ? undefined : align}
      data-width={width === 'auto' ? undefined : width}
    />
  );
});

export const Textarea = forwardRef(function Textarea({
  className = '',
  size = 'md',
  ...props
}, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={controlClassName(className)}
      data-size={controlSize(size, 'Textarea')}
    />
  );
});

export const Select = forwardRef(function Select({
  className = '',
  children,
  size = 'md',
  ...props
}, ref) {
  return (
    <select
      {...props}
      ref={ref}
      className={controlClassName(className)}
      data-size={controlSize(size, 'Select')}
    >
      {children}
    </select>
  );
});

export function FormSection({
  title,
  description,
  actions,
  children,
  className = '',
  ...props
}) {
  const generatedId = useId().replace(/:/g, '');
  const titleId = props['aria-label'] ? undefined : `ds-form-section-${generatedId}`;

  if (!props['aria-label'] && (typeof title !== 'string' || title.trim() === '')) {
    throw new TypeError('FormSection requires a title or aria-label.');
  }

  return (
    <Card
      {...props}
      className={`ds-form-section ${className}`.trim()}
      aria-labelledby={titleId}
    >
      {(title || description || actions) && (
        <header className="ds-form-section__header">
          <div>
            {title && <h2 id={titleId}>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="ds-form-section__actions">{actions}</div>}
        </header>
      )}
      <div className="ds-form-section__body">{children}</div>
    </Card>
  );
}
