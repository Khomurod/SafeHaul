import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { ProfileAvatarField } from './ProfileAvatarField';

// Artificial, non-production values only.
const PHOTO_URL = 'https://cdn.example.test/user-1/avatar.png';

function setup(props = {}) {
    const onFileSelect = props.onFileSelect ?? vi.fn();
    const utils = render(
        <ProfileAvatarField
            photoURL={props.photoURL ?? ''}
            initials={props.initials ?? 'AB'}
            uploading={props.uploading ?? false}
            onFileSelect={onFileSelect}
        />,
    );
    return { ...utils, onFileSelect };
}

describe('ProfileAvatarField', () => {
    it('renders the existing photo with meaningful alt text', () => {
        setup({ photoURL: PHOTO_URL });
        const image = screen.getByRole('img', { name: 'Profile photo' });
        expect(image).toHaveAttribute('src', PHOTO_URL);
    });

    it('shows an accessible initials fallback when there is no photo', () => {
        setup({ photoURL: '', initials: 'AB' });
        expect(screen.queryByRole('img', { name: 'Profile photo' })).not.toBeInTheDocument();
        const fallback = screen.getByRole('img', { name: 'No profile photo set' });
        expect(fallback).toHaveTextContent('AB');
    });

    it('exposes a labelled image-only file input described by the help text', () => {
        const { container } = setup({ photoURL: PHOTO_URL });
        const input = container.querySelector('input[type="file"]');
        expect(input).toHaveAccessibleName('Upload profile photo');
        expect(input).toHaveAttribute('accept', 'image/*');

        const describedBy = input.getAttribute('aria-describedby');
        expect(document.getElementById(describedBy)).toHaveTextContent(/Accepts image files under 2 MB/i);
    });

    it('labels the trigger Change photo when a photo exists and Upload photo when none', () => {
        const { rerender } = setup({ photoURL: PHOTO_URL });
        expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
        rerender(
            <ProfileAvatarField photoURL="" initials="AB" uploading={false} onFileSelect={vi.fn()} />,
        );
        expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    });

    it('opens the file picker from the keyboard-accessible button (no nested interactive elements)', () => {
        const { container } = setup({ photoURL: PHOTO_URL });
        const input = container.querySelector('input[type="file"]');
        const clickSpy = vi.spyOn(input, 'click');

        fireEvent.click(screen.getByRole('button', { name: 'Change photo' }));
        expect(clickSpy).toHaveBeenCalledTimes(1);

        expect(container.querySelectorAll('button')).toHaveLength(1);
        expect(input.closest('button')).toBeNull();
        expect(input.closest('label')).toBeNull();
    });

    it('forwards the native change event verbatim on file selection', () => {
        const { container, onFileSelect } = setup({ photoURL: PHOTO_URL });
        const file = new File(['x'], 'avatar.png', { type: 'image/png' });
        const input = container.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [file] } });

        expect(onFileSelect).toHaveBeenCalledTimes(1);
        expect(onFileSelect.mock.calls[0][0].target.files[0]).toBe(file);
    });

    it('announces uploading and disables the controls while an upload is in flight', () => {
        const { container } = setup({ photoURL: PHOTO_URL, uploading: true });
        expect(screen.getByRole('status')).toHaveTextContent('Uploading profile photo…');
        expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
        expect(container.querySelector('input[type="file"]')).toBeDisabled();
    });

    it('returns focus to the trigger after an upload settles', () => {
        const onFileSelect = vi.fn();
        const { rerender } = render(
            <ProfileAvatarField photoURL={PHOTO_URL} initials="AB" uploading={false} onFileSelect={onFileSelect} />,
        );
        rerender(
            <ProfileAvatarField photoURL={PHOTO_URL} initials="AB" uploading onFileSelect={onFileSelect} />,
        );
        rerender(
            <ProfileAvatarField photoURL={PHOTO_URL} initials="AB" uploading={false} onFileSelect={onFileSelect} />,
        );
        expect(screen.getByRole('button', { name: 'Change photo' })).toHaveFocus();
    });

    it('has no accessibility violations with a photo and with the fallback', async () => {
        const withPhoto = setup({ photoURL: PHOTO_URL });
        expect((await axe(withPhoto.container)).violations).toEqual([]);
        withPhoto.unmount();

        const fallback = setup({ photoURL: '', initials: 'AB' });
        expect((await axe(fallback.container)).violations).toEqual([]);
    });
});
