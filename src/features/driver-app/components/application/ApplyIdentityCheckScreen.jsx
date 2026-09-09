import React, { useId, useState } from 'react';
import { Icon, ShieldCheck } from '@design-system/icons';
import { Button, Card, FormField, Input, Notice } from '@/design-system/components';

/**
 * "Confirm it's you" — the screen that was missing, and the whole reported bug.
 *
 * ## What happened without it
 *
 * `exchangeApplicationInvite` answers `requiresIdentity` once the answers behind a
 * link are the driver's own rather than the carrier's. That reply reached
 * `resolveApplyStatusScreen`, matched no branch, and fell through to the intake
 * chooser — so a driver who opened the replacement link their recruiter had just
 * sent was shown **"How would you like to start your driver application?"**, with
 * their own half-finished application sitting behind the link and nothing on
 * screen saying so. Measured in production on 2026-09-09: the exchange returned
 * 200 twice, and the page offered a fresh application both times.
 *
 * The code comment that stood in for this screen said the driver "is asked for
 * their details by the ordinary resume flow underneath". They were not. That flow
 * only triggers on the first Next of page one, so reaching it meant choosing an
 * intake mode, retyping four fields into what looks like a brand-new application,
 * and trusting that something would recognise them — and the lookup it runs
 * queries a field autosave had been erasing.
 *
 * ## Why it asks for these four things
 *
 * The party holding a copy of this link may be the carrier: it minted it, and the
 * exchange is unauthenticated by necessity. So the bar has to be something the
 * carrier cannot get from SafeHaul. It knows the contact details and, for an
 * application it prepared, whatever it typed; it does not know the Social Security
 * Number, and it is never shown a driver-owned draft's date of birth. See
 * `functions/companyApplications/inviteIdentity.js` for what is verified against
 * what — this screen collects, and the server decides.
 *
 * **Email or phone is one field**, deliberately. The draft is keyed by whichever
 * the recruiter typed, and asking the driver to guess which of their own details a
 * stranger used is a question they cannot answer. The server reads the value as an
 * email and as a phone and accepts whichever matches.
 *
 * ## Why it is a page and not a `PageState`
 *
 * `PageState` says so itself: extra content between the description and the
 * actions, "not a second layout — anything that needs its own structure is a page,
 * not a state". Four labelled fields and a validation surface is its own
 * structure. So this follows the shape the product already uses for a public,
 * single-task screen — `ReviewChangePortal`: one centred `Card as="main"`, an
 * inverse masthead, and `lg` on the primary action, which the design-system rules
 * name as exactly the case `lg` is for.
 *
 * ## Starting fresh stays a choice
 *
 * Never a fallback that happens to them — the same rule `ApplyLinkProblemScreen`
 * was built on. A driver whose details genuinely will not match (a link for
 * somebody else, an application they do not remember) has a way forward, and it is
 * a button they press.
 */

/** What the driver must supply. Order matters: it is the order of the fields. */
const FIELDS = Object.freeze([
    {
        name: 'lastName',
        label: 'Last name',
        type: 'text',
        autoComplete: 'family-name',
        missing: 'Enter your last name.',
    },
    {
        name: 'dob',
        label: 'Date of birth',
        type: 'date',
        autoComplete: 'bday',
        missing: 'Enter your date of birth.',
    },
    {
        name: 'ssn',
        label: 'Social Security Number',
        type: 'text',
        // Never remembered by the browser, and never a `date`/`number` control
        // whose spinners and locale parsing would mangle it.
        autoComplete: 'off',
        inputMode: 'numeric',
        placeholder: 'XXX-XX-XXXX',
        description: 'Only used to confirm this application is yours. It is not stored on the unfinished application.',
        missing: 'Enter your Social Security Number.',
        invalid: (value) => (String(value).replace(/\D/g, '').length === 9
            ? null
            : 'That does not look like a nine-digit Social Security Number.'),
    },
    {
        name: 'contact',
        label: 'Email or phone number',
        type: 'text',
        autoComplete: 'email',
        description: 'Whichever one the company has for you.',
        missing: 'Enter the email address or phone number the company has for you.',
    },
]);

const EMPTY = Object.freeze({ lastName: '', dob: '', ssn: '', contact: '' });

/**
 * Local checks only, and deliberately shallow.
 *
 * The server is the authority on whether a claim matches; this exists so a driver
 * who left a field blank is told which one instead of spending an attempt against
 * a rate-limited callable.
 */
export function findClaimGaps(claim) {
    const gaps = {};
    for (const field of FIELDS) {
        const value = String(claim?.[field.name] ?? '').trim();
        if (!value) {
            gaps[field.name] = field.missing;
            continue;
        }
        const invalid = field.invalid?.(value);
        if (invalid) gaps[field.name] = invalid;
    }
    return gaps;
}

export function ApplyIdentityCheckScreen({
    companyName,
    busy = false,
    error = null,
    onConfirm,
    onStartFresh,
}) {
    const headingId = `apply-identity-${useId().replace(/:/g, '')}`;
    const [claim, setClaim] = useState(EMPTY);
    const [gaps, setGaps] = useState({});

    const setField = (name, value) => {
        setClaim((previous) => ({ ...previous, [name]: value }));
        // Clears as they fix it, so a message never outlives the problem.
        setGaps((previous) => (previous[name] ? { ...previous, [name]: undefined } : previous));
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        const found = findClaimGaps(claim);
        setGaps(found);
        if (Object.values(found).some(Boolean)) return;
        onConfirm({
            lastName: claim.lastName.trim(),
            dob: claim.dob.trim(),
            ssn: claim.ssn.trim(),
            contact: claim.contact.trim(),
        });
    };

    return (
        <div className="flex min-h-screen items-start justify-center bg-ds-canvas p-4 sm:p-6">
            <Card as="main" aria-labelledby={headingId} padding="none" className="my-6 w-full max-w-md overflow-hidden">
                <div className="bg-ds-surface-inverse p-ds-6 text-ds-content-on-inverse">
                    <div className="flex items-center gap-ds-3">
                        <span aria-hidden="true" className="rounded-ds-lg bg-ds-action-primary p-ds-2">
                            <Icon icon={ShieldCheck} size="2xl" />
                        </span>
                        <div className="min-w-0">
                            <h1 id={headingId} className="text-ds-heading-md font-bold">
                                Confirm it&rsquo;s you
                            </h1>
                            <p className="text-ds-body text-ds-content-on-inverse-muted">
                                {companyName
                                    ? `You already started an application for ${companyName}. Confirm a few details and we will take you back to it.`
                                    : 'You already started this application. Confirm a few details and we will take you back to it.'}
                            </p>
                        </div>
                    </div>
                </div>

                <form className="space-y-ds-4 p-ds-6" onSubmit={handleSubmit} noValidate>
                    {error && <Notice announce="assertive" tone="danger">{error}</Notice>}

                    {FIELDS.map((field) => (
                        <FormField
                            key={field.name}
                            id={`apply-identity-${field.name}`}
                            label={field.label}
                            description={field.description}
                            error={gaps[field.name] || undefined}
                            required
                        >
                            <Input
                                type={field.type}
                                name={field.name}
                                value={claim[field.name]}
                                autoComplete={field.autoComplete}
                                inputMode={field.inputMode}
                                placeholder={field.placeholder}
                                onChange={(event) => setField(field.name, event.target.value)}
                            />
                        </FormField>
                    ))}

                    <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
                        Continue my application
                    </Button>
                    {/*
                      A live region beside the control, always present so it can be
                      heard when it fills. `aria-busy` on a disabled button is not
                      an announcement, and a label that changes to "Checking…" is
                      content rather than one.
                    */}
                    <p role="status" className="ds-visually-hidden">
                        {busy ? 'Checking your details…' : ''}
                    </p>

                    <Button type="button" variant="ghost" size="sm" fullWidth onClick={onStartFresh}>
                        Start a new application instead
                    </Button>
                    <p className="text-center text-ds-xs text-ds-content-muted">
                        Starting a new application leaves the one you already began untouched.
                    </p>
                </form>
            </Card>
        </div>
    );
}

export default ApplyIdentityCheckScreen;
