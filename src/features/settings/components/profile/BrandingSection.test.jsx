import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { BrandingSection } from './BrandingSection';

// Artificial, non-production values only.
const LOGO_URL = 'https://cdn.example.test/company-1/logo.png';

function setup(props = {}) {
    const onLogoUpload = props.onLogoUpload ?? vi.fn();
    const utils = render(
        <BrandingSection
            companyLogoUrl={props.companyLogoUrl ?? ''}
            isEditing={props.isEditing ?? false}
            logoUploading={props.logoUploading ?? false}
            onLogoUpload={onLogoUpload}
        />,
    );
    return { ...utils, onLogoUpload };
}

describe('BrandingSection', () => {
    it('renders the existing logo with meaningful alt text and no upload control when not editing', () => {
        setup({ companyLogoUrl: LOGO_URL, isEditing: false });

        const image = screen.getByRole('img', { name: 'Company logo' });
        expect(image).toHaveAttribute('src', LOGO_URL);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it('shows an accessible fallback when there is no logo', () => {
        setup({ companyLogoUrl: '', isEditing: false });

        expect(screen.queryByRole('img', { name: 'Company logo' })).not.toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'No company logo set' })).toBeInTheDocument();
    });

    /*
     * The picker is the design system's `FileInput` since 2026-08-25, so the
     * input is named by its FIELD and the visible affordance is the `<label>`
     * wrapping it rather than a `Button` that calls `.click()` on it. Same
     * migration, same reasoning, as `ProfileAvatarField`.
     */
    it('exposes a labelled file input with accepted types and a described trigger in edit mode', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });

        const input = container.querySelector('input[type="file"]');
        expect(input).toHaveAccessibleName('Company logo');
        expect(input).toHaveAttribute('accept', 'image/*');
        expect(input).toHaveAccessibleDescription(/Accepts image files/i);
        expect(screen.getByText(/A logo is set\. Uploading a new image replaces it\./i))
            .toBeInTheDocument();

        expect(container.querySelector('.ds-file-input__button-label')).toHaveTextContent('Change logo');
        expect(input).toBeEnabled();
    });

    it('labels the trigger as Upload logo when no logo exists', () => {
        const { container } = setup({ companyLogoUrl: '', isEditing: true });
        expect(container.querySelector('.ds-file-input__button-label')).toHaveTextContent('Upload logo');
        expect(screen.getByText(/No logo uploaded yet\./)).toBeInTheDocument();
    });

    it('reaches the picker through a real label, with no nested interactive elements', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });

        const input = container.querySelector('input[type="file"]');
        const label = input.closest('label');
        expect(label).not.toBeNull();
        expect(label).toHaveAttribute('for', input.id);
        expect(container.querySelectorAll('button')).toHaveLength(0);

        input.focus();
        expect(document.activeElement).toBe(input);
    });

    it('forwards the native change event verbatim on file selection', () => {
        const { container, onLogoUpload } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });

        const file = new File(['x'], 'logo.png', { type: 'image/png' });
        const input = container.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [file] } });

        expect(onLogoUpload).toHaveBeenCalledTimes(1);
        expect(onLogoUpload.mock.calls[0][0].target.files[0]).toBe(file);
    });

    /*
     * The upload is disabled, busy, AND announced.
     *
     * This test used to assert that `aria-busy` plus the button text had replaced
     * this component's own `role="status"` region. Neither of those is announced,
     * so what it really asserted was that the announcement had gone — the
     * migration's markup, not the screen's behaviour. Found in review on
     * 2026-08-26. The region is `FileInput`'s now; the behaviour is still this
     * screen's, so this is where it is checked.
     */
    it('says it is busy, announces the upload, and refuses a second file', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true, logoUploading: true });

        const input = container.querySelector('input[type="file"]');
        expect(container.querySelector('.ds-file-input__button-label')).toHaveTextContent('Uploading…');
        expect(input).toBeDisabled();
        expect(input).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('status')).toHaveTextContent('Uploading Company logo…');
    });

    it('says nothing in the status region while no upload is running', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });
        expect(container.querySelector('[role="status"]')).toBeEmptyDOMElement();
    });

    it('keeps the same control element mounted across an upload', () => {
        const onLogoUpload = vi.fn();
        const { container, rerender } = render(
            <BrandingSection companyLogoUrl={LOGO_URL} isEditing logoUploading={false} onLogoUpload={onLogoUpload} />,
        );
        const before = container.querySelector('input[type="file"]');
        rerender(
            <BrandingSection companyLogoUrl={LOGO_URL} isEditing logoUploading onLogoUpload={onLogoUpload} />,
        );
        rerender(
            <BrandingSection companyLogoUrl={LOGO_URL} isEditing logoUploading={false} onLogoUpload={onLogoUpload} />,
        );

        // Same element throughout: the picker is not swapped for a disabled
        // button any more, so an upload does not tear the control down. Whether
        // focus comes back when `loading` disables it is `FileInput`'s contract,
        // asserted in its own suite.
        expect(container.querySelector('input[type="file"]')).toBe(before);
        expect(before).not.toBeDisabled();
    });

    it('has no accessibility violations in display or edit mode', async () => {
        const display = setup({ companyLogoUrl: LOGO_URL, isEditing: false });
        expect((await axe(display.container)).violations).toEqual([]);
        display.unmount();

        const edit = setup({ companyLogoUrl: LOGO_URL, isEditing: true });
        expect((await axe(edit.container)).violations).toEqual([]);
    });
});
