import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { FileInput } from './FileInput';

describe('FileInput', () => {
  it('renders a real file input, named by its field label', () => {
    // Named by the *field*, not by the button text. The button says "Choose
    // file"; the field is "Driver licence", and that is what it announces as.
    render(<FileInput label="Driver licence" buttonLabel="Choose file" onChange={vi.fn()} />);
    const input = screen.getByLabelText('Driver licence');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAccessibleName('Driver licence');
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
    const input = screen.getByLabelText('Driver licence');
    expect(input).toHaveAccessibleDescription('PDF or JPEG, up to 10 MB.');
    expect(input).toHaveAttribute('accept', 'application/pdf,image/jpeg');
  });

  it('passes native attributes straight through', () => {
    render(<FileInput label="Documents" multiple onChange={vi.fn()} />);
    expect(screen.getByLabelText('Documents')).toHaveAttribute('multiple');
  });

  it('disables the control and the label together', () => {
    const { container } = render(<FileInput label="Driver licence" disabled onChange={vi.fn()} />);
    expect(screen.getByLabelText('Driver licence')).toBeDisabled();
    expect(container.querySelector('.ds-file-input__control')).toHaveAttribute('data-disabled', 'true');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <FileInput label="Driver licence" description="PDF or JPEG." onChange={vi.fn()} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

/**
 * The three shapes the product actually uses.
 *
 * This component shipped on 2026-08-21 and four days later had two consumers,
 * while nine raw `<input type="file">` controls were still in the tree — every
 * one carrying a comment that said no file-input contract existed. Migrating them
 * is what showed why: the contract existed, and its API covered one of the three
 * shapes. A primitive that fits a third of its call sites does not get adopted.
 */
describe('FileInput shapes', () => {
  it('hides the field label on request while keeping the accessible name', () => {
    // For a picker whose field is already named on screen — a photo preview
    // beside it. Same prop, same meaning, as `Checkbox`'s `labelHidden`.
    render(<FileInput label="Profile photo" labelHidden onChange={vi.fn()} />);
    const input = screen.getByLabelText('Profile photo');
    expect(input).toHaveAccessibleName('Profile photo');
    expect(screen.getByText('Profile photo').className).toContain('ds-visually-hidden');
  });

  it('says it is busy and refuses a second file while uploading', () => {
    // The defect the two hand-built pickers avoided by disabling their trigger:
    // a picker that stays live during an upload lets a second file replace the
    // first mid-flight.
    render(<FileInput label="Company logo" loading onChange={vi.fn()} />);
    const input = screen.getByLabelText('Company logo');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('aria-busy', 'true');
  });

  /*
   * Disabling the element that has focus drops focus to `<body>`, so an upload
   * started from the keyboard used to end with the user at the top of the
   * document. The two pickers this component replaced each had their own
   * focus-return effect; a review on 2026-08-25 caught that deleting them left
   * nothing here.
   */
  it('returns focus to the picker when the upload it disabled itself for ends', () => {
    const Harness = ({ uploading }) => (
      <FileInput label="Profile photo" loading={uploading} onChange={vi.fn()} />
    );
    const { rerender } = render(<Harness uploading={false} />);
    const input = screen.getByLabelText('Profile photo');
    input.focus();
    expect(input).toHaveFocus();

    // The picked file, from the focused input — the only moment it is certainly
    // focused, which is why the flag is set here.
    fireEvent.change(input, { target: { files: [] } });

    // The parent starts uploading. In a real browser, disabling the focused
    // element is what drops focus to the body; this DOM leaves it on the input,
    // so the browser's effect is reproduced explicitly rather than assumed.
    rerender(<Harness uploading />);
    expect(input).toBeDisabled();
    document.body.focus();
    expect(document.body).toHaveFocus();

    // The upload settles. The picker is usable again, and focus is back on it
    // rather than at the top of the document.
    rerender(<Harness uploading={false} />);
    expect(input).not.toBeDisabled();
    expect(input).toHaveFocus();
  });

  it('does not steal focus back from wherever the user moved during the upload', () => {
    function Harness({ uploading }) {
      return (
        <>
          <FileInput label="Profile photo" loading={uploading} onChange={vi.fn()} />
          <button type="button">Elsewhere</button>
        </>
      );
    }
    const { rerender } = render(<Harness uploading={false} />);
    const input = screen.getByLabelText('Profile photo');
    input.focus();
    fireEvent.change(input, { target: { files: [] } });

    rerender(<Harness uploading />);
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    rerender(<Harness uploading={false} />);

    expect(elsewhere).toHaveFocus();
  });

  it('puts the dropzone description inside the panel and still describes the input', () => {
    const { container } = render(
      <FileInput
        label="Recipient list"
        variant="dropzone"
        buttonLabel="Click to upload a file"
        description="CSV, XLS or XLSX files"
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Recipient list');
    expect(input).toHaveAccessibleDescription('CSV, XLS or XLSX files');
    // Inside the label, which is what makes the whole panel the click target and
    // a real drop target for this input, via `FileInput`'s `onDrop`.
    const control = container.querySelector('.ds-file-input__control');
    expect(control.querySelector('.ds-file-input__description')).not.toBeNull();
    expect(container.querySelector('.ds-file-input')).toHaveAttribute('data-variant', 'dropzone');
  });

  /*
   * `aria-describedby` used to sit after the `{...props}` spread, so a caller
   * passing its own help-text id had it silently dropped. Found by migrating the
   * profile-photo picker, whose "Accepts image files under 2 MB" stopped being
   * announced — and nothing looked wrong.
   */
  it('adds a caller aria-describedby to its own rather than replacing it', () => {
    render(
      <>
        <FileInput
          label="Profile photo"
          description="Square images look best."
          aria-describedby="caller-help"
          onChange={vi.fn()}
        />
        <p id="caller-help">Accepts image files under 2 MB.</p>
      </>,
    );
    expect(screen.getByLabelText('Profile photo'))
      .toHaveAccessibleDescription('Square images look best. Accepts image files under 2 MB.');
  });

  it('still describes the input from a caller id alone', () => {
    render(
      <>
        <FileInput label="Profile photo" aria-describedby="only-help" onChange={vi.fn()} />
        <p id="only-help">Accepts image files under 2 MB.</p>
      </>,
    );
    expect(screen.getByLabelText('Profile photo'))
      .toHaveAccessibleDescription('Accepts image files under 2 MB.');
  });

  /*
   * The behaviour the docblocks claimed for months and did not have.
   *
   * A `<label>` forwards *activation* to the control it labels, which is a click
   * and not a drop, and the input is clipped to 1x1 — so before 2026-08-25 a file
   * dropped on the dashed panel landed on the label and was discarded. Four
   * upload panels advertised a dropzone that ignored drops.
   *
   * The assertion that matters is not "onDrop ran" but "the consumer got its
   * file the same way it always does": every call site reads
   * `event.target.files`, so the handler puts the dropped list on the real input
   * and dispatches `change` from it. If that ever regresses to a hand-made event
   * object, `event.target.files` goes undefined at four call sites and this test
   * is what says so.
   */
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

  it('refuses an unsupported variant rather than falling back to the button', () => {
    expect(() => render(<FileInput label="x" variant="tile" onChange={vi.fn()} />))
      .toThrow(/Unsupported FileInput variant/i);
  });

  it('has no accessibility violations in either variant, loading or not', async () => {
    const dropzone = render(
      <FileInput label="Recipient list" variant="dropzone" description="CSV" onChange={vi.fn()} />,
    );
    expect((await axe(dropzone.container)).violations).toEqual([]);
    dropzone.unmount();
    const busy = render(<FileInput label="Company logo" loading onChange={vi.fn()} />);
    expect((await axe(busy.container)).violations).toEqual([]);
  });
});
