/**
 * What the applicant signed about their previous employers, and whether a given
 * application carries it.
 *
 * The consent step's CERTIFICATION OF APPLICANT (`Step9_Consent.jsx`) holds a
 * release and the 49 CFR 391.23(d)-(e) notice, and the applicant signs beneath
 * it. A previous employment verification request prints that wording, word for
 * word, above the applicant's signature: a document sent to another company may
 * show a signature only under text its signer was shown. The parity test keeps
 * these paragraphs equal to the consent step's.
 *
 * The wording first shipped on 21 January 2026. An application signed before
 * 23 January 2026 (UTC) is treated as signed without it — the deploy time is not
 * recorded, and a release must never be claimed for a signer who was not shown it.
 */

const RELEASE_PARAGRAPHS = Object.freeze([
    'I authorize you to make such investigations and inquiries of my personal, employment, financial or medical history and other related matters as may be necessary in arriving at an employment decision. (Generally, inquiries regarding medical history will be made only if and after a conditional offer of employment has been extended.) I hereby release employers, schools, health care providers and other persons from all liability in responding to inquiries and releasing information in connection with my application.',
    'I understand that information I provide regarding current and/or previous employers may be used, and those employer(s) will be contacted, for the purpose of investigating my safety performance history as required by 49 CFR 391.23(d) and (e). I understand that I have the right to:',
]);

const RELEASE_RIGHTS = Object.freeze([
    'Review information provided by previous employers;',
    'Have errors in the information corrected by previous employers and for those previous employers to re-send the corrected information to the prospective employer; and',
    'Have a rebuttal statement attached to the alleged erroneous information, if the previous employer(s) and I cannot agree on the accuracy of the information.',
]);

const RELEASE_WORDING_SINCE = Date.parse('2026-01-23T00:00:00Z');

const TYPED_PREFIX = 'TEXT_SIGNATURE:';

/**
 * The instant the applicant signed, from the newest field that records it. The
 * signature is drawn at submission, so `submittedAt` is a signing time;
 * `createdAt` is not — an application can be created long before it is signed.
 */
function signedAtOf(application) {
    const candidates = [
        application?.signatureDate,
        application?.['signature-date'],
        application?.submittedAt,
    ];
    for (const value of candidates) {
        const ms = toMillis(value);
        if (ms !== null) return ms;
    }
    return null;
}

function toMillis(value) {
    if (!value) return null;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const ms = Date.parse(String(value));
    return Number.isNaN(ms) ? null : ms;
}

/**
 * The applicant's release on this application.
 *
 * @returns {{ status: 'signed' | 'unsigned' | 'predates-wording' | 'undated',
 *   signedAt: number | null, drawnImage: string | null, typedName: string | null }}
 */
function releaseOf(application) {
    const raw = typeof application?.signature === 'string' ? application.signature.trim() : '';
    const typedName = raw.startsWith(TYPED_PREFIX) ? raw.slice(TYPED_PREFIX.length).trim() || null : null;
    const drawnImage = !typedName && /^data:image\/(png|jpe?g);base64,/i.test(raw) ? raw : null;
    const signedAt = signedAtOf(application);
    const base = { signedAt, drawnImage: null, typedName: null };

    if (!typedName && !drawnImage) return { ...base, status: 'unsigned' };
    if (signedAt === null) return { ...base, status: 'undated' };
    if (signedAt < RELEASE_WORDING_SINCE) return { ...base, status: 'predates-wording' };
    return { status: 'signed', signedAt, drawnImage, typedName };
}

/** The applicant's name as the application records it, or null. */
function applicantNameOf(application) {
    const part = (key) => (typeof application?.[key] === 'string' ? application[key].trim() : '');
    const name = ['firstName', 'middleName', 'lastName', 'suffix'].map(part).filter(Boolean).join(' ');
    return name || null;
}

module.exports = {
    applicantNameOf,
    RELEASE_PARAGRAPHS,
    RELEASE_RIGHTS,
    RELEASE_WORDING_SINCE,
    releaseOf,
};
