import React, { useId, useRef, useState } from 'react';
import DateTripletField from '@shared/components/form/DateTripletField';
import { Check, Copy, Mail, MessageSquare, Send, User, X } from 'lucide-react';
import { Modal } from '@shared/components/modals/Modal';
import { Badge, Button, FormField, IconButton, Input, Label } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

const slugPrefillGroupId = (groupKey) =>
    String(groupKey).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);

/**
 * Delivery options. The order, the `key` values sent to `setDeliveryMethod`,
 * and the labels are a frozen contract shared with DocumentsManager and the
 * backend send flow — presentation may change, these may not.
 */
const DELIVERY_METHODS = [
    { key: 'email', icon: Mail, label: 'Email' },
    { key: 'sms', icon: MessageSquare, label: 'SMS' },
    { key: 'both', icon: Send, label: 'Email + SMS' },
    { key: 'copy', icon: Copy, label: 'Copy Link' },
];

const STEPS = [
    { id: 'recipient', label: 'Recipient' },
    { id: 'details', label: 'Document details' },
    { id: 'delivery', label: 'Delivery and review' },
];

/**
 * Send-from-template — guided three-step flow.
 *
 * Replaces the single long modal. What did NOT change: the recipient/prefill
 * state lives in DocumentsManager, `executeTemplateSend` performs the identical
 * Firestore batch write, the identical `sendSMS` callable, the identical
 * clipboard behaviour for `copy`, the identical success/error messages and the
 * identical navigation afterwards. This component adds no validation and does
 * no I/O of its own.
 *
 * Double-submit and close-during-send are both blocked: the submit action is
 * disabled while `sending`, backdrop dismissal is off, Escape is disabled
 * mid-send, and the Close control is disabled mid-send.
 */
export function SendTemplateWizard({
    selectedTemplate,
    onClose,
    manualName,
    setManualName,
    manualEmail,
    setManualEmail,
    manualPhone,
    setManualPhone,
    deliveryMethod,
    setDeliveryMethod,
    editablePrefillPartition,
    prefillValues,
    setPrefillValues,
    prefillValuesByGroupKey,
    setPrefillValuesByGroupKey,
    sending,
    executeTemplateSend,
    filteredDrivers,
    searchQuery,
    setSearchQuery,
    handleQuickSelect,
}) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `send-wizard-title-${rawId}`;
    const subtitleId = `send-wizard-subtitle-${rawId}`;
    const deliveryLabelId = `send-wizard-delivery-${rawId}`;
    const prefillLabelId = `send-wizard-prefill-${rawId}`;
    const quickSelectLabelId = `send-wizard-quick-${rawId}`;
    const nameInputRef = useRef(null);

    const [stepIndex, setStepIndex] = useState(0);
    const step = STEPS[stepIndex];

    const hasPrefill =
        editablePrefillPartition.groups.length > 0 || editablePrefillPartition.plainFields.length > 0;

    // Step 1 only needs a name; the delivery-specific requirements are enforced
    // by `executeTemplateSend`, which stays the single source of truth.
    const canLeaveRecipientStep = manualName.trim().length > 0;

    const goNext = () => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1));
    const goBack = () => setStepIndex((index) => Math.max(0, index - 1));

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={subtitleId}
            initialFocusRef={stepIndex === 0 ? nameInputRef : undefined}
            closeOnBackdrop={false}
            closeOnEscape={!sending}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface shadow-ds-lg"
        >
            <div className="border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="flex items-start justify-between gap-ds-4">
                    <div className="min-w-0">
                        <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Send Document</h2>
                        <p id={subtitleId} className="break-words text-ds-xs text-ds-content-secondary">
                            Sending: <b>{selectedTemplate?.title}</b>
                        </p>
                    </div>
                    <IconButton label="Close" variant="ghost" disabled={sending} onClick={onClose}>
                        <X size={20} aria-hidden="true" />
                    </IconButton>
                </div>

                {/* Step state is carried by text ("Step 2 of 3"), a check icon and
                    aria-current — never by colour alone. */}
                <ol className="mt-ds-3 flex flex-wrap gap-ds-2">
                    {STEPS.map((item, index) => {
                        const isCurrent = index === stepIndex;
                        const isDone = index < stepIndex;
                        return (
                            <li key={item.id}>
                                <span
                                    aria-current={isCurrent ? 'step' : undefined}
                                    className={`flex items-center gap-ds-1 rounded-ds-md px-ds-2 py-ds-1 text-ds-xs font-bold ${
                                        isCurrent
                                            ? 'bg-ds-action-primary text-ds-content-inverse'
                                            : 'bg-ds-surface text-ds-content-secondary'
                                    }`}
                                >
                                    {isDone && <Check size={12} aria-hidden="true" />}
                                    {index + 1}. {item.label}
                                </span>
                            </li>
                        );
                    })}
                </ol>
                <p role="status" className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                    Step {stepIndex + 1} of {STEPS.length}: {step.label}
                </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                {step.id === 'recipient' && (
                    <Stack gap="md">
                        <div className="grid grid-cols-1 gap-ds-3">
                            <FormField label="Recipient name" required>
                                <Input
                                    ref={nameInputRef}
                                    type="text"
                                    value={manualName}
                                    onChange={(event) => setManualName(event.target.value)}
                                />
                            </FormField>
                            <FormField label="Email address">
                                <Input
                                    type="email"
                                    value={manualEmail}
                                    onChange={(event) => setManualEmail(event.target.value)}
                                />
                            </FormField>
                            <FormField label="Phone number">
                                <Input
                                    type="tel"
                                    value={manualPhone}
                                    onChange={(event) => setManualPhone(event.target.value)}
                                />
                            </FormField>
                        </div>

                        <div>
                            <h3
                                id={quickSelectLabelId}
                                className="mb-ds-2 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary"
                            >
                                Or choose an existing driver or lead
                            </h3>
                            <div className="mb-ds-2">
                                <FormField label="Search leads">
                                    <Input
                                        type="search"
                                        placeholder="Search leads..."
                                        value={searchQuery}
                                        onChange={(event) => setSearchQuery(event.target.value)}
                                    />
                                </FormField>
                            </div>
                            <div
                                role="group"
                                aria-labelledby={quickSelectLabelId}
                                tabIndex={0}
                                className="flex max-h-[180px] flex-col gap-ds-1 overflow-y-auto focus-visible:outline-none focus-visible:shadow-ds-focus"
                            >
                                {filteredDrivers.length === 0 ? (
                                    <p className="py-ds-6 text-center text-ds-xs italic text-ds-content-muted">
                                        No leads found.
                                    </p>
                                ) : (
                                    filteredDrivers.slice(0, 20).map((driver) => (
                                        <Button
                                            key={driver.id}
                                            variant="ghost"
                                            fullWidth
                                            justify="start"
                                            onClick={() => handleQuickSelect(driver)}
                                        >
                                            <span
                                                aria-hidden="true"
                                                className="rounded-ds-md border border-ds-border-subtle bg-ds-surface p-1.5 text-ds-content-secondary"
                                            >
                                                <User size={14} />
                                            </span>
                                            <span className="min-w-0 flex-1 text-left">
                                                <span className="block truncate text-ds-xs font-bold text-ds-content">
                                                    {driver.firstName} {driver.lastName}
                                                </span>
                                                <span className="block truncate text-ds-xs font-normal text-ds-content-secondary">
                                                    {driver.email || 'No email'} | {driver.phone || driver.phoneNumber || 'No phone'}
                                                </span>
                                            </span>
                                        </Button>
                                    ))
                                )}
                            </div>
                        </div>
                    </Stack>
                )}

                {step.id === 'details' && (
                    <Stack gap="md">
                        <div className="rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-3">
                            <h3 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">
                                Template
                            </h3>
                            <p className="mt-ds-1 text-ds-body font-bold text-ds-content [overflow-wrap:anywhere]">
                                {selectedTemplate?.title}
                            </p>
                            <p className="mt-ds-1">
                                <Badge tone="neutral">{selectedTemplate?.fields?.length || 0} fields</Badge>
                            </p>
                        </div>

                        {hasPrefill ? (
                            <div>
                                <h3
                                    id={prefillLabelId}
                                    className="mb-ds-2 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary"
                                >
                                    Pre-fill fields (optional)
                                </h3>
                                <div role="group" aria-labelledby={prefillLabelId} className="flex flex-col gap-ds-3">
                                    {editablePrefillPartition.groups.map((group) => {
                                        const groupId = `edoc-grp-${slugPrefillGroupId(group.groupKey)}`;
                                        const memberTitle = group.members.map((m) => m.label || m.id).join(', ');
                                        const appliesCount = group.appliesCount > 1 ? (
                                            <span className="font-normal normal-case text-ds-content-muted">
                                                {' '}— applies to {group.appliesCount} places
                                            </span>
                                        ) : null;

                                        return (
                                            <div key={group.groupKey} className="flex flex-col gap-ds-1" role="group" aria-label={group.uiLabel}>
                                                {group.useDateTriplet ? (
                                                    <div
                                                        className="block break-words text-ds-xs font-bold uppercase text-ds-content-secondary"
                                                        title={memberTitle}
                                                    >
                                                        {group.uiLabel}
                                                        {appliesCount}
                                                    </div>
                                                ) : (
                                                    /* FormField takes a plain-string label, but this label
                                                       carries a member tooltip and the applies-count
                                                       fragment, so the approved Label + Input pair is
                                                       composed directly instead. */
                                                    <Label className="break-words uppercase" htmlFor={groupId} title={memberTitle}>
                                                        {group.uiLabel}
                                                        {appliesCount}
                                                    </Label>
                                                )}
                                                {group.useDateTriplet ? (
                                                    /* Documented temporary exception, carried over
                                                       unchanged: DateTripletField is a shared
                                                       compatibility component still on legacy local
                                                       selects. Its migration is tracked in the roadmap. */
                                                    <DateTripletField
                                                        label=""
                                                        idPrefix={groupId}
                                                        name={`prefill-${group.groupKey}`}
                                                        value={prefillValuesByGroupKey[group.groupKey] || ''}
                                                        onChange={(_n, value) =>
                                                            setPrefillValuesByGroupKey((prev) => ({
                                                                ...prev,
                                                                [group.groupKey]: value,
                                                            }))
                                                        }
                                                        required={false}
                                                        maxToday
                                                        minYear={1920}
                                                    />
                                                ) : (
                                                    <Input
                                                        id={groupId}
                                                        type="text"
                                                        placeholder={`Enter ${group.uiLabel}...`}
                                                        value={prefillValuesByGroupKey[group.groupKey] || ''}
                                                        onChange={(event) =>
                                                            setPrefillValuesByGroupKey((prev) => ({
                                                                ...prev,
                                                                [group.groupKey]: event.target.value,
                                                            }))
                                                        }
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                    {editablePrefillPartition.plainFields.map((field) => (
                                        <FormField key={field.id} label={field.label || field.id} className="break-words">
                                            <Input
                                                id={`edoc-plain-${field.id}`}
                                                type="text"
                                                placeholder={`Enter ${field.label || 'text'}...`}
                                                value={prefillValues[field.id] || ''}
                                                onChange={(event) =>
                                                    setPrefillValues((prev) => ({
                                                        ...prev,
                                                        [field.id]: event.target.value,
                                                    }))
                                                }
                                            />
                                        </FormField>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-ds-sm text-ds-content-secondary">
                                This template has no editable pre-fill fields. The signer completes everything.
                            </p>
                        )}
                    </Stack>
                )}

                {step.id === 'delivery' && (
                    <Stack gap="md">
                        <div>
                            <h3
                                id={deliveryLabelId}
                                className="mb-ds-2 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary"
                            >
                                Delivery method
                            </h3>
                            <div
                                role="group"
                                aria-labelledby={deliveryLabelId}
                                className="grid grid-cols-2 gap-ds-2 sm:grid-cols-4"
                            >
                                {DELIVERY_METHODS.map((option) => {
                                    const Icon = option.icon;
                                    const selected = deliveryMethod === option.key;
                                    return (
                                        <Button
                                            key={option.key}
                                            variant={selected ? 'primary' : 'secondary'}
                                            size="sm"
                                            aria-pressed={selected}
                                            onClick={() => setDeliveryMethod(option.key)}
                                        >
                                            {selected ? <Check size={14} aria-hidden="true" /> : <Icon size={14} aria-hidden="true" />}
                                            {option.label}
                                        </Button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-ds-lg border border-ds-border bg-ds-surface-subtle p-ds-3">
                            <h3 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">
                                Review before sending
                            </h3>
                            <dl className="mt-ds-2 flex flex-col gap-ds-1 text-ds-sm">
                                <div className="flex justify-between gap-ds-2">
                                    <dt className="text-ds-content-secondary">Document</dt>
                                    <dd className="min-w-0 text-right text-ds-content [overflow-wrap:anywhere]">
                                        {selectedTemplate?.title}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-ds-2">
                                    <dt className="text-ds-content-secondary">Recipient</dt>
                                    <dd className="min-w-0 text-right text-ds-content [overflow-wrap:anywhere]">
                                        {manualName.trim() || '—'}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-ds-2">
                                    <dt className="text-ds-content-secondary">Email</dt>
                                    <dd className="min-w-0 text-right text-ds-content [overflow-wrap:anywhere]">
                                        {manualEmail.trim() || '—'}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-ds-2">
                                    <dt className="text-ds-content-secondary">Phone</dt>
                                    <dd className="min-w-0 text-right text-ds-content [overflow-wrap:anywhere]">
                                        {manualPhone.trim() || '—'}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-ds-2">
                                    <dt className="text-ds-content-secondary">Delivery</dt>
                                    <dd className="text-right text-ds-content">
                                        {DELIVERY_METHODS.find((option) => option.key === deliveryMethod)?.label}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-ds-2">
                                    <dt className="text-ds-content-secondary">Link expires</dt>
                                    <dd className="text-right text-ds-content">7 days after sending</dd>
                                </div>
                            </dl>
                        </div>
                    </Stack>
                )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-ds-2 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="ghost" disabled={stepIndex === 0 || sending} onClick={goBack}>
                    Back
                </Button>

                {stepIndex < STEPS.length - 1 ? (
                    <Button
                        variant="primary"
                        disabled={stepIndex === 0 && !canLeaveRecipientStep}
                        onClick={goNext}
                    >
                        Continue
                    </Button>
                ) : (
                    <Button
                        variant="primary"
                        // Disabled while sending: this is what prevents a second
                        // signing request being written by a double click.
                        disabled={sending || !manualName.trim()}
                        loading={sending}
                        onClick={executeTemplateSend}
                    >
                        {deliveryMethod === 'copy' ? (
                            <><Copy size={16} aria-hidden="true" /> Copy Signing Link</>
                        ) : (
                            <><Send size={16} aria-hidden="true" /> Send Document</>
                        )}
                    </Button>
                )}
                <p role="status" className="ds-visually-hidden">
                    {sending ? 'Sending document, please wait…' : ''}
                </p>
            </div>
        </Modal>
    );
}

export default SendTemplateWizard;
