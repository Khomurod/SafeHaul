/**
 * "Email to driver": `mintApplicationInvite` with `deliver: 'email'`.
 *
 * The server mints the link as it always does — the same token, hash, expiry and
 * one live link (`./inviteTokens.js`) — and emails it to the draft's own
 * `contactEmail` instead of handing it back. The caller is told the masked
 * address and never the token, so no recruiter's screen holds this link (the
 * company's own mailbox may keep a copy in its Sent folder: the email goes out
 * through the company's SMTP account). Every rule
 * of the send is `shared/linkDelivery.js`'s; this file is when each one is
 * asked, and what the email says.
 *
 * What the link opens is unchanged. On answers the driver has written it still
 * asks them to confirm who they are (`./inviteIdentity.js`): the address of a
 * prepared application is one the carrier typed, so an email reaching it proves
 * nothing the identity check does not.
 *
 * The claim lives on the draft as `inviteDelivery`, written with the new hash in
 * the mint's transaction.
 */
const { INVITE_DAYS } = require('./inviteTokens');
const {
    appOriginFor, assertEmailAllowed, deliverableEmail, deliveryClaim, deliveryCoolingDown,
    emailSenderFor, linkEmailHtml, refusal, sendClaimedEmail,
} = require('../shared/linkDelivery');

const FIELD = 'inviteDelivery';
const LABEL = 'mintApplicationInvite';

/**
 * Everything asked before the mint: that the company can send email, and that
 * this caller and this application are within their limits. Throws the refusal;
 * nothing has been written.
 */
async function prepareInviteDelivery({ request, companyId, applicantKey, company }) {
    const sender = await emailSenderFor(companyId);
    if (!sender) throw refusal('email-not-configured');
    await assertEmailAllowed({ companyId, uid: request.auth.uid, recordKey: `invite_${companyId}_${applicantKey}` });
    return {
        uid: request.auth.uid,
        origin: appOriginFor(request.data?.appBaseUrl),
        // What the browser uses (`UnfinishedApplicationsPage`): the slug, else the id.
        slug: (typeof company?.appSlug === 'string' && company.appSlug.trim()) || companyId,
        companyName: sender.companyName,
    };
}

/**
 * In the mint's transaction, on the draft as read: the claim to write with the
 * new hash, or why nothing may be minted.
 */
function claimInviteDelivery(delivery, data, now) {
    const to = deliverableEmail(data.contactEmail);
    if (!to) return { refused: 'no-email' };
    if (deliveryCoolingDown(data[FIELD], now)) return { refused: 'just-sent' };
    return { to, record: deliveryClaim({ uid: delivery.uid, to, now }) };
}

function inviteEmail({ companyName, firstName, url, driverOwned }) {
    const greeting = `Hello ${firstName || 'there'},`;
    const footnote = `This link works for ${INVITE_DAYS} days and is meant for you alone, so please do not `
        + `forward it. If ${companyName} sends you a newer link, use that one. If you did not expect this `
        + 'email, you can ignore it.';
    if (driverOwned) {
        return {
            subject: `Continue your application with ${companyName}`,
            html: linkEmailHtml({
                heading: 'Continue your application',
                greeting,
                paragraphs: [
                    `You started a driver application with ${companyName}. This link takes you back to it.`,
                    'To keep it yours, it first asks you to confirm your last name, date of birth, Social '
                        + 'Security Number and your email or phone.',
                ],
                buttonLabel: 'Continue my application',
                url,
                footnote,
            }),
        };
    }
    return {
        subject: `${companyName} started your driver application`,
        html: linkEmailHtml({
            heading: 'Your driver application',
            greeting,
            paragraphs: [
                `${companyName} has started a driver application for you with what they already know.`,
                'Open it, add what only you can answer, review everything and sign.',
            ],
            buttonLabel: 'Open my application',
            url,
            footnote,
        }),
    };
}

/**
 * After the mint: the email, and the answer the caller gets — the masked address,
 * never the token or the link.
 */
async function sendInvite({ delivery, companyId, ref, claim, token, applicantKey, stored, driverOwned }) {
    const url = `${delivery.origin}/apply/${encodeURIComponent(delivery.slug)}`
        + `?invite=${encodeURIComponent(token)}&k=${encodeURIComponent(applicantKey)}`;
    const firstName = typeof stored?.formData?.firstName === 'string' ? stored.formData.firstName.trim().slice(0, 80) : '';
    const { subject, html } = inviteEmail({ companyName: delivery.companyName, firstName, url, driverOwned });
    const to = await sendClaimedEmail({
        companyId, ref, field: FIELD, claim: claim.record, to: claim.to, subject, html, label: LABEL,
    });
    return {
        delivered: { channel: 'email', to },
        applicantKey,
        expiresInDays: INVITE_DAYS,
        requiresIdentity: driverOwned,
    };
}

module.exports = { claimInviteDelivery, prepareInviteDelivery, sendInvite };
