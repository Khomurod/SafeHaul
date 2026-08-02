/**
 * `UploadField` contract: the upload lifecycle, the exact payloads it hands the
 * parent, the frozen strings the E2E specs assert, the `required && !hasValue`
 * rule, and the keyboard/announcement defects the design-system migration fixed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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

describe('UploadField accessibility and required rules', () => {
  it('offers a keyboard-reachable, uniquely named upload trigger', () => {
    renderField();

    const trigger = screen.getByRole('button', { name: /Click to upload Upload CDL \(Front\)/ });
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    // Visible copy is unchanged.
    expect(trigger).toHaveTextContent('Click to upload');
  });

  it('opens the native picker when the trigger is activated by keyboard', () => {
    renderField();
    const click = vi.spyOn(input(), 'click');

    fireEvent.click(screen.getByRole('button', { name: /Click to upload/ }));
    expect(click).toHaveBeenCalled();
  });

  it('keeps the hidden input out of the tab order but focusable for validation', () => {
    renderField({ required: true });
    expect(input()).toHaveAttribute('tabindex', '-1');
    expect(input().className).toContain('ds-visually-hidden');
    // Not display:none — an unfocusable required control makes reportValidity()
    // fail with no visible message.
    expect(input().className).not.toContain('hidden ');
  });

  it('names the hidden input from the visible field label', () => {
    renderField();
    expect(screen.getByLabelText('Upload CDL (Front)')).toBe(input());
  });

  it('is required only while empty', () => {
    const { rerender } = render(
      <UploadField label="Upload CDL (Front)" name="cdl-front" value={null} required onUpload={vi.fn()} onChange={vi.fn()} />,
    );
    expect(input()).toBeRequired();

    rerender(
      <UploadField label="Upload CDL (Front)" name="cdl-front" value={{ name: 'a.pdf', url: 'u' }} required onUpload={vi.fn()} onChange={vi.fn()} />,
    );
    expect(input()).not.toBeRequired();
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

  it('names the view-file link', () => {
    renderField({ value: { name: 'cdl.pdf', url: 'https://example.com/cdl.pdf' } });
    const link = screen.getByRole('link', { name: 'View Upload CDL (Front) file' });
    expect(link).toHaveAttribute('href', 'https://example.com/cdl.pdf');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
