import React, { useState, useEffect, useMemo, useRef, useCallback, useId } from 'react';
import { Icon, X, Mail, Send, ShieldCheck, Info, FileText } from '@design-system/icons';
import {
    mapFmcsaRowToPevContact,
    normalizeEmployerStateToFmcsaPhyState,
} from '@shared/services/fmcsaEmployerSocrata';
import { useFmcsaEmployerLookup } from './pev/useFmcsaEmployerLookup';
import { FmcsaCarrierPicker, buildFmcsaRowKey } from './pev/FmcsaCarrierPicker';
import { MAX_PEV_COPIES, formatPevCopies, parsePevCopies } from '../../utils/pevCopies';
import { usePevDefaultCopies } from '../../hooks/usePevDefaultCopies';
import { Modal } from '@design-system/patterns';
import {
    Button,
    ChoiceGroup,
    FormField,
    IconButton,
    Input,
    Notice,
    Radio,
} from '@/design-system/components';

/**
 * PEV request dialog: choose how the verification reaches the employer, confirm
 * the recipient, and continue to the VOE preview.
 *
 * Presentation uses the approved accessible `Modal`, the approved
 * `ChoiceGroup`/`Radio`, `FormField`/`Input`, `Button` and `IconButton`
 * primitives, and `--ds-*` tokens.
 *
 * Frozen contracts: the `'email' | 'manual'` delivery-method values and
 * `'email'` initial selection; the `onProceed(deliveryMethod, contactInfo)`
 * argument pair and the `{ email, fax, phone }` contact shape; the
 * `companyEmail → email` seeding precedence; the FMCSA lookup being skipped
 * without a Socrata token or below two characters; `mapFmcsaRowToPevContact`
 * merge semantics (a census value only fills an *empty* field); the exact
 * missing-email validation message and the fact that it focuses and scrolls to
 * the input rather than alerting; and both footer labels, including
 * `'Preview & Print'` for manual delivery.
 *
 * There is no fax delivery. Nothing sends a fax: a request filed as one
 * reached nobody, got no reminder (they go by email) and was still marked
 * "Good Faith Documented" at 30 days. A recruiter who faxes prints the form
 * under Download / Print. The server still accepts `'fax'` from older screens.
 *
 * Rules this dialog keeps:
 * - **The delivery-method choice is native radios inside a real
 *   `<fieldset>`/`<legend>`**, so the browser owns arrow-key selection and the
 *   group is announced once.
 * - **It is the approved `Modal`** — `role="dialog"`, `aria-modal`, focus
 *   containment, focus restoration and Escape — because it opens on top of the
 *   driver dossier, which *is* a dialog.
 * - **The close control has an accessible name.**
 * - **No interface text below the 12 px floor**, the "Missing Info" pill and the
 *   legal note included.
 * - **Copies (CC) go with an emailed request only**, start from the company's
 *   saved list, and are checked here as the server checks them (`pevCopies.js`);
 *   `contactInfo.ccEmails` carries the result.
 */

function employerDisplayName(employer) {
    return String(employer?.companyName || employer?.name || '').trim();
}

export function PEVRequestModal({ employer, applicant: _applicant, companyId, defaultCopies = [], onClose, onProceed }) {
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
    const savedCopies = usePevDefaultCopies(companyId, defaultCopies);
    const [copiesText, setCopiesText] = useState(() => formatPevCopies(defaultCopies));
    const [copiesTouched, setCopiesTouched] = useState(false);
    const copiesInputRef = useRef(null);
    // An untouched field waits for the saved list before an emailed request goes on.
    const copiesPending = deliveryMethod === 'email' && !savedCopies.loaded && !copiesTouched;

    // The saved list, read fresh, replaces the session's copy until the recruiter types.
    useEffect(() => {
        if (savedCopies.loaded && !copiesTouched) setCopiesText(formatPevCopies(savedCopies.copies));
    }, [savedCopies, copiesTouched]);

    const [selectedFmcsaKey, setSelectedFmcsaKey] = useState(null);
    /** After selecting a census row: whether FMCSA returned an email on that row */
    const [lastFmcsaRowHadEmail, setLastFmcsaRowHadEmail] = useState(null);

    const [proceedError, setProceedError] = useState({ field: null, message: '' });

    const emailInputRef = useRef(null);
    const emailSectionRef = useRef(null);

    const companyLabel = employerDisplayName(employer);
    const employerStateRaw = employer?.state ?? '';
    const fmcsaStateCode = useMemo(
        () => normalizeEmployerStateToFmcsaPhyState(employerStateRaw),
        [employerStateRaw],
    );

    // Reset selection when the employer (and thus the search term) changes.
    useEffect(() => {
        setSelectedFmcsaKey(null);
        setLastFmcsaRowHadEmail(null);
        setProceedError({ field: null, message: '' });
    }, [companyLabel, employerStateRaw]);

    // On a fresh FMCSA result, clear any prior selection (matches previous behaviour).
    const handleRowsLoaded = useCallback(() => {
        setSelectedFmcsaKey(null);
        setLastFmcsaRowHadEmail(null);
    }, []);

    const { fmcsaLoading, fmcsaError, fmcsaRows } = useFmcsaEmployerLookup({
        companyLabel,
        employerStateRaw,
        dotNumber: employer?.dotNumber,
        socrataToken,
        onRowsLoaded: handleRowsLoaded,
    });

    const applyFmcsaRow = useCallback((row, rowIndex) => {
        const m = mapFmcsaRowToPevContact(row);
        const key = buildFmcsaRowKey(row, rowIndex);
        setSelectedFmcsaKey(key);
        setLastFmcsaRowHadEmail(!!m.email);
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
        return [
            {
                id: 'email',
                label: 'E-mail with Portal Link',
                icon: Mail,
                description: 'Send a secure online verification form to the employer. They can respond in 2-3 minutes.',
                active: hasEmail,
            },
            {
                id: 'manual',
                label: 'Download / Print',
                icon: FileText,
                description: 'Download PDF + generate a sharable portal link to email, fax or hand over yourself.',
                active: true,
            },
        ];
    }, [contactInfo.email, employer]);

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

        if (deliveryMethod !== 'email') {
            onProceed(deliveryMethod, contactInfo);
            return;
        }
        const copies = parsePevCopies(copiesText, contactInfo.email);
        if (copies.error) {
            setProceedError({ field: 'cc', message: copies.error });
            requestAnimationFrame(() => copiesInputRef.current?.focus());
            return;
        }
        onProceed(deliveryMethod, { ...contactInfo, ccEmails: copies.emails });
    };

    return (
        <Modal
            labelledBy={titleId}
            onClose={onClose}
            initialFocusRef={closeRef}
            size="lg"
            scroll="body"
            mobile="fullscreen"
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
                            <Icon icon={ShieldCheck} size="2xl" />
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
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 space-y-ds-6 overflow-y-auto p-ds-6">
                {/* FMCSA suggestions */}
                {socrataToken && (companyLabel.length >= 2 || /^\d{1,9}$/.test(String(employer?.dotNumber ?? '').trim())) && (
                    <FmcsaCarrierPicker
                        fmcsaStateCode={fmcsaStateCode}
                        fmcsaLoading={fmcsaLoading}
                        fmcsaError={fmcsaError}
                        fmcsaRows={fmcsaRows}
                        selectedFmcsaKey={selectedFmcsaKey}
                        lastFmcsaRowHadEmail={lastFmcsaRowHadEmail}
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
                        <div className="mt-ds-4">
                            <FormField
                                id="pev-copies"
                                label="CC (your team, optional)"
                                description={`Up to ${MAX_PEV_COPIES} addresses, separated by commas. They receive the same email, including the response link.`}
                                error={proceedError.field === 'cc' ? proceedError.message : undefined}
                            >
                                <Input
                                    ref={copiesInputRef}
                                    type="text"
                                    inputMode="email"
                                    value={copiesText}
                                    onChange={(e) => {
                                        setCopiesTouched(true);
                                        setCopiesText(e.target.value);
                                        if (proceedError.field === 'cc') setProceedError({ field: null, message: '' });
                                    }}
                                    placeholder="safety@yourcompany.com"
                                    autoComplete="off"
                                />
                            </FormField>
                        </div>
                    </div>
                )}

                {/* Legal Note */}
                {/* `Info` is passed explicitly: the warning tone's own glyph is
                    `AlertTriangle`, and this is a deliberately calm legal note
                    rather than a warning about anything. Letting the default win
                    would escalate it — the borderline case 6c's audit named. */}
                <Notice tone="warning" size="sm" icon={Info}>
                    Verifications are performed in compliance with FMCSA 49 CFR Part 391.23. The driver&apos;s signed authorization is attached to the request automatically.
                </Notice>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-col gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-6 sm:flex-row">
                <Button variant="secondary" fullWidth onClick={onClose}>
                    Cancel
                </Button>
                <Button variant="primary" fullWidth onClick={handleContinue} loading={copiesPending}>
                    <Icon icon={Send} size="lg" />
                    {deliveryMethod === 'manual' ? 'Preview & Print' : 'Continue to Preview'}
                </Button>
            </div>
        </Modal>
    );
}

export default PEVRequestModal;
