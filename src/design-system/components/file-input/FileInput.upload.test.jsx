import React from 'react';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { FileInput } from './FileInput';

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
