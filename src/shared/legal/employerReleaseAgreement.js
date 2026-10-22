/**
 * The previous employers' release as the applicant is shown it: the server's
 * body, then one numbered statement naming each employer they listed.
 *
 * Mirrors `functions/shared/employerReleaseAgreement.js` (the parity test keeps
 * them equal): the server freezes the text it builds from the submitted rows,
 * and it must be the text that was on screen. Why one statement per employer:
 * that file's header (49 CFR 40.321(b)).
 */

/** Each row's name, spacing collapsed, once whatever its case, in order. */
export function releaseEmployerNames(employers) {
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
export function withEmployerStatements(body, statement, names) {
    const lines = (Array.isArray(names) ? names : [])
        .map((name, index) => `${index + 1}. ${String(statement).replace(/\{\{employerName\}\}/g, name)}`);
    return lines.length > 0 ? `${body}\n\n${lines.join('\n')}` : body;
}

/** Whether an acceptance was given with exactly these employers on screen. */
export function shownWithEmployers(evidence, names) {
    const shown = evidence && Array.isArray(evidence.employersShown) ? evidence.employersShown : null;
    return Boolean(shown) && shown.length === names.length && shown.every((name, index) => name === names[index]);
}
