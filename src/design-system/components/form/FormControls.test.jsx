import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import {
  FieldDisplay,
  FormField,
  FormSection,
  Input,
  Select,
  Textarea,
} from './FormControls';

describe('form controls', () => {
  it('connects labels, descriptions, errors, and required state', () => {
    render(
      <FormField
        id="display-name"
        label="Display name"
        description="Shown to other users."
        error="Enter a display name."
        required
      >
        <Input name="displayName" />
      </FormField>,
    );

    const input = screen.getByRole('textbox', { name: /display name/i });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Shown to other users. Enter a display name.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a display name.');
  });

  it('preserves native events and native disabled/read-only behavior', () => {
    const onChange = vi.fn();
    render(
      <>
        <FormField id="editable" label="Editable">
          <Input value="" onChange={onChange} />
        </FormField>
        <FormField
          id="email"
          label="Email"
          description="This value cannot be changed."
        >
          <Input value="person@example.com" readOnly />
        </FormField>
        <FormField id="disabled" label="Disabled">
          <Input value="Unavailable" disabled />
        </FormField>
      </>,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Editable' }), {
      target: { value: 'Updated' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Disabled' })).toBeDisabled();
  });

  it('provides the same field contract to textarea and select controls', () => {
    render(
      <>
        <FormField id="notes" label="Notes">
          <Textarea defaultValue="Existing notes" />
        </FormField>
        <FormField id="role" label="Role">
          <Select defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
        </FormField>
      </>,
    );

    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Existing notes');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('member');
  });

  it('presents read-only values without adding form controls to keyboard order', () => {
    render(
      <FieldDisplay label="Company name" emphasis="strong">
        A very long logistics company name that must wrap safely
      </FieldDisplay>,
    );

    expect(screen.getByText('Company name')).toBeInTheDocument();
    expect(screen.getByText(/A very long logistics/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders a labelled form section without structural accessibility violations', async () => {
    const { container } = render(
      <FormSection title="Profile details" description="Update your information.">
        <FormField id="name" label="Name">
          <Input />
        </FormField>
      </FormSection>,
    );

    expect(screen.getByRole('region', { name: 'Profile details' })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});

/**
 * The control size scale, shared with `Button`.
 *
 * `.ds-form-control` hardcoded `min-height: 44px` while `Button`'s `md` was
 * 40px, so an input and the button beside it were never the same height. The
 * point of these tests is that the *default* is now the aligned case: a caller
 * that passes nothing gets a control matching a default Button, and `data-size`
 * is absent so no call site has to opt in.
 */
describe('form control size scale', () => {
  it.each([
    ['Input', <Input aria-label="Search" key="i" />, 'textbox'],
    ['Textarea', <Textarea aria-label="Notes" key="t" />, 'textbox'],
    ['Select', <Select aria-label="Role" key="s"><option>a</option></Select>, 'combobox'],
  ])('renders %s at the default size with no size attribute', (_name, element, role) => {
    render(element);
    expect(screen.getByRole(role)).not.toHaveAttribute('data-size');
  });

  it.each(['sm', 'lg'])('marks a %s control so the CSS can size it', (size) => {
    render(<Input aria-label="Search" size={size} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('data-size', size);
  });

  it('rejects the native size attribute rather than silently ignoring it', () => {
    // `size` shadows the native character-width attribute of `<input>` and the
    // visible-row attribute of `<select>`. A caller reaching for either gets an
    // error naming the scale, not a control that quietly ignores them.
    expect(() => render(<Input aria-label="Search" size={30} />))
      .toThrow(/Unsupported Input size: 30/);
    expect(() => render(<Select aria-label="Role" size={5}><option>a</option></Select>))
      .toThrow(/Unsupported Select size: 5/);
  });

  it('keeps the size attribute off the accessible name and role', async () => {
    const { container } = render(
      <FormField id="q" label="Search">
        <Input size="lg" />
      </FormField>,
    );
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('Input variant="inline"', () => {
  const CSS = readFileSync(path.join(__dirname, 'FormControls.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('marks the variant for CSS and leaves the default off the DOM', () => {
    const { container, rerender } = render(<Input aria-label="Goal" />);
    expect(container.firstChild).not.toHaveAttribute('data-variant');
    rerender(<Input aria-label="Goal" variant="inline" />);
    expect(container.firstChild).toHaveAttribute('data-variant', 'inline');
  });

  /*
   * A bordered field is named by its `FormField` label. An inline one has no
   * such wrapper by construction, so without a name from the caller it
   * announces as an unlabelled field — which is what four hand-built ones
   * would have shipped as if this threw nothing.
   */
  it('refuses to render unnamed, and names the three ways to name it', () => {
    expect(() => render(<Input variant="inline" />))
      .toThrow(/requires an aria-label, an aria-labelledby or an id/);
    expect(() => render(<Input variant="inline" aria-label="   " />))
      .toThrow(/requires an aria-label/);
  });

  it.each([
    ['aria-label', { 'aria-label': 'Daily dial goal' }],
    ['aria-labelledby', { 'aria-labelledby': 'goal-label' }],
    ['id', { id: 'goal-input' }],
  ])('accepts a name given by %s', (_name, props) => {
    const { container } = render(<Input variant="inline" {...props} />);
    expect(container.firstChild).toHaveAttribute('data-variant', 'inline');
  });

  it('carries the alignment, and omits the default', () => {
    const { container, rerender } = render(<Input aria-label="Goal" variant="inline" />);
    expect(container.firstChild).not.toHaveAttribute('data-align');
    rerender(<Input aria-label="Goal" variant="inline" align="center" />);
    expect(container.firstChild).toHaveAttribute('data-align', 'center');
  });

  /*
   * The defect this prop exists for, pinned. The variant sets `width: auto` at
   * two selectors; a caller's width utility carries one and loses. Measured in
   * a real browser before the prop existed: a `w-14` (56px) number field
   * rendered at 220px, the browser's default. A class list cannot fix it, so
   * the contract has to own it.
   */
  it('owns the width, because a caller cannot win it back', () => {
    const { container, rerender } = render(<Input aria-label="Goal" variant="inline" />);
    expect(container.firstChild).not.toHaveAttribute('data-width');
    rerender(<Input aria-label="Goal" variant="inline" width="compact" />);
    expect(container.firstChild).toHaveAttribute('data-width', 'compact');

    const rule = CSS.slice(CSS.indexOf("[data-variant='inline'][data-width='compact']"));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('--ds-field-width-compact');
  });

  it('refuses a width it has no rule for', () => {
    expect(() => render(<Input aria-label="Goal" variant="inline" width="tiny" />))
      .toThrow(/Unsupported Input width: tiny/);
  });

  it('refuses a variant or an alignment it has no rule for', () => {
    expect(() => render(<Input aria-label="Goal" variant="ghost" />))
      .toThrow(/Unsupported Input variant: ghost/);
    expect(() => render(<Input aria-label="Goal" variant="inline" align="middle" />))
      .toThrow(/Unsupported Input align: middle/);
  });

  /*
   * The variant owns the chrome and `size` owns the height, which is what keeps
   * an inline field lined up with the controls beside it. If the variant rule
   * ever set `min-height`, `padding` or `font-size` it would have escaped the
   * control scale — and the two date fields it replaced were 36px for a reason.
   */
  it('overrides the chrome only, leaving the control scale to `size`', () => {
    const rule = CSS.slice(CSS.indexOf(".ds-form-control[data-variant='inline'] {"));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toContain('width: auto');
    expect(body).toContain('border-color: transparent');
    expect(body).toContain('background: transparent');
    for (const escaped of ['min-height', 'padding', 'font-size']) {
      expect(body).not.toContain(escaped);
    }
  });

  /*
   * Transparent, not removed. A field that drops its border on the way in
   * shifts the text beside it by a pixel on each side, and inside a chip that
   * reads as a wobble.
   */
  it('hides the border rather than removing it', () => {
    const rule = CSS.slice(CSS.indexOf(".ds-form-control[data-variant='inline'] {"));
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('border: none');
  });

  it('is still a spinbutton, and still reports its value and validity', () => {
    const onBlur = vi.fn();
    render(
      <Input
        type="number"
        variant="inline"
        size="sm"
        align="center"
        aria-label="Dials — daily goal for Maria Garcia"
        aria-invalid
        defaultValue={40}
        onBlur={onBlur}
      />,
    );
    const field = screen.getByRole('spinbutton', { name: 'Dials — daily goal for Maria Garcia' });
    expect(field).toHaveValue(40);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(field);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations inside a chip', async () => {
    const { container } = render(
      <span>
        <span id="dials-label">Dials</span>
        <Input type="number" variant="inline" size="sm" aria-labelledby="dials-label" defaultValue={40} />
      </span>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
