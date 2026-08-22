import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { FileInput } from './FileInput';

describe('FileInput', () => {
  it('renders a real file input, named by its label', () => {
    render(<FileInput label="Driver licence" buttonLabel="Choose file" onChange={vi.fn()} />);
    const input = screen.getByLabelText(/Choose file/);
    expect(input).toHaveAttribute('type', 'file');
  });

  it('requires a label naming what is being uploaded', () => {
    expect(() => render(<FileInput label="" onChange={vi.fn()} />))
      .toThrow(/requires a non-empty label/i);
  });

  /**
   * The structural rule. Two of the four hand-built controls this replaces were
   * a `<div onClick>` driving a `display: none` input, which is unreachable by
   * keyboard — `display: none` and `visibility: hidden` both remove an element
   * from the tab order, and take the picker with them.
   */
  it('keeps the input focusable rather than hiding it from the tab order', () => {
    const { container } = render(<FileInput label="Driver licence" onChange={vi.fn()} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input).not.toHaveAttribute('hidden');
    expect(input.className).toContain('ds-file-input__native');
    // The clip technique, not display:none — asserted on the stylesheet in the
    // token tests; here we assert the input is a real, enabled control.
    expect(input).not.toBeDisabled();
  });

  it('describes the accepted types before the picker opens', () => {
    render(
      <FileInput
        label="Driver licence"
        description="PDF or JPEG, up to 10 MB."
        accept="application/pdf,image/jpeg"
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText(/Choose file/);
    expect(input).toHaveAccessibleDescription('PDF or JPEG, up to 10 MB.');
    expect(input).toHaveAttribute('accept', 'application/pdf,image/jpeg');
  });

  it('passes native attributes straight through', () => {
    render(<FileInput label="Documents" multiple onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Choose file/)).toHaveAttribute('multiple');
  });

  it('disables the control and the label together', () => {
    const { container } = render(<FileInput label="Driver licence" disabled onChange={vi.fn()} />);
    expect(screen.getByLabelText(/Choose file/)).toBeDisabled();
    expect(container.querySelector('.ds-file-input__control')).toHaveAttribute('data-disabled', 'true');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <FileInput label="Driver licence" description="PDF or JPEG." onChange={vi.fn()} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
