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

    /*
     * The picker is the design system's `FileInput` since 2026-08-25. It was a
     * hidden input driven by a `Button` calling `.click()` on it — which works
     * with a keyboard, but names the trigger rather than the field and was one of
     * three ways this product opened a picker.
     *
     * So the assertions move with it: the input is named by its FIELD (as every
     * other control in the system is), and the visible affordance is the
     * `<label>` that wraps it rather than a separate button. That is the
     * structural rule the primitive exists to enforce — a real focusable input
     * behind a real label, which also makes the label the browser's own
     * drag-and-drop target.
     */
    it('exposes a labelled image-only file input described by the help text', () => {
        const { container } = setup({ photoURL: PHOTO_URL });
        const input = container.querySelector('input[type="file"]');
        expect(input).toHaveAccessibleName('Profile photo');
        expect(input).toHaveAttribute('accept', 'image/*');

        const describedBy = input.getAttribute('aria-describedby');
        expect(describedBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '))
            .toMatch(/Accepts image files under 2 MB/i);
    });

    it('labels the trigger Change photo when a photo exists and Upload photo when none', () => {
        const { container, rerender } = setup({ photoURL: PHOTO_URL });
        expect(container.querySelector('.ds-file-input__button-label')).toHaveTextContent('Change photo');
        rerender(
            <ProfileAvatarField photoURL="" initials="AB" uploading={false} onFileSelect={vi.fn()} />,
        );
        expect(container.querySelector('.ds-file-input__button-label')).toHaveTextContent('Upload photo');
    });

    it('reaches the picker through a real label, with no nested interactive elements', () => {
        const { container } = setup({ photoURL: PHOTO_URL });
        const input = container.querySelector('input[type="file"]');

        // The visible control IS the label for this input — not a button that
        // clicks it, which is the shape that leaves the name on the wrong element.
        const label = input.closest('label');
        expect(label).not.toBeNull();
        expect(label).toHaveAttribute('for', input.id);
        expect(container.querySelectorAll('button')).toHaveLength(0);
        expect(input.closest('button')).toBeNull();

        // Still focusable: `display: none` would take the keyboard path with it.
        input.focus();
        expect(document.activeElement).toBe(input);
    });

    it('forwards the native change event verbatim on file selection', () => {
        const { container, onFileSelect } = setup({ photoURL: PHOTO_URL });
        const file = new File(['x'], 'avatar.png', { type: 'image/png' });
        const input = container.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [file] } });

        expect(onFileSelect).toHaveBeenCalledTimes(1);
        expect(onFileSelect.mock.calls[0][0].target.files[0]).toBe(file);
    });

    /*
     * The upload is disabled, busy, AND announced.
     *
     * This test used to assert that `aria-busy` and the button text had replaced
     * the `role="status"` region this component owned before the `FileInput`
     * migration. That was the wrong assertion to write: neither of those is
     * announced — `aria-busy` sits on an input the upload has just disabled and
     * taken focus from, and the button text is ordinary content. Rewriting the
     * test to match the new markup is what let a real regression through, and a
     * review on 2026-08-26 caught it. The region lives in `FileInput` now, so it
     * is asserted here as behaviour this screen still has rather than as markup
     * this file owns.
     */
    it('says it is busy, announces the upload, and refuses a second file', () => {
        const { container } = setup({ photoURL: PHOTO_URL, uploading: true });
        const input = container.querySelector('input[type="file"]');
        expect(container.querySelector('.ds-file-input__button-label')).toHaveTextContent('Uploading…');
        expect(input).toBeDisabled();
        expect(input).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('status')).toHaveTextContent('Uploading Profile photo…');
    });

    it('says nothing in the status region while no upload is running', () => {
        const { container } = setup({ photoURL: PHOTO_URL });
        // Present but empty: the region has to exist before it fills for the fill
        // to be announced.
        expect(container.querySelector('[role="status"]')).toBeEmptyDOMElement();
    });

    it('keeps the same control element mounted across an upload', () => {
        const onFileSelect = vi.fn();
        const { container, rerender } = render(
            <ProfileAvatarField photoURL={PHOTO_URL} initials="AB" uploading={false} onFileSelect={onFileSelect} />,
        );
        const before = container.querySelector('input[type="file"]');
        rerender(
            <ProfileAvatarField photoURL={PHOTO_URL} initials="AB" uploading onFileSelect={onFileSelect} />,
        );
        rerender(
            <ProfileAvatarField photoURL={PHOTO_URL} initials="AB" uploading={false} onFileSelect={onFileSelect} />,
        );
        // Same element throughout: the picker is not swapped for a disabled
        // button any more, so an upload does not tear the control down. Whether
        // focus comes back when `loading` disables it is `FileInput`'s contract,
        // asserted in its own suite.
        expect(container.querySelector('input[type="file"]')).toBe(before);
        expect(before).not.toBeDisabled();
    });

    it('has no accessibility violations with a photo and with the fallback', async () => {
        const withPhoto = setup({ photoURL: PHOTO_URL });
        expect((await axe(withPhoto.container)).violations).toEqual([]);
        withPhoto.unmount();

        const fallback = setup({ photoURL: '', initials: 'AB' });
        expect((await axe(fallback.container)).violations).toEqual([]);
    });
});
