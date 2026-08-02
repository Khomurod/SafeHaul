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
