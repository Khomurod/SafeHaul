import React, { useId } from 'react';
import { FieldMessage, FileInput } from '@/design-system/components';

/**
 * Account profile photo preview + upload affordance.
 *
 * Presentation only. Validation, the `avatars/{uid}/{file.name}` Storage upload,
 * the Auth `updateProfile({ photoURL })` write, and the Firestore
 * `users/{uid}.photoURL` write all stay in the feature parent: the native file
 * input's change event is forwarded verbatim through `onFileSelect`. This
 * component adds no SafeHaul, Firebase, Auth, or Storage knowledge.
 *
 * The picker is the design system's `FileInput` (2026-08-25). It was a hidden
 * input driven by a `Button` calling `.click()` on it, under a comment saying
 * "the design system has no approved file-input primitive yet" — untrue from
 * 2026-08-21. That shape works with a keyboard but puts the accessible name on
 * the trigger rather than the field, and it was one of three different ways this
 * product opened a picker.
 *
 * `FileInput` needed `loading` to take it, which is the right place for it: an
 * upload picker is exactly the control that has to say it is busy AND refuse a
 * second file while the first is in flight. The `role="status"` region this
 * component used to own moved there with it and is no longer written here: one
 * region, in the primitive whose prop `loading` is, announcing "Uploading
 * Profile photo…" for every picker in the product rather than for the two that
 * remembered to. It briefly went missing in between — this docblock claimed
 * `aria-busy` and the label text carried the state, and neither is announced —
 * which a review on 2026-08-26 caught. `FileInput` owns the focus consequence of
 * `loading` too, and restores focus only when the picker is what focus was on as
 * the file arrived — so a keyboard upload gets it back and a dragged-and-dropped
 * one does not have focus moved for it.
 */
export function ProfileAvatarField({
    photoURL,
    initials,
    uploading = false,
    onFileSelect,
}) {
    const rawId = useId().replace(/:/g, '');
    const inputId = `profile-avatar-input-${rawId}`;
    const helpId = `profile-avatar-help-${rawId}`;

    return (
        <div className="flex flex-wrap items-center gap-ds-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-ds-full border border-ds-border bg-ds-surface-subtle">
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
                {/* The preview beside it already says what this field is, so the
                    label is hidden — but it stays the input's accessible name. */}
                <FileInput
                    id={inputId}
                    label="Profile photo"
                    labelHidden
                    accept="image/*"
                    loading={uploading}
                    aria-describedby={helpId}
                    onChange={onFileSelect}
                    buttonLabel={uploading
                        ? 'Uploading…'
                        : photoURL
                            ? 'Change photo'
                            : 'Upload photo'}
                />
                <FieldMessage id={helpId} tone="help">
                    Accepts image files under 2 MB.
                </FieldMessage>
            </div>
        </div>
    );
}

export default ProfileAvatarField;
