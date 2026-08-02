/**
 * Signer-preview projection.
 *
 * Turns the editor's placed fields into exactly the documents the signing room
 * would receive, so "Preview as signer" shows the real thing rather than a
 * second, drifting imitation.
 *
 * The projection runs the SAME two functions the real send runs — the template
 * serializer and the prefill engine — in the same order. If either changes, the
 * preview changes with it, which is the whole point.
 *
 * Nothing here performs I/O: no Firestore read or write, no Storage access, no
 * callable, no signing request and no access token. It is a pure transform of
 * data already on screen.
 */

import { serializeTemplateFields } from '@features/signing/utils/templateFieldSerializer';
import {
    buildPrefillContext,
    isFieldLocked,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import { sortFieldsForFlow } from '@features/signing/utils/signerFieldFlow';

/**
 * Placeholder recipient used when the editor has no real one — template mode,
 * or a request whose recipient has not been typed yet.
 *
 * Deliberately obvious sample text: a preview that showed a plausible-looking
 * invented name could be mistaken for real recipient data.
 */
export const SAMPLE_RECIPIENT = Object.freeze({
    name: 'Sample Recipient',
    email: 'sample.recipient@example.invalid',
    phone: '(555) 010-0000',
});

/**
 * Project editor fields into signer-shaped fields with prefill applied.
 *
 * @param {object} options
 * @param {object[]} options.fields          editor fields (x/y/page)
 * @param {string} [options.recipientName]
 * @param {string} [options.recipientEmail]
 * @param {string} [options.recipientPhone]
 * @param {string} [options.companyName]
 * @param {Date} [options.now]               injectable for deterministic tests
 * @returns {{
 *   fields: object[],
 *   orderedFields: object[],
 *   missingLockedRequired: string[],
 *   signerCompletes: object[],
 *   usedSampleRecipient: boolean
 * }}
 */
export function buildSignerPreview({
    fields = [],
    recipientName = '',
    recipientEmail = '',
    recipientPhone = '',
    companyName = '',
    now,
} = {}) {
    const hasRealRecipient = String(recipientName || '').trim().length > 0;

    const context = buildPrefillContext({
        recipientName: hasRealRecipient ? recipientName : SAMPLE_RECIPIENT.name,
        recipientEmail: String(recipientEmail || '').trim() || SAMPLE_RECIPIENT.email,
        recipientPhone: String(recipientPhone || '').trim() || SAMPLE_RECIPIENT.phone,
        companyName,
        ...(now ? { now } : {}),
    });

    // Resolve first (editor shape), then serialize — the send path's order.
    const { fields: resolved, missingLockedRequired } = resolveFieldsForSend(fields, context);
    const signerFields = serializeTemplateFields(resolved);

    // What the recipient would still have to fill in: required, not locked, and
    // with no prefilled value.
    const signerCompletes = signerFields.filter(
        (field) => field.required && !isFieldLocked(field) && !String(field.defaultValue || '').trim(),
    );

    return {
        fields: signerFields,
        orderedFields: sortFieldsForFlow(signerFields),
        missingLockedRequired,
        signerCompletes,
        usedSampleRecipient: !hasRealRecipient,
    };
}

/** Preview fields for one page, in signer reading order. */
export function previewFieldsForPage(orderedFields = [], page = 1) {
    return (Array.isArray(orderedFields) ? orderedFields : []).filter(
        (field) => (Number(field?.pageNumber) || 1) === page,
    );
}

/**
 * Values the preview shows in each field.
 *
 * A locked field renders its resolved value through the signer's own read-only
 * treatment, so nothing is needed here. An editable field with a prefilled
 * default shows that default, exactly as the signing room would.
 */
export function previewFieldValues(fields = []) {
    const values = {};
    for (const field of Array.isArray(fields) ? fields : []) {
        if (!field || isFieldLocked(field)) continue;
        const value = String(field.defaultValue || '');
        if (value) values[field.id] = value;
    }
    return values;
}
