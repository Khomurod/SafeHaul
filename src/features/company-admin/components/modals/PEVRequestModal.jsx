import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react';
import {
    X,
    Mail,
    Printer,
    Send,
    ShieldCheck,
    Info,
    FileText,
} from 'lucide-react';
import {
    mapFmcsaRowToPevContact,
    normalizeEmployerStateToFmcsaPhyState,
} from '@shared/services/fmcsaEmployerSocrata';
import { useFmcsaEmployerLookup } from './pev/useFmcsaEmployerLookup';
import { FmcsaCarrierPicker, buildFmcsaRowKey } from './pev/FmcsaCarrierPicker';
import { Modal } from '@shared/components/modals/Modal';
import {
    Button,
    ChoiceGroup,
    FormField,
    IconButton,
    Input,
    Radio,
} from '@/design-system/components';

/**
 * PEV request dialog: choose how the verification reaches the employer, confirm
 * the recipient, and continue to the VOE preview.
 *
 * Presentation migrated to the shared accessible `Modal`, the approved
 * `ChoiceGroup`/`Radio`, `FormField`/`Input`, `Button` and `IconButton`
 * primitives, and `--ds-*` tokens (2026-07-27).
 *
 * Frozen contracts: the `'email' | 'fax' | 'manual'` delivery-method values and
 * `'email'` initial selection; the `onProceed(deliveryMethod, contactInfo)`
 * argument pair and the `{ email, fax, phone }` contact shape; the
 * `companyEmail → email` seeding precedence; the FMCSA lookup being skipped
 * without a Socrata token or below two characters; `mapFmcsaRowToPevContact`
 * merge semantics (a census value only fills an *empty* field); the exact
 * missing-email and missing-fax validation messages and the fact that they focus
 * and scroll to the offending input rather than alerting; and both footer
 * labels, including `'Preview & Print'` for manual delivery.
 *
 * DEFECTS FIXED (2026-07-27):
 * - **The delivery-method choice was three plain `<button>`s with a hand-drawn
 *   radio dot and no `aria-checked`, `aria-pressed` or grouping.** Assistive
 *   technology was told nothing about which method was selected, or even that
 *   the three belonged together. They are now native radios inside a real
 *   `<fieldset>`/`<legend>`, so the browser owns arrow-key selection and the
 *   group is announced once.
 * - **The dialog was hand-rolled** — a fixed overlay with no `role="dialog"`, no
 *   `aria-modal`, no focus containment, no focus restoration and no Escape,
 *   opened on top of the driver dossier, which *is* a dialog.
 * - **The close control had no accessible name.**
 * - **10 px and 11 px interface text** in the "Missing Info" pill and the legal
 *   note, below the 12 px floor.
 */

function employerDisplayName(employer) {
    return String(employer?.companyName || employer?.name || '').trim();
}

export function PEVRequestModal({ employer, applicant: _applicant, onClose, onProceed }) {
    const socrataToken = import.meta.env.VITE_SOCRATA_APP_TOKEN;
    const rawId = useId().replace(/:/g, '');
    const titleId = `pev-request-title-${rawId}`;
    const closeRef = useRef(null);

    const [contactInfo, setContactInfo] = useState({
        email: employer.companyEmail || employer.email || '',
        fax: employer.fax || '',
        phone: employer.phone || '',
    });

    const [deliveryMethod, setDeliveryMethod] = useState('email');

    const [selectedFmcsaKey, setSelectedFmcsaKey] = useState(null);
    /** After selecting a census row: whether FMCSA returned any email/fax/phone on that row */
    const [lastFmcsaRowHadContact, setLastFmcsaRowHadContact] = useState(null);

    const [proceedError, setProceedError] = useState({ field: null, message: '' });

    const emailInputRef = useRef(null);
    const faxInputRef = useRef(null);
    const emailSectionRef = useRef(null);
    const faxSectionRef = useRef(null);

    const companyLabel = employerDisplayName(employer);
    const employerStateRaw = employer?.state ?? '';
    const fmcsaStateCode = useMemo(
        () => normalizeEmployerStateToFmcsaPhyState(employerStateRaw),
        [employerStateRaw],
    );

    // Reset selection when the employer (and thus the search term) changes.
    useEffect(() => {
        setSelectedFmcsaKey(null);
        setLastFmcsaRowHadContact(null);
        setProceedError({ field: null, message: '' });
    }, [companyLabel, employerStateRaw]);

    // On a fresh FMCSA result, clear any prior selection (matches previous behaviour).
    const handleRowsLoaded = useCallback(() => {
        setSelectedFmcsaKey(null);
        setLastFmcsaRowHadContact(null);
    }, []);

    const { fmcsaLoading, fmcsaError, fmcsaRows } = useFmcsaEmployerLookup({
        companyLabel,
        employerStateRaw,
        socrataToken,
        onRowsLoaded: handleRowsLoaded,
    });

    const applyFmcsaRow = useCallback((row, rowIndex) => {
        const m = mapFmcsaRowToPevContact(row);
        const key = buildFmcsaRowKey(row, rowIndex);
        const censusHadContact = !!(m.email || m.fax || m.phone);

        setSelectedFmcsaKey(key);
        setLastFmcsaRowHadContact(censusHadContact);
        setProceedError({ field: null, message: '' });

        setContactInfo((prev) => ({
            ...prev,
            email: m.email || prev.email,
            fax: m.fax || prev.fax,
            phone: m.phone || prev.phone,
        }));
    }, []);

    const methods = useMemo(() => {
        const hasEmail = !!(String(contactInfo.email || '').trim() || employer.companyEmail || employer.email);
        const hasFax = !!(String(contactInfo.fax || '').trim() || employer.fax);
        return [
            {
                id: 'email',
                label: 'E-mail with Portal Link',
                icon: Mail,
                description: 'Send a secure online verification form to the employer. They can respond in 2-3 minutes.',
                active: hasEmail,
            },
            {
                id: 'fax',
                label: 'Fax Transmission',
                icon: Printer,
                description: 'Electronic fax delivery + generate portal link to share manually.',
                active: hasFax,
            },
            {
                id: 'manual',
                label: 'Download / Print',
                icon: FileText,
                description: 'Download PDF + generate a sharable portal link to email or hand over.',
                active: true,
            },
        ];
    }, [contactInfo.email, contactInfo.fax, employer]);

    const handleDeliveryMethodChange = (id) => {
        setDeliveryMethod(id);
        setProceedError({ field: null, message: '' });
    };

    const handleContinue = () => {
        setProceedError({ field: null, message: '' });

        if (deliveryMethod === 'email' && !String(contactInfo.email || '').trim()) {
            setProceedError({
                field: 'email',
                message: 'Enter the employer\'s email address to send the portal link, or switch to Download / Print.',
            });
            requestAnimationFrame(() => {
                emailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                emailInputRef.current?.focus();
            });
            return;
        }

        if (deliveryMethod === 'fax' && !String(contactInfo.fax || '').trim()) {
            setProceedError({
                field: 'fax',
                message: 'Enter the fax number, or switch to Download / Print.',
            });
            requestAnimationFrame(() => {
                faxSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                faxInputRef.current?.focus();
            });
            return;
        }

        onProceed(deliveryMethod, contactInfo);
    };

    return (
        <Modal
            labelledBy={titleId}
            onClose={onClose}
            initialFocusRef={closeRef}
            overlayClassName="fixed inset-0 z-[80] flex items-stretch justify-center bg-ds-overlay p-0 backdrop-blur-sm sm:items-center sm:p-ds-4"
            className="flex h-full w-full flex-col overflow-hidden bg-ds-surface shadow-ds-lg sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-ds-xl"
        >
            {/*
              Header.

              DOCUMENTED EXCEPTION AVOIDED: this used to be a `bg-slate-900`
              inverse panel. The token contract has `--ds-color-content-inverse`
              but **no inverse surface**, so an inverse header cannot be
              expressed in approved tokens and inventing one is not a feature's
              call (gap recorded in the roadmap). It follows the dossier
              document-preview precedent instead: the toolbar sits on the panel's
              own surface, which also keeps the ghost `IconButton` legible —
              its variant owns its colour and a feature-side `text-*` utility
              cannot override it.
            */}
            <div className="flex shrink-0 items-start justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-6">
                <div className="min-w-0">
                    <div className="mb-ds-2 flex items-center gap-ds-3">
                        <span aria-hidden="true" className="shrink-0 rounded-ds-md bg-ds-status-info-bg p-ds-2 text-ds-status-info-fg">
                            <ShieldCheck size={24} />
                        </span>
                        {/* `<h4>` under the dossier header's `<h3>` section title. */}
                        <h4 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Initiate Verification</h4>
                    </div>
                    <p className="text-ds-sm text-ds-content-secondary">
                        Verify employment for{' '}
                        <span className="font-semibold text-ds-content [overflow-wrap:anywhere]">
                            {companyLabel || 'Employer'}
                        </span>
                    </p>
                </div>
                <IconButton
                    ref={closeRef}
                    variant="ghost"
                    label="Close verification request"
                    onClick={onClose}
                >
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 space-y-ds-6 overflow-y-auto p-ds-6">
                {/* FMCSA suggestions */}
                {socrataToken && companyLabel.length >= 2 && (
                    <FmcsaCarrierPicker
                        fmcsaStateCode={fmcsaStateCode}
                        fmcsaLoading={fmcsaLoading}
                        fmcsaError={fmcsaError}
                        fmcsaRows={fmcsaRows}
                        selectedFmcsaKey={selectedFmcsaKey}
                        lastFmcsaRowHadContact={lastFmcsaRowHadContact}
                        onSelectRow={applyFmcsaRow}
                    />
                )}

                {/*
                  Native radios in a real fieldset. The browser owns the roving
                  focus model and announces the legend once; the previous
                  three-button group communicated its selection by background
                  colour alone. "Missing Info" now lives in the option's own
                  description so it is announced with the option instead of
                  sitting in a 10 px pill.
                */}
                <ChoiceGroup legend="Select Delivery Method">
                    {methods.map((m) => (
                        <Radio
                            key={m.id}
                            name={`pev-delivery-method-${rawId}`}
                            id={`pev-delivery-${m.id}-${rawId}`}
                            value={m.id}
                            label={m.label}
                            description={m.active ? m.description : `Missing Info — ${m.description}`}
                            checked={deliveryMethod === m.id}
                            onChange={() => handleDeliveryMethodChange(m.id)}
                        />
                    ))}
                </ChoiceGroup>

                {/* Conditional Input */}
                {deliveryMethod === 'email' && (
                    <div
                        ref={emailSectionRef}
                        className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4"
                    >
                        <FormField
                            id="pev-recipient-email"
                            label="Recipient Email Address"
                            error={proceedError.field === 'email' ? proceedError.message : undefined}
                        >
                            <Input
                                ref={emailInputRef}
                                type="email"
                                value={contactInfo.email}
                                onChange={(e) => {
                                    setContactInfo({ ...contactInfo, email: e.target.value });
                                    if (proceedError.field === 'email') setProceedError({ field: null, message: '' });
                                }}
                                placeholder="hr@company.com"
                                autoComplete="off"
                            />
                        </FormField>
                    </div>
                )}

                {deliveryMethod === 'fax' && (
                    <div
                        ref={faxSectionRef}
                        className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4"
                    >
                        <FormField
                            id="pev-recipient-fax"
                            label="Recipient Fax Number"
                            error={proceedError.field === 'fax' ? proceedError.message : undefined}
                        >
                            <Input
                                ref={faxInputRef}
                                type="tel"
                                value={contactInfo.fax}
                                onChange={(e) => {
                                    setContactInfo({ ...contactInfo, fax: e.target.value });
                                    if (proceedError.field === 'fax') setProceedError({ field: null, message: '' });
                                }}
                                placeholder="(555) 000-0000"
                                autoComplete="off"
                            />
                        </FormField>
                    </div>
                )}

                {/* Legal Note */}
                <div className="flex gap-ds-3 rounded-ds-md border border-ds-status-warning-border bg-ds-status-warning-bg p-ds-3">
                    <Info size={18} className="shrink-0 text-ds-status-warning-fg" aria-hidden="true" />
                    <p className="text-ds-xs font-medium leading-relaxed text-ds-status-warning-fg">
                        Verifications are performed in compliance with FMCSA 49 CFR Part 391.23. The driver&apos;s signed authorization is attached to the request automatically.
                    </p>
                </div>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-col gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-6 sm:flex-row">
                <Button variant="secondary" size="lg" fullWidth onClick={onClose}>
                    Cancel
                </Button>
                <Button variant="primary" size="lg" fullWidth onClick={handleContinue}>
                    <Send size={18} aria-hidden="true" />
                    {deliveryMethod === 'manual' ? 'Preview & Print' : 'Continue to Preview'}
                </Button>
            </div>
        </Modal>
    );
}

export default PEVRequestModal;
