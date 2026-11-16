import React, { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/design-system/components';
import { ConfirmDialog } from '@/design-system/patterns';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { optOutErrorMessage } from '@features/settings/components/sms/smsOptOutService';
import { useDoNotText } from './useDoNotText';
import { lastCallOf, recordDayOf } from './dossierFacts';

/**
 * How to reach a driver, the first card of the Application tab's Summary View
 * (the owner's choice: the dossier's left column holds only the name, the
 * status, Call, Log call and Email): the phone and email as text, the day the
 * record came in (Applied or Added, as the list names it), and the last call
 * with its result (`dossierFacts.js`).
 *
 * Beside the phone, **Do not text** puts the number on the company's SMS
 * opt-out list after a question, for any team member (`canEdit`); a number
 * already there reads **Texts off**. Only a Company Admin removes one, in
 * Settings → Text messages.
 */

/**
 * One fact: its label over its value. Stacked rather than side by side, so the
 * value has the column's whole width and an address does not break mid-word in
 * a 150px cell. `wide` spans both columns of the facts grid.
 */
function Fact({ label, wide = false, children }) {
    return (
        <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
            <dt className="text-ds-xs font-semibold text-ds-content-secondary">{label}</dt>
            <dd className="mt-ds-1 text-ds-sm text-ds-content [overflow-wrap:anywhere]">{children}</dd>
        </div>
    );
}

/** An address that breaks, when it must, before its `@` rather than mid-word. */
function EmailText({ email }) {
    const at = email.lastIndexOf('@');
    if (at <= 0) return email;
    return <>{email.slice(0, at)}<wbr />{email.slice(at)}</>;
}

/**
 * The question before a number goes on the list. Mounted only while it is
 * asked, so the dossier needs no toast provider until someone asks.
 */
function DoNotTextDialog({ phoneShown, onConfirm, onDone, onCancel }) {
    const { showSuccess } = useToast();
    const [state, setState] = useState({ busy: false, error: null });

    const confirm = async () => {
        setState({ busy: true, error: null });
        let result;
        try {
            result = await onConfirm();
        } catch (failure) {
            setState({ busy: false, error: optOutErrorMessage(failure, 'We could not add the number. Try again.') });
            return;
        }
        showSuccess(result?.added === false
            ? `${phoneShown} was already on the list.`
            : `${phoneShown} is on the list. SafeHaul will not text it.`);
        onDone();
    };

    return (
        <ConfirmDialog
            title={`Stop texting ${phoneShown}?`}
            description={'SafeHaul will skip this number in Contact Attempt texts, campaigns (emails as well) '
                + 'and signing-link texts. Only a Company Admin can take it off the list, in Settings → Text messages.'}
            tone="info"
            confirmLabel="Do not text"
            loading={state.busy}
            error={state.error}
            onConfirm={confirm}
            onCancel={onCancel}
        />
    );
}

function DoNotText({ companyId, phone, phoneShown, canEdit }) {
    const { usable, checking, listed, markDoNotText } = useDoNotText(companyId, phone);
    const [asking, setAsking] = useState(false);
    const [justAdded, setJustAdded] = useState(false);
    const textsOffRef = useRef(null);

    // The button the question came from is gone once the number is listed, so
    // focus goes to what took its place rather than to the page.
    useEffect(() => {
        if (!justAdded || asking) return;
        textsOffRef.current?.focus();
        setJustAdded(false);
    }, [justAdded, asking]);

    if (!usable || checking) return null;
    return (
        <>
            {listed ? (
                <span ref={textsOffRef} tabIndex={-1} className="inline-flex rounded-ds-sm focus-visible:shadow-ds-focus">
                    <Badge tone="neutral">Texts off</Badge>
                </span>
            ) : canEdit && (
                <Button
                    variant="link"
                    size="sm"
                    aria-label={`Do not text ${phoneShown}`}
                    onClick={() => setAsking(true)}
                >
                    Do not text
                </Button>
            )}
            {/* Closed only by its own answer, though the number reads as listed the moment it is. */}
            {asking && (
                <DoNotTextDialog
                    phoneShown={phoneShown}
                    onConfirm={markDoNotText}
                    onDone={() => { setJustAdded(true); setAsking(false); }}
                    onCancel={() => setAsking(false)}
                />
            )}
        </>
    );
}

export function DossierKeyFacts({ appData, collectionName, companyId, canEdit = false }) {
    const phone = typeof appData?.phone === 'string' ? appData.phone.trim() : '';
    const email = typeof appData?.email === 'string' ? appData.email.trim() : '';
    const phoneShown = phone ? formatPhoneNumber(phone) : '';
    const recordDay = recordDayOf(appData, collectionName);
    const lastCall = lastCallOf(appData);

    return (
        // Phone and the record's day side by side; the email and the last call,
        // the two long values, across two columns. Four columns on a wide card.
        <dl className="grid grid-cols-2 gap-x-ds-4 gap-y-ds-3 xl:grid-cols-4">
            {phone && (
                <Fact label="Phone">
                    <span className="block tabular-nums">{phoneShown}</span>
                    <DoNotText companyId={companyId} phone={phone} phoneShown={phoneShown} canEdit={canEdit} />
                </Fact>
            )}
            {recordDay && <Fact label={recordDay.label}>{recordDay.day}</Fact>}
            {email && <Fact label="Email" wide><EmailText email={email} /></Fact>}
            <Fact label="Last call" wide>
                {lastCall
                    ? [lastCall.outcome, lastCall.at].filter(Boolean).join(' · ')
                    : <span className="text-ds-content-muted">None logged</span>}
            </Fact>
        </dl>
    );
}
