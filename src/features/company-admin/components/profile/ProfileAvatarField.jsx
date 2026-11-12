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
 * The picker is the design system's `FileInput`, so the accessible name is on
 * the field rather than on a trigger — never a hidden input driven by a `Button`
 * calling `.click()` on it.
 *
 * "Profile photo" shows above the preview and the picker, as every field's
 * label does, and names the group they form. The picker's own label stays
 * hidden and stays its accessible name, so the input is still announced as
 * "Profile photo" and there is still exactly one `<label>`: the control.
 *
 * `loading` belongs to `FileInput`, which is the right place for it: an upload
 * picker is exactly the control that has to say it is busy AND refuse a second
 * file while the first is in flight. The `role="status"` region lives there too
 * and is not written here: one region, in the primitive whose prop `loading` is,
 * announcing "Uploading Profile photo…" for every picker in the product.
 * `aria-busy` and the label text are not announced, so they cannot stand in for
 * it. `FileInput` owns the focus consequence of
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
    const groupLabelId = `profile-avatar-label-${rawId}`;

    return (
        <div role="group" aria-labelledby={groupLabelId} className="grid min-w-0 gap-ds-2">
            <span id={groupLabelId} className="text-ds-sm font-semibold text-ds-content">
                Profile photo
            </span>
            <div className="flex min-w-0 items-start gap-ds-4">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-ds-full border border-ds-border bg-ds-surface-subtle">
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
                            className="flex h-full w-full items-center justify-center bg-ds-brand-primary text-ds-heading-lg font-bold text-ds-content-inverse"
                        >
                            {initials}
                        </span>
                    )}
                </div>

                <div className="flex min-w-0 flex-col items-start gap-ds-2">
                    <FileInput
                        id={inputId}
                        label="Profile photo"
                        labelHidden
                        accept="image/*"
                        size="sm"
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
        </div>
    );
}

export default ProfileAvatarField;
