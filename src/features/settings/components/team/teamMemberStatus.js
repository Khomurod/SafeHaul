/**
 * How a member record that is not simply healthy is described.
 *
 * Each of these once rendered as a normal-looking row reading "Unknown / No
 * Email", so an admin could not tell a member whose profile merely lacked a name
 * from a membership pointing at an account that no longer exists.
 * `listCompanyTeam` returns the distinction; this maps it to plain language.
 */
export const MEMBER_STATUS = {
    auth_missing: {
        tone: 'danger',
        label: 'No sign-in account',
        detail: 'This membership points to an account that no longer exists. Remove it, or re-invite the person.',
    },
    unreadable: {
        tone: 'warning',
        label: 'Profile unreadable',
        detail: 'Their profile record could not be read, so these details may be out of date.',
    },
    unidentified: {
        tone: 'warning',
        label: 'No name or email',
        detail: 'This account has no name or email recorded anywhere. Ask them to sign in, or remove and re-invite.',
    },
};

const ROLE_LABELS = { company_admin: 'Company admin', hr_user: 'Recruiter' };

/** A membership role in the page's words. */
export function roleLabel(role) {
    return ROLE_LABELS[role] || role || '—';
}

/**
 * The best name a member has: their name, else their email, else a plain
 * statement that the record has no identity — never an invented "Unknown".
 */
export function teamMemberName(member) {
    return member.name || member.email || 'Unnamed member';
}
