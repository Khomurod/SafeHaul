import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { Button, Card, DataTable, FormField, Input, Notice } from '@/design-system/components';
import { ConfirmDialog, useUnsavedChanges } from '@/design-system/patterns';
import { Icon, Plus } from '@design-system/icons';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { formatPhoneNumber } from '@shared/utils/helpers';
import { optOutErrorMessage } from './smsOptOutService';
import { useSmsOptOuts } from './useSmsOptOuts';

const NUMBER_HINT = 'Add a number when the driver replied STOP or asked not to be texted.';
const AREA_CODE = 'Enter the phone number with its area code, such as (555) 123-4567.';

/** The server's rule (`normalizePhone`), so a number it would refuse is caught here first. */
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
    const headingId = useId();
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
            render: (entry) => <span className="whitespace-nowrap font-medium text-ds-content">{formatPhoneNumber(entry.phone)}</span>,
        },
        {
            key: 'reason',
            header: 'Reason',
            width: 'lg',
            render: (entry) => <span className="text-ds-sm [overflow-wrap:anywhere]">{entry.reason || '—'}</span>,
        },
        {
            key: 'added',
            header: 'Added',
            width: 'md',
            render: (entry) => (
                <div className="text-ds-sm">
                    <p>{addedHow(entry)}</p>
                    {addedOn(entry.addedAt) && <p className="text-ds-xs text-ds-content-muted">{addedOn(entry.addedAt)}</p>}
                </div>
            ),
        },
        ...(canRemove ? [{
            key: 'actions',
            headerLabel: 'Actions',
            align: 'end',
            // No label on a card: its button is the card's last line.
            mobileLabel: '',
            width: 'sm',
            render: (entry) => (
                <Button
                    variant="secondary"
                    tone="danger"
                    size="sm"
                    aria-label={`Remove ${formatPhoneNumber(entry.phone)}`}
                    onClick={() => askRemove(entry)}
                >
                    Remove
                </Button>
            ),
        }] : []),
    ], [canRemove, askRemove]);

    const removingShown = removing ? formatPhoneNumber(removing.phone) : '';

    return (
        <>
            <Card padding="none" className="overflow-hidden" aria-labelledby={headingId} data-testid="sms-opt-outs">
                <div className="border-b border-ds-border-subtle px-ds-4 py-ds-3">
                    <h2 id={headingId} className="font-semibold text-ds-content">Opted-out numbers</h2>
                    <p className="text-ds-sm text-ds-content-muted">
                        SafeHaul skips these numbers in Contact Attempt texts, campaigns (emails as well) and signing-link
                        texts. A text sent by hand, from a phone or the RingCentral app, is the sender’s responsibility.
                    </p>
                </div>
                <form className="flex flex-col gap-ds-3 border-b border-ds-border-subtle p-ds-4" onSubmit={submit} noValidate>
                    <div className="grid gap-ds-3 sm:grid-cols-2">
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
                    </div>
                    <div>
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
                <DataTable
                    embedded
                    ariaLabel="Opted-out numbers"
                    density="compact"
                    minWidth="standard"
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
            </Card>
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
