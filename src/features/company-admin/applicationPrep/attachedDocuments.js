import { DOCUMENT_FIELD_KINDS } from './extraction/documentExtractionPipeline';

/**
 * The files the recruiter attached, as the extraction pipeline wants them.
 *
 * Its own module because it is not a component, and a file that exports both
 * loses fast refresh for the component — the same reason `EMPTY_EMPLOYER` has one.
 *
 * ## Attached is not the same as readable
 *
 * An upload leaves `{name, url, storagePath}` in the form data and nothing else:
 * the bytes went to Storage, and the metadata object has no `type` and no
 * `arrayBuffer`. Handing that to the pipeline is how every real upload came back
 * as "None of the attached files could be opened" while the tests, which pass
 * `File` objects, read them perfectly.
 *
 * So the bytes are tracked separately, by the screen that owns the upload, and
 * the two are paired here: `attached` is what the application holds, `file` is the
 * `File` this tab still has for it. A draft re-opened in a later session has the
 * first without the second, which is a document the recruiter must attach again
 * to have it read — said out loud rather than reported as an unopenable file.
 *
 * @param {object} files the prepared application's form data, keyed by upload field
 * @param {object} [blobs] the `File` objects this tab holds, keyed by upload field
 * @returns {Array<{field: string, kind: string, attached: object, file: File|undefined}>}
 */
export function attachedDocuments(files, blobs) {
    return Object.entries(DOCUMENT_FIELD_KINDS)
        .map(([field, kind]) => ({
            field,
            kind,
            attached: files?.[field],
            file: blobs?.[field],
        }))
        .filter((entry) => entry.attached);
}

export default attachedDocuments;
