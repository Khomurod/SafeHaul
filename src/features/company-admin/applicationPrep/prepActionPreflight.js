import { isValidEmail, isValidPhone } from '@shared/utils/validation';

/**
 * What each action on the prepared-application screen needs before it can run,
 * and what to tell the recruiter when it is missing.
 *
 * ## Why this exists rather than a `disabled` attribute
 *
 * Save and "Create the driver's link" were `disabled` whenever their
 * prerequisites were unmet, and nothing on the screen said what those were. The
 * link's real precondition was *"save first"* — `canMint` was
 * `Boolean(prep.applicantKey)`, which only a save sets — and that sentence
 * appeared nowhere at all. The precise message for the other one already existed
 * and was unreachable: `functions/companyApplications/prepare.js` says "Enter the
 * driver's email or phone first — it identifies the application", and the client
 * guard is what stopped anyone ever seeing it. Found 2026-09-08.
 *
 * So the controls stay clickable and the click validates. Modelled on
 * `publicApplyPreflight.js` on the driver's side, which does the same job for
 * submission: a pure function that returns what is wrong and which field to go
 * to, leaving the routing and the rendering to the caller.
 *
 * `disabled` is still right for one thing — an operation genuinely in flight —
 * and that is the design system's `loading`, which also announces itself.
 *
 * ## What is NOT a prerequisite
 *
 * Almost everything. A prepared application is deliberately partial: a recruiter
 * who knows a name and a licence number saves a name and a licence number, and the
 * driver answers the rest. `prepare.js` validates nothing beyond company access,
 * an email or a phone, and the payload size, and an SSN or a signature cannot be
 * stored at all. Nothing here may add a requirement the server does not have.
 */

/** The three things a recruiter can press that need something first. */
export const PREP_ACTIONS = Object.freeze({
    SAVE: 'save',
    LINK: 'link',
    COPY: 'copy',
});

/**
 * Enough to identify the application: an email OR a phone, never both.
 *
 * The draft's id is `sha256(company:email:phone)`, so these are not contact
 * details, they are the address — which is why one is required and why a
 * malformed one matters. Neither the client nor the server checked the format
 * before, so `dana@` became an application's primary key.
 */
function identityProblems(formData) {
    const email = typeof formData?.email === 'string' ? formData.email.trim() : '';
    const phone = typeof formData?.phone === 'string' ? formData.phone.trim() : '';
    const problems = [];

    if (!email && !phone) {
        problems.push({
            fieldId: 'email',
            message: "Enter the driver's email address or mobile number first — it is what identifies "
                + 'this application. Either one on its own is enough.',
        });
        return problems;
    }
    if (email && !isValidEmail(email)) {
        problems.push({ fieldId: 'email', message: 'That email address does not look right. Check it, or clear it and use the phone number instead.' });
    }
    if (phone && !isValidPhone(phone)) {
        problems.push({ fieldId: 'phone', message: 'That mobile number does not look right. Check it, or clear it and use the email address instead.' });
    }
    return problems;
}

/**
 * @param {string} action one of `PREP_ACTIONS`
 * @param {{formData: object, applicantKey: ?string, dirty: boolean, hasLink: boolean}} state
 * @returns {{ok: boolean, problems: Array<{message: string, fieldId: ?string}>, needsSave: boolean}}
 *   `needsSave` says the only thing standing in the way is a save, which lets the
 *   caller offer to do it rather than telling the recruiter to go and press
 *   another button.
 */
export function prepActionPreflight(action, { formData, applicantKey, dirty, hasLink } = {}) {
    const problems = identityProblems(formData);

    if (action === PREP_ACTIONS.SAVE) {
        return { ok: problems.length === 0, problems, needsSave: false };
    }

    /*
     * A link addresses one saved document. Minting one for an unsaved edit hands
     * the driver the answers as they were, and — worse — minting after a contact
     * change hands them a link to a DIFFERENT record: `applicantKey` is the key of
     * the last save, so the screen would show the new email beside a link that
     * opens the old one, and `identityLocked` would then freeze that mismatch in
     * place. That is the hole this catches.
     */
    if (problems.length === 0 && (!applicantKey || dirty)) {
        return {
            ok: false,
            needsSave: true,
            problems: [{
                fieldId: null,
                message: applicantKey
                    ? 'Save your changes first, so the driver opens the version you are looking at.'
                    : 'Save this application first — the link opens the saved copy.',
            }],
        };
    }

    if (action === PREP_ACTIONS.COPY && problems.length === 0 && !hasLink) {
        return {
            ok: false,
            needsSave: false,
            problems: [{ fieldId: null, message: 'Create the link first, then you can copy it.' }],
        };
    }

    return { ok: problems.length === 0, problems, needsSave: false };
}

export default prepActionPreflight;
