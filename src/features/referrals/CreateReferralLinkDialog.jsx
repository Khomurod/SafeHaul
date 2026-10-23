import React, { useId, useRef, useState } from 'react';
import { Icon, X } from '@design-system/icons';
import { Modal } from '@design-system/patterns';
import { Button, FormField, IconButton, Input, Notice } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { REFERRER_NAME_MAX } from './referralLinksService';

/** A new referral link: the referring driver's name, and their phone if known. */
export function CreateReferralLinkDialog({ onCreate, onClose }) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `referral-link-title-${rawId}`;
    const descriptionId = `referral-link-description-${rawId}`;
    const nameRef = useRef(null);
    const [referrerName, setReferrerName] = useState('');
    const [referrerPhone, setReferrerPhone] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (event) => {
        event.preventDefault();
        if (saving) return;
        if (!referrerName.trim()) {
            setError('Enter the referring driver’s name.');
            nameRef.current?.focus();
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onCreate({ referrerName, referrerPhone });
            onClose();
        } catch (failure) {
            console.error('[CreateReferralLinkDialog] create failed:', failure?.code || failure?.message);
            setError('We could not create the link. Try again.');
            setSaving(false);
        }
    };

    return (
        <Modal onClose={onClose} labelledBy={titleId} describedBy={descriptionId} initialFocusRef={nameRef} size="md" scroll="body">
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Create a referral link</h2>
                    <p id={descriptionId} className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                        For a driver who sends others to apply. Whoever comes through the link is assigned to you.
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" onClick={onClose} disabled={saving}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>
            <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                    <Stack gap="md">
                        <FormField label="Referring driver’s name" required>
                            <Input
                                ref={nameRef}
                                value={referrerName}
                                maxLength={REFERRER_NAME_MAX}
                                autoComplete="off"
                                onChange={(event) => setReferrerName(event.target.value)}
                            />
                        </FormField>
                        <FormField label="Their phone" description="Optional. Only your team sees it.">
                            <Input
                                type="tel"
                                inputMode="tel"
                                value={referrerPhone}
                                maxLength={32}
                                autoComplete="off"
                                onChange={(event) => setReferrerPhone(event.target.value)}
                            />
                        </FormField>
                        <div role="alert">
                            {error && <Notice tone="danger" size="sm">{error}</Notice>}
                        </div>
                    </Stack>
                </div>
                <div className="flex shrink-0 flex-col-reverse justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row">
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" variant="primary" loading={saving} disabled={saving}>Create link</Button>
                </div>
            </form>
        </Modal>
    );
}

export default CreateReferralLinkDialog;
