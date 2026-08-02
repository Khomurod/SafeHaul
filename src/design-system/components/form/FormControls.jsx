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

export const Input = forwardRef(function Input({
  className = '',
  type = 'text',
  ...props
}, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type={type}
      className={controlClassName(className)}
    />
  );
});

export const Textarea = forwardRef(function Textarea({
  className = '',
  ...props
}, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={controlClassName(className)}
    />
  );
});

export const Select = forwardRef(function Select({
  className = '',
  children,
  ...props
}, ref) {
  return (
    <select
      {...props}
      ref={ref}
      className={controlClassName(className)}
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
