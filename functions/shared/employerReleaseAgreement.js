// functions/shared/employerReleaseAgreement.js
//
// The applicant's authorization for each previous employer to release its
// safety performance history to the carrier they are applying to.
//
// A prospective carrier must investigate every employer of the previous three
// years (49 CFR 391.23(d), (e)), and must give each one the driver's consent to
// release drug and alcohol information (391.23(f)(1), 40.25(f)). That consent
// must be "specific": one named organization releasing particular information to
// another named organization. A release to a category of parties, such as
// "previous employers", is a prohibited blanket release (40.321(b)). So the
// agreement carries one statement per employer the applicant listed, each naming
// that employer and the carrier, and the acceptance records which employers it
// was shown with.
//
// The site renders the same statements from the same rows
// (`src/shared/legal/employerReleaseAgreement.js`); the parity test keeps the two
// identical, because the text frozen at submission must be the text on screen.

const RELEASE_BODY_V3 = `AUTHORIZATION FOR PREVIOUS EMPLOYERS TO RELEASE INFORMATION

{{companyName}} ("Prospective Employer") must investigate my safety performance history with each employer I worked for during the three years before the date of this application (49 CFR 391.23).

The information covered is:
1. My dates of employment and the position I held.
2. Any accident I was involved in during those three years, as described in 49 CFR 390.15(b).
3. If I performed safety-sensitive functions subject to U.S. Department of Transportation drug and alcohol testing for that employer during those three years: any alcohol test with a result of 0.04 or higher alcohol concentration; any verified positive drug test; any refusal to be tested, including a verified adulterated or substituted drug test result; any other violation of DOT drug and alcohol testing regulations; and documentation of my completion of DOT return-to-duty requirements, including follow-up tests (49 CFR 391.23(e) and 40.25(b)).

Each authorization below names one employer. It permits that employer to release only this information, only to Prospective Employer, in answer to its request about this application.`;

const RELEASE_STATEMENT_V3 = 'I authorize {{employerName}} to release to {{companyName}} the information described above.';

/**
 * The registry entry (`legalAgreements.js`). Presented only to an applicant who
 * listed a previous employer. Its structure is the consent, so a company cannot
 * publish wording of its own for it (`companyWording: false`).
 */
const PREVIOUS_EMPLOYER_RELEASE = Object.freeze({
    id: 'previousEmployerRelease',
    presentedOn: 'consent',
    order: 5,
    required: true,
    requiresSignature: true,
    companyWording: false,
    title: 'AUTHORIZATION FOR PREVIOUS EMPLOYERS TO RELEASE INFORMATION',
    versions: {
        v3: { body: RELEASE_BODY_V3, employerStatement: RELEASE_STATEMENT_V3 },
    },
});

/**
 * The employers the applicant listed, as the statements name them: each row's
 * name (`companyName`, or the legacy `name`) with its spacing collapsed, once
 * each whatever its case, in the order listed.
 */
function releaseEmployerNames(employers) {
    const names = [];
    const seen = new Set();
    for (const row of Array.isArray(employers) ? employers : []) {
        const raw = row && typeof row === 'object' ? (row.companyName || row.name) : null;
        const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        names.push(name);
    }
    return names;
}

/** The agreement as presented: its body, then one numbered statement per employer. */
function withEmployerStatements(body, statement, names) {
    const lines = (Array.isArray(names) ? names : [])
        .map((name, index) => `${index + 1}. ${String(statement).replace(/\{\{employerName\}\}/g, name)}`);
    return lines.length > 0 ? `${body}\n\n${lines.join('\n')}` : body;
}

/** Whether an acceptance was given with exactly these employers on screen. */
function shownWithEmployers(evidence, names) {
    const shown = evidence && Array.isArray(evidence.employersShown) ? evidence.employersShown : null;
    return Boolean(shown) && shown.length === names.length && shown.every((name, index) => name === names[index]);
}

/**
 * A resolved agreement as this applicant was shown it. An agreement with a
 * statement per employer is shown with their own employers, and not at all to an
 * applicant who listed none (null). Its acceptance holds only with exactly those
 * employers on screen: a list edited since was not consented to.
 *
 * @returns {{ body: string, employers?: string[], holds: boolean } | null}
 */
function asPresented(resolved, evidence, employers) {
    if (typeof resolved.employerStatement !== 'string') return { body: resolved.body, holds: true };
    const names = releaseEmployerNames(employers);
    if (names.length === 0) return null;
    return {
        body: withEmployerStatements(resolved.body, resolved.employerStatement, names),
        employers: names,
        holds: shownWithEmployers(evidence, names),
    };
}

module.exports = {
    asPresented,
    PREVIOUS_EMPLOYER_RELEASE,
    RELEASE_BODY_V3,
    RELEASE_STATEMENT_V3,
    releaseEmployerNames,
    shownWithEmployers,
    withEmployerStatements,
};
