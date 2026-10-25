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

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The calendar day the applicant signed on, `YYYY-MM-DD`, and whether it is
 * their own. The consent step records `signatureDay`, the day on the signer's
 * device as they signed; no time zone puts it more than a day from the signing
 * instant's UTC day, so one further away, or none (an application signed before
 * it was recorded), is dated by the instant in UTC.
 *
 * @returns {{ iso: string, local: boolean } | null}
 */
function signedDayOf(application) {
    const signedAt = signedAtOf(application);
    if (signedAt === null) return null;
    const utc = new Date(signedAt).toISOString().slice(0, 10);
    const match = ISO_DAY.exec(String(application?.signatureDay || ''));
    if (match) {
        const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        const real = new Date(ms).toISOString().slice(0, 10) === match[0];
        if (real && Math.abs(ms - Date.parse(`${utc}T00:00:00Z`)) <= DAY_MS) return { iso: match[0], local: true };
    }
    return { iso: utc, local: false };
}

/**
 * The applicant's release on this application.
 *
 * @returns {{ status: 'signed' | 'unsigned' | 'predates-wording' | 'undated',
 *   signedAt: number | null, drawnImage: string | null, typedName: string | null,
 *   signedDay?: { iso: string, local: boolean } }} `signedDay` when signed
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
    return { status: 'signed', signedAt, signedDay: signedDayOf(application), drawnImage, typedName };
}

/** The applicant's name as the application records it, or null. */
function applicantNameOf(application) {
    const part = (key) => (typeof application?.[key] === 'string' ? application[key].trim() : '');
    const name = ['firstName', 'middleName', 'lastName', 'suffix'].map(part).filter(Boolean).join(' ');
    return name || null;
}

/** Why no signed release is shown, for each status that has none. */
const RELEASE_NOTES = Object.freeze({
    unsigned: 'The application on file carries no applicant signature, so no signed release is attached.',
    undated: 'The application on file does not record when it was signed: the wording it was signed under '
        + 'cannot be confirmed, so no signed release is reproduced here.',
    'predates-wording': 'This application was signed before the release to previous employers was part of '
        + 'the application, so no signed release is reproduced here.',
});

module.exports = {
    applicantNameOf,
    RELEASE_NOTES,
    RELEASE_PARAGRAPHS,
    RELEASE_RIGHTS,
    RELEASE_WORDING_SINCE,
    releaseOf,
    signedDayOf,
};
