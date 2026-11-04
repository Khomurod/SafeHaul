/**
 * A driver record's signing documents, as the dossier's Documents tab lists
 * them: every signing request linked to the record (`sourceApplicationId` for an
 * application, `sourceLeadId` for a lead) and, for an application, each of the
 * company's required post-application forms that no linked request carries yet,
 * as "Not started".
 *
 * "Link expired" is derived here and never stored: an unsigned request whose
 * `expiresAt` has passed. Who may be sent which form, and on which channel, is
 * the server's to decide (`sendPostApplicationDocument`); this only says where
 * the button is offered and words what the server answered.
 */

const millisOf = (value) => {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    return null;
};

const statusOf = (request) => String(request?.status || '').trim().toLowerCase();

/** The field a signing request names its driver record by. */
export function recordLinkField(collectionName) {
    return collectionName === 'leads' ? 'sourceLeadId' : 'sourceApplicationId';
}

/** The request id of a post-application form; the same as `buildPostApplicationRequestId` on the server. */
export function postApplicationRequestId(applicationId, templateId) {
    return `postapp_${applicationId}_${templateId}`;
}

/** An unsigned request whose link has run out. */
export function isLinkExpired(request, now = Date.now()) {
    const status = statusOf(request);
    if (status !== 'sent' && status !== 'opened') return false;
    const expires = millisOf(request?.expiresAt);
    return expires !== null && expires < now;
}

/** The soonest moment one of `requests` runs out while unsigned, or null. */
export function nextLinkExpiry(requests, now = Date.now()) {
    let soonest = null;
    for (const request of requests || []) {
        const status = statusOf(request);
        if (status !== 'sent' && status !== 'opened') continue;
        const expires = millisOf(request?.expiresAt);
        if (expires !== null && expires >= now && (soonest === null || expires < soonest)) soonest = expires;
    }
    return soonest;
}

const STATES = {
    sent: 'awaiting',
    opened: 'awaiting',
    processing: 'submitting',
    pending_seal: 'sealing',
    signed: 'signed',
    sealed: 'signed',
    completed: 'signed',
    error_sealing: 'seal_failed',
    voided: 'voided',
};

/** What the dossier calls a request's state; a key of the section's presentation. */
export function signingDocumentState(request, now = Date.now()) {
    if (isLinkExpired(request, now)) return 'link_expired';
    return STATES[statusOf(request)] || 'other';
}

/**
 * Send to driver is offered on the form's own request (`postapp_…`) while it
 * waits for a signature and the server has sent it nowhere, its link expired
 * or not. A form already emailed or texted is not offered again: a reminder is
 * another thing.
 */
function canSendRequest(request, applicationId, formIds) {
    return Boolean(applicationId)
        && formIds.has(request.templateId)
        && request.id === postApplicationRequestId(applicationId, request.templateId)
        && statusOf(request) === 'sent'
        && request.sendEmail !== true
        && request.sendSms !== true;
}

/**
 * The section's rows: the required forms no request carries yet (in the
 * company's order), then the linked requests, newest first. `forms` is the
 * company's enabled post-application list (`normalizePostApplicationTemplates`);
 * `applicationId` is null for a lead. A form counts as started once any linked
 * request carries its template, unless that request is someone's voided copy;
 * the form's own request counts even voided, since the server will not send it
 * again.
 */
export function recordDocumentRows({ requests = [], forms = [], applicationId = null, now = Date.now() }) {
    const formIds = new Set(forms.map((form) => form.templateId));
    const started = (templateId) => requests.some((request) => request.templateId === templateId
        && (statusOf(request) !== 'voided' || request.id === postApplicationRequestId(applicationId, templateId)));

    const notStarted = applicationId
        ? forms
            .filter((form) => form.required !== false && !started(form.templateId))
            .map((form) => ({
                key: postApplicationRequestId(applicationId, form.templateId),
                kind: 'form',
                templateId: form.templateId,
                title: form.title || 'Form',
                state: 'not_started',
                canSend: true,
            }))
        : [];

    const linked = [...requests]
        .sort((a, b) => (millisOf(b.createdAt) ?? 0) - (millisOf(a.createdAt) ?? 0))
        .map((request) => ({
            key: request.id,
            kind: 'request',
            request,
            templateId: request.templateId || null,
            title: request.title || 'Untitled document',
            state: signingDocumentState(request, now),
            canSend: canSendRequest(request, applicationId, formIds),
        }));

    return [...notStarted, ...linked];
}

const CHANNEL_WORDS = {
    email: 'by email',
    sms: 'by text message',
    both: 'by email and text message',
};

/** What a press of Send to driver did, from the callable's answer. */
export function sendResultMessage(data) {
    if (data?.outcome === 'already-sent') {
        return { tone: 'info', text: 'This form was already sent to the driver. Nothing was sent again.' };
    }
    if (data?.outcome === 'signed') {
        return { tone: 'info', text: 'The driver has already signed this form.' };
    }
    const { email, sms } = data?.channels || {};
    const channel = (email && sms && 'both') || (sms && 'sms') || 'email';
    return { tone: 'success', text: `Sent to the driver ${CHANNEL_WORDS[channel]}.` };
}

/** Why a press of Send to driver sent nothing. A refusal carries the server's own reason. */
export function sendErrorMessage(error) {
    const code = String(error?.code || '').replace(/^functions\//, '');
    if ((code === 'failed-precondition' || code === 'aborted' || code === 'not-found') && error?.message) {
        return error.message;
    }
    if (code === 'permission-denied') return 'You do not have access to send documents for this company.';
    return 'Could not send the form. Please try again.';
}
