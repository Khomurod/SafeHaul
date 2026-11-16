import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Button, DataTable, FormField, FormSection, IconButton, Input, Notice } from '@/design-system/components';
import { ConfirmDialog, useUnsavedChanges } from '@/design-system/patterns';
import { Icon, Plus, Trash2 } from '@design-system/icons';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { optOutErrorMessage } from './smsOptOutService';
import { useSmsOptOuts } from './useSmsOptOuts';
import { BreakableText } from '../BreakableText';
import { settingsTableMinWidth, useSettingsTableWidth } from '../useSettingsTableWidth';

const NUMBER_HINT = 'Add a number when the driver replied STOP or asked not to be texted.';
const AREA_CODE = 'Enter the phone number with its area code, such as (555) 123-4567.';

/** The server's rule (`toE164Us`), so a number it would refuse is caught here first. */
function looksLikeNumber(value) {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
}

function addedOn(iso) {
    if (!iso) return null;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

/** How a number came onto the list, in the team's words. */
function addedHow(entry) {
    if (entry.source === 'team') return `By ${entry.addedByName || 'a team member'}`;
    if (entry.source === 'reply') return 'From a STOP reply';
    return 'Added outside Settings';
}

const phoneOf = (entry) => entry.phone;

/**
 * Settings → Text messages → Opted-out numbers: the company's list of numbers
 * that asked not to be texted (`functions/smsOptOuts.js`). The server lets any
 * team member add one (Settings itself opens for Company Admins); only a Company
 * Admin (`canRemove`) is offered Remove, behind a question, and the server
 * checks both. The numbers are personal data: shown here, never logged.
 */
export function SmsOptOutSection({ companyId, canRemove = false }) {
    const [tableBox, tableWidth] = useSettingsTableWidth();
    // Number 144 + a reason at least 120 + added 176 + actions 88 fit from 528px;
    // from 82px more, and wherever the table scrolls, Added has its full 220.
    const fitsFrom = canRemove ? 528 : 440;
    // On a card the bin is a full-size target.
    const isPhone = useIsMobile();
    const addedWidth = tableWidth >= fitsFrom && tableWidth < fitsFrom + 82 ? 'lg' : 'xl';
    const tableMinWidth = settingsTableMinWidth(tableWidth, fitsFrom);
    const { showSuccess } = useToast();
    const { entries, total, hasMore, loading, error, reload, add, remove } = useSmsOptOuts(companyId);
    const [phone, setPhone] = useState('');
    const [reason, setReason] = useState('');
    // A number typed and not added is an unsaved change: leaving Settings asks first.
    useUnsavedChanges(phone.trim() !== '' || reason.trim() !== '');
    const [adding, setAdding] = useState(false);
    const addingRef = useRef(false);
    const [addError, setAddError] = useState(null);
    const [removing, setRemoving] = useState(null);
    const [removeState, setRemoveState] = useState({ busy: false, error: null });

    const submit = async (event) => {
        event.preventDefault();
        // A ref, not `adding`: two presses before the next render would both get past state.
        if (addingRef.current) return;
        if (!looksLikeNumber(phone)) {
            setAddError(AREA_CODE);
            return;
        }
        addingRef.current = true;
        setAdding(true);
        setAddError(null);
        try {
            const { added, entry } = (await add({ phone: phone.trim(), reason: reason.trim() })) || {};
            const shown = formatPhoneNumber(entry?.phone || phone);
            showSuccess(added === false ? `${shown} was already on the list.` : `${shown} is on the list. SafeHaul will not text it.`);
            // Only what was sent: anything typed while the request was on its way stays.
            setPhone((typed) => (typed === phone ? '' : typed));
            setReason((typed) => (typed === reason ? '' : typed));
        } catch (failure) {
            setAddError(optOutErrorMessage(failure, 'We could not add the number. Try again.'));
        } finally {
            addingRef.current = false;
            setAdding(false);
        }
    };

    const askRemove = useCallback((entry) => {
        setRemoveState({ busy: false, error: null });
        setRemoving(entry);
    }, []);

    const confirmRemove = async () => {
        setRemoveState({ busy: true, error: null });
        try {
            await remove(removing.phone);
        } catch (failure) {
            setRemoveState({
                busy: false,
                error: optOutErrorMessage(failure, 'We could not remove the number. Try again.',
                    'Only a Company Admin can remove a number. Ask one of them.'),
            });
            return;
        }
        showSuccess(`${formatPhoneNumber(removing.phone)} is off the list.`);
        setRemoving(null);
        setRemoveState({ busy: false, error: null });
    };

    const columns = useMemo(() => [
        {
            key: 'phone',
            header: 'Number',
            rowHeader: true,
            width: 'md',
            render: (entry) => (
                <span className="whitespace-nowrap font-semibold text-ds-content max-md:text-ds-heading-sm">
                    {formatPhoneNumber(entry.phone)}
                </span>
            ),
        },
        {
            key: 'reason',
            header: 'Reason',
            mobileRole: 'line',
            // On a card, clear of the bin that overhangs the number's line.
            render: (entry) => <span className="block [overflow-wrap:anywhere] [text-wrap:pretty] max-md:pt-ds-1">{entry.reason || '—'}</span>,
        },
        {
            key: 'added',
            header: 'Added',
            width: addedWidth,
            mobileRole: 'line',
            // The date first, then who added it: one line on a card.
            render: (entry) => (
                <p className="text-ds-body text-ds-content max-md:text-ds-xs max-md:text-ds-content-secondary">
                    {addedOn(entry.addedAt) && (
                        <>
                            {addedOn(entry.addedAt)}
                            <span className="md:hidden" aria-hidden="true">{' · '}</span>
                        </>
                    )}
                    <span className="block text-ds-xs text-ds-content-secondary max-md:inline"><BreakableText text={addedHow(entry)} /></span>
                </p>
            ),
        },
        ...(canRemove ? [{
            key: 'actions',
            header: 'Actions',
            align: 'end',
            width: 'actions',
            // On a card the one icon button sits at the end of the number's line.
            mobileRole: 'status',
            // The one look of a row delete; the question that follows says what it does.
            // On a card its 44px target overhangs the number's line, centred on
            // it, rather than making that line 44px tall.
            render: (entry) => (
                <span className="inline-flex max-md:-my-ds-3">
                    <IconButton
                        variant="ghost"
                        size={isPhone ? 'md' : 'sm'}
                        label={`Remove ${formatPhoneNumber(entry.phone)}`}
                        onClick={() => askRemove(entry)}
                    >
                        <Icon icon={Trash2} className="text-ds-status-danger-fg" />
                    </IconButton>
                </span>
            ),
        }] : []),
    ], [canRemove, askRemove, addedWidth, isPhone]);

    const removingShown = removing ? formatPhoneNumber(removing.phone) : '';

    return (
        <>
            <FormSection
                layout="stacked"
                padding="none"
                title="Opted-out numbers"
                description="SafeHaul skips these numbers in Contact Attempt texts, campaigns (emails as well) and signing-link texts. A text sent by hand, from a phone or the RingCentral app, is the sender’s responsibility."
                data-testid="sms-opt-outs"
            >
                {/* The card's top strip: the fields and the button, in one row from 1024px. */}
                <form
                    className="grid gap-ds-4 border-b border-ds-border-subtle p-ds-4 md:grid-cols-2 md:p-ds-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                    onSubmit={submit}
                    noValidate
                >
                    <FormField label="Phone number" description={NUMBER_HINT} error={addError} required>
                        <Input
                            type="tel"
                            inputMode="tel"
                            autoComplete="off"
                            maxLength={40}
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                        />
                    </FormField>
                    <FormField label="Reason" description="Optional. A few words, such as “Replied STOP”.">
                        <Input
                            autoComplete="off"
                            maxLength={200}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </FormField>
                    {/* Level with the boxes when it shares their row (from 1024px). */}
                    <div className="grid md:col-span-2 md:block lg:col-span-1 lg:pt-ds-6">
                        <Button type="submit" variant="primary" loading={adding} disabled={!companyId}>
                            <Icon icon={Plus} />
                            Add number
                        </Button>
                    </div>
                </form>
                {hasMore && (
                    <Notice tone="info" size="sm" className="m-ds-4">
                        {`Showing the newest ${entries.length} of ${total} numbers.`}
                    </Notice>
                )}
                <div ref={tableBox} className="min-w-0">
                    <DataTable
                        embedded
                        ariaLabel="Opted-out numbers"
                        minWidth={tableMinWidth}
                        mobilePresentation="cards"
                        data={entries}
                        columns={columns}
                        getRowId={phoneOf}
                        isLoading={loading}
                        loadingLabel="Loading opted-out numbers"
                        error={error ? { message: error, onRetry: reload } : undefined}
                        empty={{
                            title: 'No opted-out numbers',
                            description: 'When a driver replies STOP or asks not to be texted, add their number here.',
                        }}
                    />
                </div>
            </FormSection>
            <ConfirmDialog
                isOpen={Boolean(removing)}
                title={`Remove ${removingShown} from the list?`}
                description="Remove a number only when the driver asked to receive texts again."
                confirmLabel="Remove"
                loading={removeState.busy}
                error={removeState.error}
                onConfirm={confirmRemove}
                onCancel={() => setRemoving(null)}
            />
        </>
    );
}

export default SmsOptOutSection;
