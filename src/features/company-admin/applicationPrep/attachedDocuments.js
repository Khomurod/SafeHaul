import { DOCUMENT_FIELD_KINDS } from './extraction/documentExtractionPipeline';

/**
 * The files the recruiter attached, as the extraction pipeline wants them.
 *
 * Its own module because it is not a component, and a file that exports both
 * loses fast refresh for the component — the same reason `EMPTY_EMPLOYER` has one.
 *
 * @param {object} files the prepared application's form data, keyed by upload field
 * @returns {Array<{kind: string, file: object}>} only the slots that hold something
 */
export function attachedDocuments(files) {
    return Object.entries(DOCUMENT_FIELD_KINDS)
        .map(([field, kind]) => ({ kind, file: files?.[field] }))
        .filter((entry) => entry.file);
}

export default attachedDocuments;
