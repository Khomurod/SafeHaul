import React, { forwardRef, useId, useState } from 'react';
import { FormField, Input, SegmentedControl } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

/**
 * "Fix recipient and resend", inside a sent document's details dialog: the
 * recipient's name, email and phone and the channels, filled in from the
 * document. The dialog's footer holds its Save and resend (`form={id}`) and
 * Cancel.
 *
 * It checks only that something changed: an unchanged recipient has nothing to
 * correct, and Resend is what sends the link again to the same details. What a
 * correction needs (a name; an email for Email, a phone for SMS) is checked
 * where Correct Document checks it, by the save the dialog's caller makes
 * (`saveEnvelope`), so both ways to correct follow one rule. The form has
 * `noValidate`: the browser's own bubbles would be a second, different rule.
 */

/** The channels, as Correct Document's delivery methods name them. */
const CHANNELS = Object.freeze([
    { value: 'email', label: 'Email' },
    { value: 'sms', label: 'SMS' },
    { value: 'both', label: 'Email + SMS' },
]);

/** How a document was sent: `both`, `sms` or `email` (a link only copied, or nothing recorded, starts at Email). */
function channelOf(document) {
    const method = document?.deliveryMethod;
    const email = document?.sendEmail === true || method === 'email' || method === 'both';
    const sms = document?.sendSms === true || method === 'sms' || method === 'both';
    if (email && sms) return 'both';
    return sms ? 'sms' : 'email';
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function recipientOf(document) {
    return {
        recipientName: text(document?.recipientName),
        recipientEmail: text(document?.recipientEmail),
        recipientPhone: text(document?.recipientPhone),
        deliveryMethod: channelOf(document),
    };
}

const sameRecipient = (a, b) => Object.keys(a).every((key) => a[key] === b[key]);

export const FixRecipientForm = /* @__PURE__ */ forwardRef(function FixRecipientForm({ id, document, onSubmit }, nameRef) {
    const rawId = useId().replace(/:/g, '');
    const headingId = `fix-recipient-heading-${rawId}`;
    const channelsId = `fix-recipient-channels-${rawId}`;
    const [values, setValues] = useState(() => recipientOf(document));
    const [unchanged, setUnchanged] = useState(false);

    const update = (key, value) => {
        setUnchanged(false);
        setValues((prev) => ({ ...prev, [key]: value }));
    };

    const submit = (event) => {
        event.preventDefault();
        const next = {
            recipientName: text(values.recipientName),
            recipientEmail: text(values.recipientEmail),
            recipientPhone: text(values.recipientPhone),
            deliveryMethod: values.deliveryMethod,
        };
        if (sameRecipient(next, recipientOf(document))) {
            setUnchanged(true);
            return;
        }
        onSubmit(next);
    };

    return (
        <form id={id} noValidate onSubmit={submit} aria-labelledby={headingId}>
            <Stack gap="sm">
                <h3 id={headingId} className="text-ds-body font-bold text-ds-content">Fix recipient and resend</h3>
                <p className="text-ds-sm text-ds-content-secondary">
                    The link goes again to an email or phone you change, and a link sent to an old one stops working.
                </p>
                <FormField label="Name" required>
                    <Input
                        ref={nameRef}
                        autoComplete="off"
                        value={values.recipientName}
                        onChange={(event) => update('recipientName', event.target.value)}
                    />
                </FormField>
                <FormField label="Email">
                    <Input
                        type="email"
                        autoComplete="off"
                        value={values.recipientEmail}
                        onChange={(event) => update('recipientEmail', event.target.value)}
                    />
                </FormField>
                <FormField label="Phone">
                    <Input
                        type="tel"
                        autoComplete="off"
                        value={values.recipientPhone}
                        onChange={(event) => update('recipientPhone', event.target.value)}
                    />
                </FormField>
                <div>
                    <p id={channelsId} className="mb-ds-1 text-ds-sm font-medium text-ds-content">Send by</p>
                    <SegmentedControl
                        ariaLabelledBy={channelsId}
                        columns={3}
                        options={CHANNELS}
                        value={values.deliveryMethod}
                        onChange={(value) => update('deliveryMethod', value)}
                    />
                </div>
                {/* Always in the page, so the sentence is announced when it appears. */}
                <p role="status" className="text-ds-sm text-ds-status-warning-fg">
                    {unchanged && 'Nothing changed. To send the link again to the same details, use Resend.'}
                </p>
            </Stack>
        </form>
    );
});

export default FixRecipientForm;
