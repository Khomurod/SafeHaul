const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if employer row has at least one plausible phone (10+ digits) or valid-looking email. */
export function employerRowHasVerifierContact(employer) {
    if (!employer || typeof employer !== 'object') return false;
    const phoneDigits = String(employer.phone || '').replace(/\D/g, '');
    const supervisorDigits = String(employer.supervisorPhone || '').replace(/\D/g, '');
    const ce = String(employer.companyEmail || '').trim();
    const se = String(employer.supervisorEmail || '').trim();
    return (
        phoneDigits.length >= 10 ||
        supervisorDigits.length >= 10 ||
        (ce.length > 0 && SIMPLE_EMAIL.test(ce)) ||
        (se.length > 0 && SIMPLE_EMAIL.test(se))
    );
}

/** The end dates the step writes: `YYYY-MM-DD`, or `YYYY-MM`. */
const END_MONTH = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/;

/**
 * True only when an employer row's own end date places the job before the three
 * years 49 CFR 391.21(b)(10) asks about, so a current job, a row whose dates are
 * not filled in yet, or a date it cannot read is still asked about. Counted in
 * months, with the month three years back inside, so no job of those three
 * years is left out by days.
 */
export function endedBeforeLastThreeYears(employer, today = new Date()) {
    const match = END_MONTH.exec(String(employer?.endDate ?? '').trim());
    const month = match ? Number(match[2]) : 0;
    if (month < 1 || month > 12) return false;
    const end = Number(match[1]) * 12 + month - 1;
    return end < today.getFullYear() * 12 + today.getMonth() - 36;
}

const isBlankAnswer = (value) => String(value ?? '').trim() === '';

/**
 * What an employer row still owes the questions the Employment page requires:
 * the reason for leaving, and the two 49 CFR 391.21(b)(10)(iv) answers for a
 * job of the past three years. The page asks them; the submission pre-flight
 * uses this for a draft resumed past the page before it asked them.
 */
export function employerRowMissingAnswers(employer, today = new Date()) {
    const missing = [];
    if (isBlankAnswer(employer?.reasonForLeaving)) missing.push('the reason for leaving');
    if (!endedBeforeLastThreeYears(employer, today)) {
        if (isBlankAnswer(employer?.subjectToFmcsrs)) missing.push('whether you were subject to the FMCSRs');
        if (isBlankAnswer(employer?.subjectToDotTesting)) missing.push('whether the job was subject to DOT drug and alcohol testing');
    }
    return missing;
}
