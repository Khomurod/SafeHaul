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

    it('exposes a labelled file input with accepted types and a described trigger in edit mode', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });

        const input = container.querySelector('input[type="file"]');
        expect(input).toHaveAccessibleName('Upload company logo');
        expect(input).toHaveAttribute('accept', 'image/*');

        const describedBy = input.getAttribute('aria-describedby');
        expect(document.getElementById(describedBy)).toHaveTextContent(/Accepts image files/i);
        expect(screen.getByText(/A logo is set\. Uploading a new image replaces it\./i))
            .toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Change logo' })).toBeEnabled();
    });

    it('labels the trigger as Upload logo when no logo exists', () => {
        setup({ companyLogoUrl: '', isEditing: true });
        expect(screen.getByRole('button', { name: 'Upload logo' })).toBeInTheDocument();
        expect(screen.getByText(/No logo uploaded yet\./)).toBeInTheDocument();
    });

    it('opens the file picker from the keyboard-accessible button (no nested interactive elements)', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });

        const input = container.querySelector('input[type="file"]');
        const clickSpy = vi.spyOn(input, 'click');

        fireEvent.click(screen.getByRole('button', { name: 'Change logo' }));
        expect(clickSpy).toHaveBeenCalledTimes(1);

        expect(container.querySelectorAll('button')).toHaveLength(1);
        expect(input.closest('button')).toBeNull();
        expect(input.closest('label')).toBeNull();
    });

    it('forwards the native change event verbatim on file selection', () => {
        const { container, onLogoUpload } = setup({ companyLogoUrl: LOGO_URL, isEditing: true });

        const file = new File(['x'], 'logo.png', { type: 'image/png' });
        const input = container.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [file] } });

        expect(onLogoUpload).toHaveBeenCalledTimes(1);
        expect(onLogoUpload.mock.calls[0][0].target.files[0]).toBe(file);
    });

    it('announces uploading and disables the controls while an upload is in flight', () => {
        const { container } = setup({ companyLogoUrl: LOGO_URL, isEditing: true, logoUploading: true });

        expect(screen.getByRole('status')).toHaveTextContent('Uploading company logo…');
        expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
        expect(container.querySelector('input[type="file"]')).toBeDisabled();
    });

    it('returns focus to the trigger after an upload settles', () => {
        const onLogoUpload = vi.fn();
        const { rerender } = render(
            <BrandingSection companyLogoUrl={LOGO_URL} isEditing logoUploading={false} onLogoUpload={onLogoUpload} />,
        );
        rerender(
            <BrandingSection companyLogoUrl={LOGO_URL} isEditing logoUploading onLogoUpload={onLogoUpload} />,
        );
        rerender(
            <BrandingSection companyLogoUrl={LOGO_URL} isEditing logoUploading={false} onLogoUpload={onLogoUpload} />,
        );

        expect(screen.getByRole('button', { name: 'Change logo' })).toHaveFocus();
    });

    it('has no accessibility violations in display or edit mode', async () => {
        const display = setup({ companyLogoUrl: LOGO_URL, isEditing: false });
        expect((await axe(display.container)).violations).toEqual([]);
        display.unmount();

        const edit = setup({ companyLogoUrl: LOGO_URL, isEditing: true });
        expect((await axe(edit.container)).violations).toEqual([]);
    });
});
