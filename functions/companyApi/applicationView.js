/**
 * A submitted application as the company API returns it.
 *
 * Built from the frozen submission record (`submission/{version}`), never from
 * the live application document: the record is exactly what the driver saw,
 * answered and accepted, and later edits cannot reach it. Pure: the snapshot
 * and the key's scopes in, plain JSON out.
 *
 * What it never contains:
 *  - a storage path or a link, however the answer kept the file: a file is
 *    named, and its link comes from the documents endpoint, which checks the
 *    file and the scope first;
 *  - the full SSN, unless the key holds `ssn:read`: masked to its last four,
 *    as every screen shows it;
 *  - the signature image or an agreement's acceptance address: the record of
 *    acceptance is the PDF's job, which needs the SSN scope;
 *  - a repeating answer's raw stored rows: its rows are the ones the record
 *    froze, label and value as the driver's application showed them, so an
 *    internal value kept in a stored row cannot leave and a later change to
 *    the form cannot rewrite them.
 */

const { currentRepeatingColumns, resolveRepeatingRows } = require('../shared/submissionSnapshot');
const { isGuestUploadPath } = require('../shared/guestUploads');
const { hasScope } = require('./apiKeys');

const FILE_TYPES = new Set(['file', 'fileUpload']);
/** A link into Storage, or a path in it: how older versions of the app kept a file. */
const STORAGE_REFERENCE = /^(?:https?:\/\/(?:[a-z0-9-]+\.)*(?:firebasestorage|storage)\.googleapis\.com\/|gs:\/\/|companies\/[^/]+\/)/i;

/** `***-**-1234`, as the screens and the masked PDF show a Social Security Number. */
function maskSsn(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 4 ? `***-**-${digits.slice(-4)}` : '***-**-****';
}

const isFile = (value) => Boolean(value) && typeof value === 'object' && typeof value.storagePath === 'string';
const fileName = (value) => String(value?.name || value?.fileName || 'Uploaded file');
const isStorageReference = (value) => typeof value === 'string' && STORAGE_REFERENCE.test(value.trim());

/** A stored file, however the app kept it: `{ name, storagePath }` now; a bare link or path, or `{ name, url }`, before. */
const isUpload = (value) => isStorageReference(value) || isFile(value) || isStorageReference(value?.url);

/**
 * A stored file's own name. A link keeps the file's path inside it, slashes
 * encoded, so it is decoded before its last segment is taken.
 */
function uploadName(value) {
    if (typeof value !== 'string') return fileName(value);
    let text = value.trim().split(/[?#]/)[0];
    try {
        text = decodeURIComponent(text);
    } catch {
        // A name that does not decode is still a name.
    }
    return text.split('/').filter(Boolean).pop() || 'Uploaded file';
}

/**
 * An answer's value and display as the API gives them. A file is its name, with
 * the id the documents endpoint lists it under when it lists one, and never its
 * path or its link, however the answer kept them: a link can carry a credential,
 * and only the documents endpoint, which checks the permission, hands one out.
 * Everything else as the record keeps it.
 */
function valueOf(answer, id, listed) {
    const items = Array.isArray(answer.value) ? answer.value : [answer.value];
    if (!FILE_TYPES.has(answer.type) && !items.some(isUpload)) {
        return { value: answer.value ?? null, display: answer.displayValue ?? null };
    }
    const asFile = (item) => (item === null || item === undefined || item === ''
        ? null
        : { fileName: uploadName(item), ...(listed.has(id) ? { documentId: id } : {}) });
    const value = Array.isArray(answer.value) ? answer.value.map(asFile) : asFile(answer.value);
    const names = [value].flat().filter(Boolean).map((item) => item.fileName);
    return { value, display: names.length ? names.join(', ') : null };
}

/** Is this the full SSN (or another sensitive typed answer), present in the record? */
const isSensitiveValue = (answer) => Boolean(answer.sensitive) && !FILE_TYPES.has(answer.type)
    && answer.value !== null && answer.value !== undefined && String(answer.value).trim() !== '';

/**
 * Does the record hold a full SSN at all? A company can leave the field out, and
 * then nothing sensitive leaves, whatever the key may read.
 */
function holdsSsn(snapshot) {
    return (snapshot?.sections || []).some((section) => (section.answers || [])
        .some((answer) => answer.presented !== false && isSensitiveValue(answer)));
}

/**
 * A repeating answer's rows, each a list of `{ label, value }` as the record
 * froze them (`resolveRepeatingRows`, as the PDF and the review screen read
 * them). A record older than frozen rows is laid out under today's columns, and
 * says so, as those consumers do.
 */
function rowsOf(answer, columnsById) {
    const { rows, usedCurrentColumns } = resolveRepeatingRows(answer, columnsById);
    return {
        rows: rows.map((cells) => cells.map((cell) => ({ label: cell.label, value: cell.displayValue ?? null }))),
        usedCurrentColumns,
    };
}

function fieldOf(answer, { columnsById, showSsn, listed }) {
    if (answer.repeating) {
        const { rows, usedCurrentColumns } = rowsOf(answer, columnsById);
        return {
            id: answer.fieldId,
            label: answer.label,
            type: 'repeating',
            value: rows,
            display: null,
            ...(usedCurrentColumns ? { labelsAreCurrent: true } : {}),
        };
    }
    const masked = isSensitiveValue(answer) && !showSsn;
    return {
        id: answer.fieldId,
        label: answer.label,
        type: answer.type || 'text',
        ...(masked
            ? { value: maskSsn(answer.value), display: maskSsn(answer.value), masked: true }
            : valueOf(answer, answer.fieldId, listed)),
    };
}

/** The applicant's own details, gathered from the answers for a caller that wants only those. */
function applicantOf(sections) {
    const byId = new Map(sections.flatMap((section) => section.answers || []).map((answer) => [answer.fieldId, answer.value]));
    const text = (id) => (typeof byId.get(id) === 'string' && byId.get(id).trim() ? byId.get(id).trim() : null);
    return {
        firstName: text('firstName'),
        middleName: text('middleName'),
        lastName: text('lastName'),
        suffix: text('suffix'),
        email: text('email'),
        phone: text('phone'),
        dateOfBirth: text('dob'),
        address: { street: text('street'), city: text('city'), state: text('state'), zip: text('zip') },
    };
}

/**
 * Every file in the record this company's upload checks accept, as
 * `{ id, label, fileName, storagePath, sensitive }`. The path stays on the server:
 * it is what a link is signed for, never what a caller sees.
 */
function documentsOf(snapshot, companyId) {
    const found = [];
    for (const section of snapshot?.sections || []) {
        for (const answer of section.answers || []) {
            if (FILE_TYPES.has(answer.type) && isFile(answer.value)) {
                found.push({ id: answer.fieldId, label: answer.label, value: answer.value, sensitive: Boolean(answer.sensitive) });
            }
        }
    }
    for (const answer of snapshot?.customAnswers || []) {
        if (isFile(answer.value)) {
            found.push({ id: answer.questionId, label: answer.label || 'Uploaded file', value: answer.value, sensitive: false });
        }
    }
    return found
        .filter((item) => isGuestUploadPath(item.value.storagePath, companyId))
        .map((item) => ({
            id: item.id,
            label: item.label,
            fileName: fileName(item.value),
            storagePath: item.value.storagePath,
            sensitive: item.sensitive,
        }));
}

/** The documents a key may see: a sensitive one (the Social Security card) needs the SSN scope too. */
function documentsFor(snapshot, companyId, scopes) {
    if (!hasScope(scopes, 'documents:read')) return [];
    return documentsOf(snapshot, companyId).filter((item) => !item.sensitive || hasScope(scopes, 'ssn:read'));
}

/**
 * @param {object} opts
 * @param {object} opts.snapshot     The decoded submission record.
 * @param {object} opts.application  The live application document (status and confirmation number only).
 * @param {string} opts.applicationId
 * @param {string} opts.version      `v1` is the original; later ones are resubmissions.
 * @param {string} opts.companyId
 * @param {string[]} opts.scopes
 */
function toApiApplication({ snapshot, application = {}, applicationId, version, companyId, scopes }) {
    const showSsn = hasScope(scopes, 'ssn:read');
    const columnsById = currentRepeatingColumns();
    const sections = snapshot?.sections || [];
    const company = snapshot?.company || {};
    // The ids the documents endpoint lists files under, in documents, missing or withheld.
    const listed = new Set(documentsOf(snapshot, companyId).map((item) => item.id));
    return {
        id: applicationId,
        version,
        isOriginal: version === 'v1',
        submittedAt: snapshot?.submittedAt || null,
        confirmationNumber: application.confirmationNumber || null,
        status: application.status || null,
        company: {
            name: company.companyName || null,
            dba: company.dba || null,
            dotNumber: company.dotNumber || null,
            mcNumber: company.mcNumber || null,
        },
        applicant: applicantOf(sections),
        sections: sections.map((section) => ({
            id: section.id,
            title: section.title,
            fields: (section.answers || [])
                .filter((answer) => answer.presented !== false)
                .map((answer) => fieldOf(answer, { columnsById, showSsn, listed })),
        })),
        customQuestions: (snapshot?.customAnswers || []).map((answer) => ({
            id: answer.questionId,
            label: answer.label || null,
            type: answer.type || null,
            ...valueOf(answer, answer.questionId, listed),
        })),
        agreements: (snapshot?.agreements || []).map((agreement) => ({
            id: agreement.id,
            title: agreement.title,
            version: agreement.version,
            accepted: Boolean(agreement.accepted),
            acceptedAt: agreement.acceptedAt || null,
        })),
        employmentCoverage: snapshot?.employmentCoverage || null,
        // A record rebuilt for an application older than records says so, as
        // every consumer of one must: it may lack per-agreement proof.
        provenance: {
            source: snapshot?.provenance?.source || 'submission',
            notes: Array.isArray(snapshot?.provenance?.notes) ? snapshot.provenance.notes : [],
        },
        signature: snapshot?.signature
            ? { type: snapshot.signature.type || null, capturedAt: snapshot.signature.capturedAt || null, present: Boolean(snapshot.signature.present) }
            : null,
        documents: documentsFor(snapshot, companyId, scopes).map(({ id, label, fileName: name }) => ({ id, label, fileName: name })),
        // What left, not what the key may read: a record with no SSN sends none.
        ssnIncluded: showSsn && holdsSsn(snapshot),
    };
}

module.exports = { documentsFor, documentsOf, holdsSsn, maskSsn, toApiApplication };
