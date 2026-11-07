/**
 * The frozen submission record,
 * `companies/{companyId}/applications/{applicationId}/submission/{snapshotId}`,
 * read once while the dossier is open and shared by the two places that show
 * it: the Application tab's original (`useSubmissionRecord`) and the DQ row's
 * consents (`OriginalApplicationConsents`). Without this, each return to either
 * tab read the whole application again.
 *
 * Only the server writes the record, and only by creating it
 * (`writeSubmissionSnapshot`; client writes are denied by rules), so a record
 * read is the record. It is still kept no longer than the dossier is open:
 * deleting an application deletes its record, and the same driver applying
 * again gets the same application id, so a new record can be written at the
 * same path. The dossier forgets every record when it closes
 * (`forgetSubmissionRecords`). A missing record is not kept, since it may yet
 * be written (a carrier-prepared application the driver submits, a
 * reconstruction), and neither is a failed read. Memory only; another sign-in
 * starts empty.
 */
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@lib/firebase';

/** Full path -> the read in flight, or the record it found. */
const held = new Map();
/** The `auth.currentUser` the held records were read for: a new object at each sign-in. */
let heldFor = null;

/**
 * @param {{ companyId: string, applicationId: string, snapshotId: string }} ids
 * @returns {Promise<object|null>} the stored record, or null when there is none
 */
export function readSubmissionRecord({ companyId, applicationId, snapshotId }) {
    if (auth.currentUser !== heldFor) {
        held.clear();
        heldFor = auth.currentUser;
    }
    const segments = ['companies', companyId, 'applications', applicationId, 'submission', snapshotId];
    const path = segments.join('/');
    const kept = held.get(path);
    if (kept) return kept;

    const read = getDoc(doc(db, ...segments)).then((snap) => (snap.exists() ? snap.data() : null));
    held.set(path, read);
    const drop = () => { if (held.get(path) === read) held.delete(path); };
    read.then((record) => { if (record === null) drop(); }, drop);
    return read;
}

/** The dossier closed: the next opening reads each record anew. */
export function forgetSubmissionRecords() {
    held.clear();
    heldFor = null;
}
