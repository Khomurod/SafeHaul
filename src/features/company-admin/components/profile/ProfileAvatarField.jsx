import React, { useEffect, useId, useRef } from 'react';
import { Camera } from 'lucide-react';
import { Button, FieldMessage } from '@/design-system/components';

/**
 * Account profile photo preview + upload affordance.
 *
 * Presentation only. Validation, the `avatars/{uid}/{file.name}` Storage upload,
 * the Auth `updateProfile({ photoURL })` write, and the Firestore
 * `users/{uid}.photoURL` write all stay in the feature parent: the native file
 * input's change event is forwarded verbatim through `onFileSelect`. This
 * component adds no SafeHaul, Firebase, Auth, or Storage knowledge.
 *
 * Accessibility: the design system has no approved file-input primitive yet, so
 * this is a documented feature-level composition. A visually hidden but labelled
 * native input is triggered by the approved keyboard-accessible Button (no nested
 * interactive elements — the previous surface stacked a clickable wrapper, a
 * hover overlay, and a nested corner button). A `role="status"` region announces
 * uploading, and focus returns to the trigger once an in-flight upload settles.
 */
export function ProfileAvatarField({
    photoURL,
    initials,
    uploading = false,
    onFileSelect,
}) {
    const inputRef = useRef(null);
    const buttonRef = useRef(null);
    const wasUploadingRef = useRef(false);

    const rawId = useId().replace(/:/g, '');
    const inputId = `profile-avatar-input-${rawId}`;
    const helpId = `profile-avatar-help-${rawId}`;
    const statusId = `profile-avatar-status-${rawId}`;

    // Return focus to the upload trigger once an in-flight upload settles, so
    // keyboard users are not dropped after the button briefly disables.
    useEffect(() => {
        if (wasUploadingRef.current && !uploading) {
            buttonRef.current?.focus();
        }
        wasUploadingRef.current = uploading;
    }, [uploading]);

    return (
        <div className="flex flex-wrap items-center gap-ds-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-ds-border bg-ds-surface-subtle">
                {photoURL ? (
                    <img
                        src={photoURL}
                        alt="Profile photo"
                        loading="lazy"
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <span
                        role="img"
                        aria-label="No profile photo set"
                        className="flex h-full w-full items-center justify-center bg-ds-action-primary text-ds-content-inverse text-ds-heading-sm font-bold"
                    >
                        {initials}
                    </span>
                )}
            </div>

            <div className="flex flex-col items-start gap-ds-2">
                <input
                    ref={inputRef}
                    id={inputId}
                    type="file"
                    accept="image/*"
                    className="ds-visually-hidden"
                    tabIndex={-1}
                    aria-label="Upload profile photo"
                    aria-describedby={helpId}
                    onChange={onFileSelect}
                    disabled={uploading}
                />
                <Button
                    ref={buttonRef}
                    type="button"
                    variant="secondary"
                    size="md"
                    loading={uploading}
                    aria-describedby={helpId}
                    onClick={() => inputRef.current?.click()}
                >
                    {!uploading && <Camera size={16} aria-hidden="true" />}
                    {uploading
                        ? 'Uploading…'
                        : photoURL
                            ? 'Change photo'
                            : 'Upload photo'}
                </Button>
                <FieldMessage id={helpId} tone="help">
                    Accepts image files under 2 MB.
                </FieldMessage>
                <p id={statusId} role="status" className="ds-visually-hidden">
                    {uploading ? 'Uploading profile photo…' : ''}
                </p>
            </div>
        </div>
    );
}

export default ProfileAvatarField;
