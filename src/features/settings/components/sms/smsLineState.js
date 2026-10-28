import { MISSING_TOKEN, sanitizePhone } from '../../utils/linePhone';

/**
 * The line a team member texts from, as the token its `<select>` shows: an edit
 * first, else the saved phone's line, else the saved token (which survives a
 * browser that hides phone numbers), else `MISSING_TOKEN` for a saved phone that
 * is not among the synced lines. `''` means the default line.
 */
export function memberLineToken(userId, {
    assignments, assignmentTokenOverrides, savedAssignmentTokens, tokenForPhone, resolveLineToken,
}) {
    const currentPhone = sanitizePhone(assignments[userId] || '');
    return assignmentTokenOverrides[userId]
        ?? (tokenForPhone(currentPhone)
            || resolveLineToken(savedAssignmentTokens[userId])
            || (currentPhone ? MISSING_TOKEN : ''));
}

/** A member's name as the page shows it. */
export function memberName(user) {
    return user.name || user.fullName || user.email;
}

/** Line token → the members who text from it, in roster order. */
export function membersByLine(users, lineState) {
    const byLine = {};
    users.forEach((user) => {
        const token = memberLineToken(user.id, lineState);
        if (!token || token === MISSING_TOKEN) return;
        (byLine[token] ||= []).push(user);
    });
    return byLine;
}

/**
 * One line for the save bar: who changed and whether the default did, e.g.
 * "2 changes · Artificial Recruiter, Artificial Admin · Default line changed".
 */
export function changeSummary(users, { assignmentTokenOverrides, defaultTokenOverride }) {
    const parts = [];
    const changedIds = Object.keys(assignmentTokenOverrides);
    if (changedIds.length > 0) {
        const names = changedIds.map((id) => {
            const user = users.find((u) => u.id === id);
            return user ? memberName(user) : 'A former member';
        });
        const shown = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', ');
        parts.push(`${changedIds.length} ${changedIds.length === 1 ? 'change' : 'changes'} · ${shown}`);
    }
    if (defaultTokenOverride !== null) parts.push('Default line changed');
    return parts.join(' · ') || 'Unsaved changes';
}
