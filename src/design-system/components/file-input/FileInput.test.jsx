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

  /*
   * The drag-and-drop half of that restore, and the defect it shipped with.
   *
   * `handleDrop` delivers a dropped file by assigning it to the input and
   * dispatching `change` from it — deliberately, so every call site keeps
   * reading `event.target.files`. The first version of the focus flag was armed
   * by *any* change, on the reasoning that a change event proves the input is
   * focused. It does not prove it for that dispatch: a drop moves no focus.
   *
   * Measured in Chromium rather than assumed: after a drop on the panel
   * `document.activeElement` is still `<body>`, and disabling a focused input
   * also leaves it on `<body>` — so the "nothing is focused" guard below cannot
   * tell a mouse user who never focused anything from a keyboard user whose
   * focus was just taken away. A drag-and-drop upload therefore ended with focus
   * inside a 1x1 clipped file input the user had never touched.
   *
   * These three tests pin the rule that replaced it: focus goes back to where
   * the user actually was, which is a question about focus and not about which
   * path delivered the file.
   */
  it('does not move focus into the hidden input after a drag-and-drop upload', () => {
    const Harness = ({ uploading }) => (
      <FileInput
        label="Company logo"
        variant="dropzone"
        accept="image/*"
        loading={uploading}
        onChange={vi.fn()}
      />
    );
    const { rerender } = render(<Harness uploading={false} />);
    const input = screen.getByLabelText('Company logo');

    // A file dragged from the desktop, by a user who has focused nothing.
    expect(document.body).toHaveFocus();
    const transfer = new DataTransfer();
    transfer.items.add(new File(['png'], 'logo.png', { type: 'image/png' }));
    fireEvent.drop(input.closest('label'), { dataTransfer: transfer });

    // The parent uploads it and finishes.
    rerender(<Harness uploading />);
    rerender(<Harness uploading={false} />);

    expect(input).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('restores focus after a drop when the input is what the user was on', () => {
    // Not a special case for drops: the same question, with the other answer. A
    // keyboard user sitting on the picker who drags a file in still had focus
    // here, so giving it back is a return rather than a jump.
    const Harness = ({ uploading }) => (
      <FileInput
        label="Company logo"
        variant="dropzone"
        accept="image/*"
        loading={uploading}
        onChange={vi.fn()}
      />
    );
    const { rerender } = render(<Harness uploading={false} />);
    const input = screen.getByLabelText('Company logo');
    input.focus();

    const transfer = new DataTransfer();
    transfer.items.add(new File(['png'], 'logo.png', { type: 'image/png' }));
    fireEvent.drop(input.closest('label'), { dataTransfer: transfer });

    rerender(<Harness uploading />);
    // The browser's own consequence of disabling the focused element.
    document.body.focus();
    rerender(<Harness uploading={false} />);

    expect(input).toHaveFocus();
  });

  it('does not arm a restore from a change the input was not focused for', () => {
    // The arming rule itself, isolated from the guard below it: at the moment
    // the file arrives the user is on another control, so nothing is armed —
    // and the fact that they are nowhere by the time the upload ends must not
    // pull focus into a hidden input.
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
    screen.getByRole('button', { name: 'Elsewhere' }).focus();

    fireEvent.change(input, { target: { files: [] } });

    rerender(<Harness uploading />);
    document.body.focus();
    rerender(<Harness uploading={false} />);

    expect(input).not.toHaveFocus();
    expect(document.body).toHaveFocus();
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

/**
 * The upload has to say it is happening.
 *
 * Both pickers this component replaced carried a `<p role="status">` region
 * reading "Uploading company logo…", and the 2026-08-25 migration deleted them
 * on the reasoning that `aria-busy` on the input plus the button text now carried
 * the state. Neither of those is announced: `aria-busy` sits on an input that
 * `loading` has just disabled and taken focus from, and the button text is
 * ordinary content in a `<label>`, not a live region. A review on 2026-08-26
 * caught it — the upload had gone silent for a screen-reader user, and the two
 * feature tests that had proven otherwise were rewritten to assert the
 * replacement rather than the behaviour.
 *
 * So the region is back, once, in the primitive whose prop `loading` is.
 */
/**
 * A drop the `accept` list refuses used to end in silence — the file went
 * nowhere, no message appeared, and the panel looked exactly as it had. Recorded
 * on the roadmap on 2026-08-26 and fixed here.
 */
describe('FileInput rejected-drop feedback', () => {
  const dropOn = (label, ...files) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    fireEvent.drop(label, { dataTransfer: transfer });
  };
  const labelOf = () => document.querySelector('input[type="file"]').closest('label');
  const inputOf = () => document.querySelector('input[type="file"]');
  const pdf = (name = 'scan.pdf') => new File(['%PDF'], name, { type: 'application/pdf' });
  const png = (name = 'logo.png') => new File(['png'], name, { type: 'image/png' });

  it('says out loud that the file was refused', () => {
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    dropOn(labelOf(), pdf());

    expect(screen.getByRole('alert')).toHaveTextContent(
      'scan.pdf was not added. It is not an accepted file type.',
    );
  });

  it('shows the message visibly, not only to a screen reader', () => {
    // The sighted user who dropped a PDF on an image field needs to know it went
    // nowhere just as much — WCAG 3.3.1 wants the error identified in text.
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    dropOn(labelOf(), pdf());

    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveClass('ds-visually-hidden');
    expect(alert).toHaveClass('ds-file-input__error');
  });

  it('is assertive, matching the system\'s rule for an error', () => {
    // `FieldMessage` renders an error as role="alert" and everything else
    // politely. A rejection answers something the user just did.
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).toBeNull();

    dropOn(labelOf(), pdf());

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).not.toHaveAttribute('aria-live', 'polite');
  });

  it('still refuses to hand the file to the consumer', () => {
    const onChange = vi.fn();
    render(<FileInput label="Company logo" accept="image/*" onChange={onChange} />);
    dropOn(labelOf(), pdf());

    expect(onChange).not.toHaveBeenCalled();
    expect(inputOf().files).toHaveLength(0);
  });

  it('marks the control invalid and describes it while the message stands', () => {
    render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
    const input = inputOf();
    expect(input).not.toHaveAttribute('aria-invalid');

    dropOn(labelOf(), pdf());

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby'))
      .toContain(screen.getByRole('alert').id);
  });

  it('keeps a caller description and adds the rejection to it', () => {
    render(
      <FileInput
        label="Company logo"
        accept="image/*"
        description="PNG or JPG, under 2 MB"
        onChange={vi.fn()}
      />,
    );
    dropOn(labelOf(), pdf());

    expect(inputOf()).toHaveAccessibleDescription(
      /PNG or JPG, under 2 MB.*was not added/s,
    );
  });

  describe('a mixed drop', () => {
    it('takes the accepted files and reports the refused one', () => {
      const onChange = vi.fn();
      render(<FileInput label="Attachments" accept="image/*" multiple onChange={onChange} />);
      dropOn(labelOf(), png('logo.png'), pdf('resume.pdf'));

      expect(Array.from(onChange.mock.calls[0][0].target.files).map((f) => f.name))
        .toEqual(['logo.png']);
      expect(screen.getByRole('alert')).toHaveTextContent(
        'resume.pdf was not added. It is not an accepted file type.',
      );
    });

    it('does not let the accepted file erase the message it earned', () => {
      // `handleChange` clears the standing rejection, and the drop dispatches
      // that change. If the message were recorded first it would be wiped by its
      // own accepted files.
      render(<FileInput label="Attachments" accept="image/*" multiple onChange={vi.fn()} />);
      dropOn(labelOf(), png(), pdf());

      expect(screen.getByRole('alert')).toHaveTextContent('was not added');
    });

    it('tells a single-file field\'s user that only one file was taken', () => {
      render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
      dropOn(labelOf(), png('one.png'), png('two.png'));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'This field takes one file, so only one.png was added.',
      );
    });
  });

  describe('clearing', () => {
    it('clears when a later drop is accepted in full', () => {
      render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
      dropOn(labelOf(), pdf());
      expect(screen.getByRole('alert')).toBeInTheDocument();

      dropOn(labelOf(), png());

      expect(screen.queryByRole('alert')).toBeNull();
      expect(inputOf()).not.toHaveAttribute('aria-invalid');
    });

    it('clears when the native picker is used instead', () => {
      render(<FileInput label="Company logo" accept="image/*" onChange={vi.fn()} />);
      dropOn(labelOf(), pdf());
      expect(screen.getByRole('alert')).toBeInTheDocument();

      fireEvent.change(inputOf(), { target: { files: [png()] } });

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not leave the description quoting a message that is gone', () => {
      render(
        <FileInput
          label="Company logo"
          accept="image/*"
          description="PNG or JPG"
          onChange={vi.fn()}
        />,
      );
      dropOn(labelOf(), pdf());
      dropOn(labelOf(), png());

      expect(inputOf()).toHaveAccessibleDescription('PNG or JPG');
    });
  });

  it('stays silent for a drop on a disabled control, which accepts nothing anyway', () => {
    render(<FileInput label="Company logo" accept="image/*" disabled onChange={vi.fn()} />);
    dropOn(labelOf(), pdf());

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not announce a rejection for a drop of files it can all take', () => {
    render(<FileInput label="Attachments" accept="image/*" multiple onChange={vi.fn()} />);
    dropOn(labelOf(), png('a.png'), png('b.png'));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('when the consumer replaces the picker', () => {
    /*
     * Found in review on 2026-08-26 and reproduced before it was fixed.
     *
     * `EnvelopeSidebar` renders `{!file ? <FileInput/> : …}` and `UploadField`
     * renders the picker only in its idle state, so a MIXED drop hands them a
     * file, they re-render, and the component's own alert is unmounted in the
     * commit that created it. The all-refused case was never affected: no file
     * arrives, so nothing unmounts.
     */
    const Swapping = ({ onReject }) => {
      const [file, setFile] = React.useState(null);
      return file
        ? <p>Uploading {file.name}</p>
        : (
          <FileInput
            label="Document"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files[0])}
            onReject={onReject}
          />
        );
    };

    it('still reports the refused file through onReject', () => {
      const onReject = vi.fn();
      render(<Swapping onReject={onReject} />);
      dropOn(labelOf(), pdf('contract.pdf'), png('logo.png'));

      expect(screen.getByText(/Uploading contract\.pdf/)).toBeInTheDocument();
      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onReject.mock.calls[0][0].message)
        .toBe('logo.png was not added. It is not an accepted file type.');
      expect(onReject.mock.calls[0][0].rejected.map((f) => f.name)).toEqual(['logo.png']);
      expect(onReject.mock.calls[0][0].accepted.map((f) => f.name)).toEqual(['contract.pdf']);
    });

    it('fires onReject AFTER onChange, so a consumer clearing stale state loses nothing', () => {
      // The ordering the fix depends on: a call site that resets its own message
      // in onChange must not wipe the one that arrived with this very drop.
      const order = [];
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          onChange={() => order.push('change')}
          onReject={() => order.push('reject')}
        />,
      );
      dropOn(labelOf(), pdf('contract.pdf'), png('logo.png'));

      expect(order).toEqual(['change', 'reject']);
    });

    it('does not call onReject when every dropped file is accepted', () => {
      const onReject = vi.fn();
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          multiple
          onChange={vi.fn()}
          onReject={onReject}
        />,
      );
      dropOn(labelOf(), pdf('a.pdf'), pdf('b.pdf'));

      expect(onReject).not.toHaveBeenCalled();
    });

    it('reports an all-refused drop through onReject too', () => {
      const onReject = vi.fn();
      render(
        <FileInput label="Document" accept="application/pdf" onChange={vi.fn()} onReject={onReject} />,
      );
      dropOn(labelOf(), png('logo.png'));

      expect(onReject).toHaveBeenCalledTimes(1);
      expect(onReject.mock.calls[0][0].message).toBe(
        'logo.png was not added. It is not an accepted file type.',
      );
    });

    it('renders NO message of its own once onReject is passed', () => {
      // Ownership transfers with the callback. Rendering both would put two
      // copies on screen while the picker is still mounted and announce the same
      // sentence twice — "sometimes one, sometimes two" is the worst contract of
      // the three.
      render(
        <FileInput
          label="Document"
          accept="application/pdf"
          onChange={vi.fn()}
          onReject={vi.fn()}
        />,
      );
      dropOn(labelOf(), png('logo.png'));

      expect(screen.queryByRole('alert')).toBeNull();
      expect(inputOf()).not.toHaveAttribute('aria-invalid');
    });

    it('renders its own message when onReject is absent', () => {
      render(<FileInput label="Document" accept="application/pdf" onChange={vi.fn()} />);
      dropOn(labelOf(), png('logo.png'));

      expect(screen.getByRole('alert')).toHaveTextContent('logo.png was not added');
      expect(inputOf()).toHaveAttribute('aria-invalid', 'true');
    });
  });

  it('has no accessibility violations while showing a rejection', async () => {
    const { container } = render(
      <FileInput label="Company logo" accept="image/*" variant="dropzone" onChange={vi.fn()} />,
    );
    dropOn(labelOf(), pdf());

    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('FileInput upload announcement', () => {
  it('announces the upload in a polite live region', () => {
    const Harness = ({ uploading }) => (
      <FileInput label="Company logo" loading={uploading} onChange={vi.fn()} />
    );
    const { container, rerender } = render(<Harness uploading={false} />);

    // Present and EMPTY before the upload starts. A live region has to be in the
    // document before its text changes for the change to be announced, so the
    // span is unconditional and only its contents move.
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status).toBeEmptyDOMElement();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.className).toContain('ds-visually-hidden');

    rerender(<Harness uploading />);
    expect(status).toHaveTextContent('Uploading Company logo…');
    // The same element, not a remounted one — a region that is replaced while it
    // fills is a region that may never be announced.
    expect(container.querySelector('[role="status"]')).toBe(status);
  });

  it('empties the region when the upload ends rather than claiming it worked', () => {
    // This component knows an upload *started*; `loading` is all it is told. It
    // never learns whether the request succeeded, so "Upload complete" here
    // would eventually announce success over a failure. The feature that owns
    // the request owns the outcome.
    const Harness = ({ uploading }) => (
      <FileInput label="Company logo" loading={uploading} onChange={vi.fn()} />
    );
    const { container, rerender } = render(<Harness uploading />);
    const status = container.querySelector('[role="status"]');
    expect(status).toHaveTextContent('Uploading Company logo…');

    rerender(<Harness uploading={false} />);
    expect(status).toBeEmptyDOMElement();
  });

  it('names the field being uploaded, and takes an override', () => {
    // Two busy pickers on one screen have to be distinguishable, which a bare
    // "Uploading…" is not.
    const { unmount } = render(
      <FileInput label="Recipient list" loading onChange={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Uploading Recipient list…');
    unmount();

    render(
      <FileInput
        label="Recipient list"
        loading
        loadingStatus="Importing the recipient list…"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Importing the recipient list…');
  });

  it('falls back to the default rather than letting a blank override silence it', () => {
    // `loadingStatus=""` is not a supported way to turn the announcement off:
    // an upload that says nothing is the defect this region exists to fix.
    render(<FileInput label="Recipient list" loading loadingStatus="   " onChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Uploading Recipient list…');
  });

  /*
   * The name and the description are a contract, and the region must not join
   * either of them. A field whose accessible name grows "Uploading…" mid-upload
   * is a field that has been renamed underneath the user; one whose description
   * does is a field whose accepted types have been overwritten by a progress
   * message. The region is read because it is live, not because it names
   * anything, which is why it is referenced by neither attribute and sits
   * outside the `<label>`.
   */
  it('leaves the accessible name and description untouched while uploading', () => {
    const Harness = ({ uploading }) => (
      <FileInput
        label="Company logo"
        description="PNG, JPG or SVG."
        aria-describedby="logo-help"
        loading={uploading}
        onChange={vi.fn()}
      />
    );
    const { container, rerender } = render(
      <>
        <Harness uploading={false} />
        <p id="logo-help">Replaces the current logo.</p>
      </>,
    );
    const input = screen.getByLabelText('Company logo');
    expect(input).toHaveAccessibleName('Company logo');
    expect(input).toHaveAccessibleDescription('PNG, JPG or SVG. Replaces the current logo.');

    rerender(
      <>
        <Harness uploading />
        <p id="logo-help">Replaces the current logo.</p>
      </>,
    );
    expect(container.querySelector('[role="status"]')).toHaveTextContent('Uploading Company logo…');
    expect(input).toHaveAccessibleName('Company logo');
    expect(input).toHaveAccessibleDescription('PNG, JPG or SVG. Replaces the current logo.');
    // Outside the `<label>`, so the visible control cannot absorb it either.
    expect(input.closest('label').querySelector('[role="status"]')).toBeNull();
  });

  it('has no accessibility violations with the region filled', async () => {
    const { container } = render(
      <FileInput label="Company logo" description="PNG, JPG or SVG." loading onChange={vi.fn()} />,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});
