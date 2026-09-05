/**
 * `UploadField` contract: the upload lifecycle, the exact payloads it hands the
 * parent, the frozen strings the E2E specs assert, the `required && !hasValue`
 * rule, and the keyboard/announcement defects the design-system migration fixed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import UploadField from './UploadField';

const file = (name = 'cdl.pdf') => new File(['x'], name, { type: 'application/pdf' });

const renderField = (props = {}) => {
  const onUpload = props.onUpload || vi.fn(async () => ({ name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' }));
  const onChange = props.onChange || vi.fn();
  const utils = render(
    <UploadField
      label="Upload CDL (Front)"
      name="cdl-front"
      value={null}
      onUpload={onUpload}
      onChange={onChange}
      {...props}
    />,
  );
  return { ...utils, onUpload, onChange };
};

const input = () => document.querySelector('input[name="cdl-front"]');
const wrapper = () => document.querySelector('[data-upload-field="cdl-front"]');

describe('UploadField upload lifecycle', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('calls onUpload with the field name and file, then onChange with the result', async () => {
    const result = { name: 'cdl.pdf', url: 'https://example.com/cdl.pdf', storagePath: 'guest/cdl.pdf' };
    const { onUpload, onChange } = renderField({ onUpload: vi.fn(async () => result) });

    fireEvent.change(input(), { target: { files: [file()] } });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('cdl-front', result));
    expect(onUpload).toHaveBeenCalledWith('cdl-front', expect.any(File));
    expect(onUpload.mock.calls[0][1].name).toBe('cdl.pdf');
  });

  it('treats a missing result as a failure with the frozen guard message', async () => {
    const { onChange } = renderField({ onUpload: vi.fn(async () => null) });

    fireEvent.change(input(), { target: { files: [file()] } });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Upload completed but no file metadata was returned.'),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('announces the upload failure and offers a retry', async () => {
    renderField({ onUpload: vi.fn(async () => { throw new Error('Upload failed. Please try again.'); }) });

    fireEvent.change(input(), { target: { files: [file()] } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Upload failed. Please try again.');
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(wrapper()).toHaveAttribute('data-upload-state', 'error');
  });

  it('announces success with the frozen "Uploaded Successfully" text', () => {
    renderField({ value: { name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' } });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Uploaded Successfully');
    expect(wrapper()).toHaveAttribute('data-upload-state', 'uploaded');
  });

  it('exposes determinate upload progress while uploading', async () => {
    let release;
    renderField({ onUpload: vi.fn(() => new Promise((r) => { release = () => r({ name: 'a.pdf', url: 'u' }); })) });

    fireEvent.change(input(), { target: { files: [file()] } });

    const bar = await screen.findByRole('progressbar', { name: 'Upload CDL (Front) upload progress' });
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(wrapper()).toHaveAttribute('data-upload-state', 'uploading');
    release();
  });

  // jsdom does not implement window.confirm, so it is stubbed by assignment
  // rather than spied on. It is asserted *unused*: the removal prompt was a bare
  // `confirm(...)` until 2026-07-28 and must not come back.
  const stubConfirm = (answer) => {
    const previous = window.confirm;
    const spy = vi.fn(() => answer);
    window.confirm = spy;
    return { spy, restore: () => { window.confirm = previous; } };
  };

  const clickRemove = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Remove Upload CDL (Front) file' }));

  it('clears the value through onChange(name, null) after confirmation', () => {
    const { spy, restore } = stubConfirm(true);
    const { onChange } = renderField({ value: { name: 'cdl.pdf', url: 'u' } });

    clickRemove();

    // The blocking prompt is gone; an accessible dialog names the field instead.
    const dialog = screen.getByRole('dialog', { name: 'Remove this file?' });
    expect(spy).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('Upload CDL (Front)');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove file' }));
    expect(onChange).toHaveBeenCalledWith('cdl-front', null);
    restore();
  });

  it('keeps the file when removal is declined', () => {
    const { restore } = stubConfirm(false);
    const { onChange } = renderField({ value: { name: 'cdl.pdf', url: 'u' } });

    clickRemove();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep file' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    restore();
  });

  it('keeps the file when the confirmation is dismissed with Escape', () => {
    const { onChange } = renderField({ value: { name: 'cdl.pdf', url: 'u' } });

    clickRemove();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens the removal confirmation with focus on the safe action', () => {
    renderField({ value: { name: 'cdl.pdf', url: 'u' } });
    clickRemove();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep file' }));
  });
});

/**
 * A mixed drop, where the picker is removed by the very file that succeeded.
 *
 * `FileInput` renders its own rejection alert, but this field renders the picker
 * only while there is nothing to show — so the accepted file unmounts the alert
 * in the commit that created it, and the applicant never learns that a second
 * file was turned away. Found in review on 2026-08-26.
 */
describe('UploadField unmounting mid-upload', () => {
  /*
   * The fake-progress interval was cleared on success and on failure and
   * nowhere else, so unmounting while an upload was still in flight left a
   * 200ms timer calling `setProgress` on a component that no longer existed —
   * for the life of the tab, for anyone who navigated away mid-upload. React 19
   * does not warn about that, so nothing said so.
   *
   * It surfaced as `ReferenceError: window is not defined` in CI, the timer
   * outliving jsdom's teardown, on a pull request that did not touch this file.
   * Adding one unrelated test file shifted the scheduling that had been hiding
   * it — the tell for a leak rather than a flake, since nothing here is
   * timing-dependent except whether teardown wins the race.
   *
   * Reproduced before it was fixed: without the unmount cleanup this leaves a
   * pending timer and the assertion below fails.
   */
  it('leaves no timer running after it is unmounted', async () => {
    vi.useFakeTimers();
    try {
      // An upload that never settles, so the interval is still live at unmount.
      const onUpload = vi.fn(() => new Promise(() => {}));
      const { unmount } = renderField({ onUpload });

      await act(async () => {
        fireEvent.change(input(), { target: { files: [file()] } });
      });

      // The interval is running: advancing time schedules progress updates.
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('UploadField rejected-drop feedback', () => {
  beforeEach(() => vi.clearAllMocks());

  const dropOn = (...files) => {
    const transfer = new DataTransfer();
    for (const f of files) transfer.items.add(f);
    fireEvent.drop(input().closest('label'), { dataTransfer: transfer });
  };
  const selfie = () => new File(['x'], 'selfie.png', { type: 'image/png' });
  const held = () => {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
  };
  const messageShowing = () => screen
    .queryAllByRole('alert')
    .some((a) => /selfie\.png was not added/.test(a.textContent));

  it('keeps the message while the accepted file uploads', async () => {
    // The picker is gone during the upload, so this field's copy is what carries
    // the message — the case the whole `onReject` path exists for.
    const { unmount } = renderField({ accept: 'application/pdf', onUpload: vi.fn(() => held().promise) });
    dropOn(file('cdl.pdf'), selfie());

    await waitFor(() => expect(input()).toBeNull());
    expect(messageShowing()).toBe(true);

    unmount();
  });

  it('keeps it after the parent takes the value, because the picker stays gone', async () => {
    const upload = held();
    const { rerender } = renderField({
      accept: 'application/pdf',
      onUpload: vi.fn(() => upload.promise),
    });
    dropOn(file('cdl.pdf'), selfie());
    await waitFor(() => expect(input()).toBeNull());

    await act(async () => {
      upload.release({ name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' });
    });
    rerender(
      <UploadField
        label="Upload CDL (Front)"
        name="cdl-front"
        value={{ name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' }}
        accept="application/pdf"
        onUpload={vi.fn()}
        onChange={vi.fn()}
      />,
    );

    expect(input()).toBeNull();
    expect(messageShowing()).toBe(true);
  });

  it('drops it when a failed upload brings the picker back', async () => {
    renderField({
      accept: 'application/pdf',
      onUpload: vi.fn(async () => { throw new Error('network'); }),
    });
    dropOn(file('cdl.pdf'), selfie());

    await waitFor(() => expect(input()).not.toBeNull());
    expect(messageShowing()).toBe(false);
    expect(input()).not.toHaveAttribute('aria-invalid');
  });

  it('drops it when a success brings the picker back, without waiting for the reset', async () => {
    /*
     * The third transition a review found by enumeration, and the reason the rule
     * became a derived one: `setStatus('success')` makes the picker visible again
     * immediately when the parent has not taken the value, a full second before
     * the reset timer. Nothing has to be timed now — the message is simply not
     * rendered while a picker is on screen.
     */
    renderField({ accept: 'application/pdf' });
    dropOn(file('cdl.pdf'), selfie());

    await waitFor(() => expect(input()).not.toBeNull());
    expect(messageShowing()).toBe(false);
  });

  it('still uploads the file it accepted', async () => {
    const { onUpload } = renderField({ accept: 'application/pdf' });
    dropOn(file('cdl.pdf'), selfie());

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    // `onUpload(name, file)` — the field's own signature.
    expect(onUpload.mock.calls[0][1].name).toBe('cdl.pdf');
  });

  it('shows exactly one message for an all-refused drop', () => {
    // The picker stays on screen, so IT shows the message and this field's copy
    // is gated off. One alert, and it is the one attached to the live input.
    renderField({ accept: 'application/pdf' });
    dropOn(selfie());

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('selfie.png was not added');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the message when a later drop is accepted in full', async () => {
    renderField({ accept: 'application/pdf' });
    dropOn(selfie());
    expect(messageShowing()).toBe(true);

    dropOn(file('cdl.pdf'));

    await waitFor(() => expect(messageShowing()).toBe(false));
  });

  it('says nothing when every dropped file is accepted', () => {
    renderField({ accept: 'application/pdf' });
    dropOn(file('cdl.pdf'));

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('UploadField accessibility and required rules', () => {
  /*
   * The picker is the design system's `FileInput variant="dropzone"` since
   * 2026-08-25. It was a `Button` driving a `tabIndex={-1}` hidden input; it is
   * now a real focusable input behind a real `<label>`, which is the primitive's
   * one structural rule; `FileInput`'s `onDrop` is what makes the panel a real
   * drop target.
   *
   * So the trigger is not a `<button>` any more, the input IS in the tab order,
   * and the visible copy is unchanged. The accessible name moved from "the frozen
   * visible copy plus a hidden disambiguating suffix" to the field's own label,
   * which is what every other control in the system announces as.
   */
  it('offers a keyboard-reachable upload control named by its field', () => {
    renderField();

    expect(input()).toHaveAccessibleName('Upload CDL (Front)');
    const label = input().closest('label');
    expect(label).not.toBeNull();
    expect(label).toHaveAttribute('for', input().id);
    // Visible copy is unchanged.
    expect(label).toHaveTextContent('Click to upload');
  });

  it('keeps the input focusable rather than hiding it from the tab order', () => {
    renderField({ required: true });
    expect(input()).not.toHaveAttribute('tabindex', '-1');
    expect(input()).not.toHaveAttribute('hidden');
    // Clipped, not display:none — an unfocusable required control makes
    // reportValidity() fail with no visible message.
    expect(input().className).toContain('ds-file-input__native');

    input().focus();
    expect(document.activeElement).toBe(input());
  });

  it('names the hidden input from the visible field label', () => {
    renderField();
    expect(screen.getByLabelText('Upload CDL (Front)')).toBe(input());
  });

  /*
   * Same guarantee, reached differently. The picker used to stay in the DOM in
   * every state with `required={required && !hasValue}`; it is now rendered only
   * in the idle/error state, always required. Either way native validation blocks
   * an empty required field and does not block a filled one — an absent control
   * cannot be required.
   */
  it('blocks submission only while empty', () => {
    const { rerender } = render(
      <UploadField label="Upload CDL (Front)" name="cdl-front" value={null} required onUpload={vi.fn()} onChange={vi.fn()} />,
    );
    expect(input()).toBeRequired();

    rerender(
      <UploadField label="Upload CDL (Front)" name="cdl-front" value={{ name: 'a.pdf', url: 'u' }} required onUpload={vi.fn()} onChange={vi.fn()} />,
    );
    expect(input()).toBeNull();
    expect(document.querySelector(':invalid')).toBeNull();
  });

  it('keeps the accept default and its help copy', () => {
    renderField();
    expect(input()).toHaveAttribute('accept', 'image/*,application/pdf');
    expect(screen.getByText('PDF, PNG, JPG accepted')).toBeInTheDocument();
  });

  it('reports an empty state before any file is chosen', () => {
    renderField();
    expect(wrapper()).toHaveAttribute('data-upload-state', 'empty');
  });

  it('gives the image preview a descriptive alt text', () => {
    renderField({ value: { name: 'cdl.png', url: 'https://example.com/cdl.png' } });
    expect(screen.getByAltText('Upload CDL (Front) preview')).toBeInTheDocument();
  });

  it('names the view-file link, and says it opens a new tab', () => {
    renderField({ value: { name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' } });
    // Matched as a prefix, not an exact string. The frozen property is that the
    // name says *which* file the link opens — one of these renders per document,
    // so a shared name would leave a screen-reader user with a list of
    // identical links. The new-tab suffix comes from `IconButtonLink`'s
    // `external` and is asserted separately, so this test pins the requirement
    // without pinning out an improvement to how the name is announced.
    const link = screen.getByRole('link', { name: /^View Upload CDL \(Front\) file\b/ });
    expect(link).toHaveAttribute('href', 'https://example.com/cdl.pdf');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAccessibleName(/\(opens in a new tab\)$/);
  });
});
