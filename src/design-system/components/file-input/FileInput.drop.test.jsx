import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileInput } from './FileInput';

/**
 * How a dropped file reaches the input at all.
 *
 * A `<label>` forwards a click to the control it names and never a drop, so the
 * panel ignored what was dropped on it until 2026-08-25. What replaced that is
 * an explicit handler that assigns the files and dispatches a real `change`, and
 * these are the mechanics of it: what gets through, what `accept` refuses, and
 * what a disabled panel still owes the page.
 *
 * What the user is TOLD about a refusal lives in `FileInput.rejection.test.jsx`.
 */
describe('FileInput drag and drop', () => {
  it('accepts a file dropped on the panel and reports it as a change from the input', () => {
    const onChange = vi.fn();
    render(<FileInput label="Recipient list" variant="dropzone" onChange={onChange} />);

    const input = document.querySelector('input[type="file"]');
    const label = input.closest('label');
    const file = new File(['a,b\n1,2'], 'recipients.csv', { type: 'text/csv' });

    const transfer = new DataTransfer();
    transfer.items.add(file);
    fireEvent.dragOver(label, { dataTransfer: transfer });
    fireEvent.drop(label, { dataTransfer: transfer });

    expect(onChange).toHaveBeenCalledTimes(1);
    const event = onChange.mock.calls[0][0];
    expect(event.target).toBe(input);
    expect(event.target.files).toHaveLength(1);
    expect(event.target.files[0].name).toBe('recipients.csv');
  });

  it('ignores a drop while it is uploading, as it ignores a second pick', () => {
    const onChange = vi.fn();
    render(<FileInput label="Recipient list" variant="dropzone" loading onChange={onChange} />);

    const input = document.querySelector('input[type="file"]');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'second.csv', { type: 'text/csv' }));
    fireEvent.drop(input.closest('label'), { dataTransfer: transfer });

    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * Ignoring the file is not the same as ignoring the event.
   *
   * The first version of the drop handlers returned early when disabled, before
   * calling `preventDefault` — which handed the drop back to the browser, whose
   * default action for a dropped file is to navigate to it. Dropping a second
   * file on a panel mid-upload could therefore replace the page and take a
   * half-filled application with it. Refusing the file and cancelling the event
   * are separate obligations, and a disabled drop target still owes the page the
   * second one.
   *
   * `fireEvent` returns false when a handler called `preventDefault`, which is
   * what makes this assertable rather than a matter of reading the source.
   */
  it.each([
    ['while uploading', { loading: true }],
    ['while disabled', { disabled: true }],
    ['when idle', {}],
  ])('cancels the browser default drop action %s', (_label, props) => {
    render(<FileInput label="Recipient list" variant="dropzone" {...props} />);
    const label = document.querySelector('input[type="file"]').closest('label');

    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'dropped.csv', { type: 'text/csv' }));

    // false === some handler called preventDefault, so the browser will not act.
    expect(fireEvent.dragOver(label, { dataTransfer: transfer })).toBe(false);
    expect(fireEvent.drop(label, { dataTransfer: transfer })).toBe(false);
  });

  /*
   * The native picker filters by `accept` in its own dialog, so a call site that
   * passes `accept="image/*"` has never had to check what it received. Assigning
   * `files` programmatically inherits none of that — so before 2026-08-25 a PDF
   * dropped on the company-logo control was uploaded and persisted as the logo,
   * leaving a broken image. `BrandingSection` passes `image/*`,
   * `CompanyProfileTab` uploads whatever arrives, and Storage permits PDFs in
   * `company_assets`; nothing else in that chain would have stopped it.
   */
  it('refuses a dropped file the accept list does not allow', () => {
    const onChange = vi.fn();
    render(<FileInput label="Company logo" accept="image/*" onChange={onChange} />);
    const label = document.querySelector('input[type="file"]').closest('label');

    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    fireEvent.drop(label, { dataTransfer: transfer });

    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]').files).toHaveLength(0);
  });

  it('accepts a dropped file the accept list does allow', () => {
    const onChange = vi.fn();
    render(<FileInput label="Company logo" accept="image/*" onChange={onChange} />);
    const label = document.querySelector('input[type="file"]').closest('label');

    const transfer = new DataTransfer();
    transfer.items.add(new File(['png'], 'logo.png', { type: 'image/png' }));
    fireEvent.drop(label, { dataTransfer: transfer });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].target.files[0].name).toBe('logo.png');
  });

  it('keeps only the accepted files out of a mixed drop', () => {
    const onChange = vi.fn();
    render(<FileInput label="Attachments" accept=".csv" multiple onChange={onChange} />);
    const label = document.querySelector('input[type="file"]').closest('label');

    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    transfer.items.add(new File(['a,b'], 'rows.csv', { type: 'text/csv' }));
    fireEvent.drop(label, { dataTransfer: transfer });

    const files = onChange.mock.calls[0][0].target.files;
    expect(Array.from(files).map((file) => file.name)).toEqual(['rows.csv']);
  });

  it('takes the first ACCEPTED file when the field is single-file', () => {
    const onChange = vi.fn();
    render(<FileInput label="Company logo" accept="image/*" onChange={onChange} />);
    const label = document.querySelector('input[type="file"]').closest('label');

    // The rejected file is FIRST, so a handler that sliced before filtering would
    // take the PDF and then discard it, reporting nothing at all.
    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }));
    transfer.items.add(new File(['png'], 'logo.png', { type: 'image/png' }));
    fireEvent.drop(label, { dataTransfer: transfer });

    const files = onChange.mock.calls[0][0].target.files;
    expect(Array.from(files).map((file) => file.name)).toEqual(['logo.png']);
  });

});
