import React, { useId, useRef, useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { db, auth } from '@lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { LEAD_DEFAULT_STATUS } from '@shared/constants/atsStatus';
import { Button, FormField, IconButton, Input } from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Modal for quickly adding a new lead with basic information.
 * Used by recruiters to manually add leads they've contacted.
 *
 * Launched from the company dashboard. This is a *different* surface from
 * `QuickAddLeadPage` (the full-page form migrated 2026-07-27): it has its own
 * four-field set, its own phone-or-email rule and its own payload, and it was
 * explicitly left out of that campaign's scope. Migrated 2026-07-28.
 *
 * Presentation only. Frozen and unchanged: the
 * `companies/{companyId}/leads` collection path; the exact payload — tenant
 * `companyId`, trimmed `firstName`/`lastName`, `phone`/`email` trimmed or
 * `null`, `LEAD_DEFAULT_STATUS`, `source: 'Manual Entry'`, `serverTimestamp()`
 * `createdAt`, and the `createdBy`/`createdByName` fallbacks to `'unknown'` /
 * `'Unknown'`; the name-required and phone-or-email rules; all four toast
 * strings; the `onSuccess?.()`-then-`onClose()` ordering; and every placeholder.
 *
 * Defects fixed:
 *  1. **The overlay was a hand-built `fixed inset-0` div** with no
 *     `role="dialog"`, no `aria-modal`, no focus move on open, no focus trap, no
 *     Escape handling and no focus restoration — a keyboard user could Tab
 *     straight out into the page behind it. It now uses the shared accessible
 *     `Modal`.
 *  2. **None of the four inputs had an accessible name.** Every `<label>` was a
 *     bare element with no `htmlFor` and no input carried an `id`, so a screen
 *     reader announced four unnamed edit boxes. `FormField` owns the association.
 *  3. **The close control had no accessible name** — an icon-only `<button>`
 *     containing only an `<X>` svg.
 *  4. **Both application-level validation messages could not both be reached.**
 *     First/last name carried the native `required` attribute, so the browser
 *     blocked submission with its own bubble and the frozen "Please provide first
 *     and last name" toast was dead code in any real browser. The form is now
 *     `noValidate` so the app owns validation — the same rules, the same two
 *     messages, plus `aria-invalid` with an associated error on the offending
 *     fields and focus moved to the first one. This matches the fix already
 *     applied to `QuickAddLeadPage`.
 *  5. **Duplicate submission was possible** — `saving` is React state, so two
 *     activations dispatched inside one render both passed it. A ref guard closes
 *     that window.
 *  6. **`text-xs text-gray-400` on white = 2.56:1** on the "at least phone or
 *     email" hint, plus a gradient green header, `shadow-green-100`, `rounded-2xl`
 *     and `focus:ring-green-500` — all replaced by `--ds-*` tokens.
 *
 * One deliberate one-character copy change: the contact hint was
 * `"* At least phone or email is required"`. The leading `*` existed because the
 * old labels spelled their own required marker (`"First Name *"`). `FormField`
 * now renders the marker itself, so a stray bare asterisk in the middle of the
 * form would point at nothing. The hint is now
 * `"At least phone or email is required"` and is wired as the accessible
 * description of both contact fields, which it never was before.
 *
 * Documented feature-owned decision: the three decorative icons that were
 * absolutely positioned inside the inputs are dropped. The design system has no
 * approved input-adornment contract, and re-creating the absolute positioning
 * locally would be exactly the kind of independent visual decision this migration
 * removes. The labels carry the meaning.
 */
export function QuickLeadModal({ companyId, onClose, onSuccess }) {
    const { showSuccess, showError } = useToast();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});

    const titleId = useId();
    const descriptionId = useId();
    const contactHintId = useId();
    const formRef = useRef(null);
    /**
     * Ref, not state: `saving` only takes effect on the next render, so two
     * activations dispatched before React re-renders would both get past it.
     */
    const submittingRef = useRef(false);

    const focusField = (name) => {
        formRef.current?.querySelector(`[name="${name}"]`)?.focus();
    };

    const handleSave = async (e) => {
        e.preventDefault();

        if (submittingRef.current) return;

        if (!firstName.trim() || !lastName.trim()) {
            setFieldErrors({
                firstName: !firstName.trim() ? 'First Name is required.' : undefined,
                lastName: !lastName.trim() ? 'Last Name is required.' : undefined,
            });
            showError("Please provide first and last name");
            focusField(!firstName.trim() ? 'firstName' : 'lastName');
            return;
        }

        if (!phone.trim() && !email.trim()) {
            setFieldErrors({ phone: 'Provide a phone number or an email address.' });
            showError("Please provide at least a phone number or email");
            focusField('phone');
            return;
        }

        setFieldErrors({});
        submittingRef.current = true;
        setSaving(true);
        try {
            const leadsRef = collection(db, 'companies', companyId, 'leads');
            await addDoc(leadsRef, {
                // Tenant binding required by firestore.rules (tenantCompanyIdMatches).
                companyId: companyId,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                phone: phone.trim() || null,
                email: email.trim() || null,
                status: LEAD_DEFAULT_STATUS,
                source: 'Manual Entry',
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser?.uid || 'unknown',
                createdByName: auth.currentUser?.displayName || 'Unknown'
            });

            showSuccess("Lead added successfully!");
            onSuccess?.();
            onClose();
        } catch (error) {
            console.error("Error adding lead:", error);
            showError("Failed to add lead: " + error.message);
        } finally {
            submittingRef.current = false;
            setSaving(false);
        }
    };

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            overlayClassName="fixed inset-0 z-[100] flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
            className="w-full max-w-md overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            {/* Header */}
            <div className="flex items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-4">
                <div className="flex min-w-0 items-center gap-ds-3">
                    <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ds-lg bg-ds-status-success-bg text-ds-status-success-fg"
                    >
                        <UserPlus size={20} />
                    </span>
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">
                            Quick Add Lead
                        </h2>
                        <p id={descriptionId} className="text-ds-xs text-ds-content-secondary">
                            Add a new lead to your pipeline
                        </p>
                    </div>
                </div>
                <IconButton label="Close quick add lead" variant="ghost" size="sm" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            {/* Form */}
            <form ref={formRef} onSubmit={handleSave} noValidate className="p-ds-6">
                <Stack gap="md">
                    <ResponsiveGrid minItemWidth="150px">
                        <FormField label="First Name" required error={fieldErrors.firstName}>
                            <Input
                                name="firstName"
                                type="text"
                                value={firstName}
                                onChange={e => {
                                    setFirstName(e.target.value);
                                    setFieldErrors(prev => (prev.firstName ? { ...prev, firstName: undefined } : prev));
                                }}
                                placeholder="John"
                                autoComplete="given-name"
                            />
                        </FormField>
                        <FormField label="Last Name" required error={fieldErrors.lastName}>
                            <Input
                                name="lastName"
                                type="text"
                                value={lastName}
                                onChange={e => {
                                    setLastName(e.target.value);
                                    setFieldErrors(prev => (prev.lastName ? { ...prev, lastName: undefined } : prev));
                                }}
                                placeholder="Doe"
                                autoComplete="family-name"
                            />
                        </FormField>
                    </ResponsiveGrid>

                    <FormField label="Phone Number" error={fieldErrors.phone}>
                        <Input
                            name="phone"
                            type="tel"
                            value={phone}
                            onChange={e => {
                                setPhone(e.target.value);
                                setFieldErrors(prev => (prev.phone ? { ...prev, phone: undefined } : prev));
                            }}
                            placeholder="(555) 123-4567"
                            autoComplete="tel"
                            aria-describedby={contactHintId}
                        />
                    </FormField>

                    <FormField label="Email Address">
                        <Input
                            name="email"
                            type="email"
                            value={email}
                            onChange={e => {
                                setEmail(e.target.value);
                                setFieldErrors(prev => (prev.phone ? { ...prev, phone: undefined } : prev));
                            }}
                            placeholder="john.doe@email.com"
                            autoComplete="email"
                            aria-describedby={contactHintId}
                        />
                    </FormField>

                    <p id={contactHintId} className="text-center text-ds-xs text-ds-content-secondary">
                        At least phone or email is required
                    </p>

                    {/* Actions */}
                    <div className="flex gap-ds-3 pt-ds-2">
                        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            tone="success"
                            className="flex-1"
                            disabled={saving}
                            loading={saving}
                        >
                            {!saving && <UserPlus size={18} aria-hidden="true" />}
                            {saving ? 'Adding...' : 'Add Lead'}
                        </Button>
                    </div>
                </Stack>
            </form>
        </Modal>
    );
}
