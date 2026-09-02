// src/config/applicationLockedFields.js
//
// ESM mirror of `functions/shared/applicationLockedFields.js` — employers a carrier
// locked from a PSP report, and what the driver may still change about them. See
// the server copy for the full rationale. The body between the markers is
// byte-identical to it; `applicationLockedFields.test.js` fails if the two drift.

// --- body ---------------------------------------------------------------------
// Identical to functions/shared/applicationLockedFields.js. Edit both, or the parity test fails.

/**
 * How many employers one carrier may lock, and how much of each is compared.
 *
 * Matches `shared/companyPreparedDraft.js`, which writes the list. Two modules
 * because only this one crosses to the browser: the wizard has to know which rows
 * to render as fixed, and it must reach that answer the same way the server does.
 */
const MAX_LOCKED_EMPLOYERS = 25;
const MAX_LOCKED_TEXT = 120;

function lockedText(value, max = MAX_LOCKED_TEXT) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function lockedDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

/**
 * The identity of an employer row.
 *
 * The USDOT number when there is one, the normalised name otherwise — the same
 * order `carrierAlreadyListed` uses when it decides a suggestion is already on the
 * application, so "already listed" and "this is the locked one" can never disagree
 * about which rows are the same employer.
 *
 * @returns {string} `dot:123456`, `name:acme trucking`, or '' for a row with neither
 */
function employerSignature(row) {
    const dot = lockedDigits(row?.dotNumber);
    if (dot) return `dot:${dot}`;
    const name = lockedText(row?.companyName).toLowerCase().replace(/\s+/g, ' ');
    return name ? `name:${name}` : '';
}

/** The stored lock list, bounded and deduplicated. Rows with no identity are dropped. */
function normalizeLockedEmployers(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const seen = new Set();
    const locked = [];
    for (const row of list) {
        const signature = employerSignature(row);
        if (!signature || seen.has(signature)) continue;
        seen.add(signature);
        locked.push({
            signature,
            companyName: lockedText(row?.companyName),
            dotNumber: lockedDigits(row?.dotNumber),
        });
        if (locked.length >= MAX_LOCKED_EMPLOYERS) break;
    }
    return locked;
}

/** Which signatures the wizard must render as fixed. A Set, because rows ask one at a time. */
function lockedSignatureSet(lockedEmployers) {
    return new Set(normalizeLockedEmployers(lockedEmployers).map((entry) => entry.signature));
}

/** Is this row one the carrier locked? */
function isLockedEmployerRow(row, lockedEmployers) {
    const signature = employerSignature(row);
    return Boolean(signature) && lockedSignatureSet(lockedEmployers).has(signature);
}

/**
 * What is wrong with this application's employers, against what the carrier locked.
 *
 * A locked employer came from the driver's own PSP report: the carrier's name and
 * USDOT number are a matter of record, and the driver supplies the dates and the
 * reason for leaving rather than editing who they drove for. So exactly two things
 * are refused — a locked employer that is no longer on the application, and one
 * whose identity has been changed. Everything else about the row, and every row the
 * driver added themselves, is theirs.
 *
 * Returns issues in the same shape `evaluateApplicationRules` produces, so the
 * wizard, the pre-flight and the server say the same sentence in the same place.
 *
 * @param {Array} lockedEmployers as recorded on the prepared application
 * @param {object} formData the answers being checked
 * @returns {Array<{code: string, severity: string, semanticStep: string, fieldId: string, message: string}>}
 */
function lockedEmployerIssues(lockedEmployers, formData) {
    const locked = normalizeLockedEmployers(lockedEmployers);
    if (locked.length === 0) return [];

    const rows = Array.isArray(formData?.employers) ? formData.employers : [];
    const present = new Map();
    for (const row of rows) {
        const signature = employerSignature(row);
        if (signature && !present.has(signature)) present.set(signature, row);
    }

    const issues = [];
    for (const entry of locked) {
        const label = entry.companyName || `USDOT ${entry.dotNumber}`;
        const row = present.get(entry.signature);
        if (!row) {
            issues.push({
                code: 'locked-employer-missing',
                severity: 'block',
                semanticStep: 'employment',
                fieldId: 'employers',
                message: `${label} is on the report your carrier used to start this application, so it has to stay on it. Add the dates you worked there and why you left.`,
            });
            continue;
        }
        // The signature already proves the identifying half matches. What is left
        // is the other half: a row locked by USDOT number whose name was rewritten,
        // or one locked by name that has acquired a different number.
        const nameChanged = entry.companyName
            && lockedText(row.companyName).toLowerCase() !== entry.companyName.toLowerCase();
        const numberChanged = entry.dotNumber
            && lockedDigits(row.dotNumber) !== entry.dotNumber;
        if (nameChanged || numberChanged) {
            issues.push({
                code: 'locked-employer-changed',
                severity: 'block',
                semanticStep: 'employment',
                fieldId: 'employers',
                message: `${label} was added by your carrier from your safety record, so its name and USDOT number cannot be changed. You can still add the dates and why you left.`,
            });
        }
    }
    return issues;
}

// --- exports -------------------------------------------------------------------

export {
    MAX_LOCKED_EMPLOYERS,
    employerSignature,
    isLockedEmployerRow,
    lockedEmployerIssues,
    lockedSignatureSet,
    normalizeLockedEmployers,
};
