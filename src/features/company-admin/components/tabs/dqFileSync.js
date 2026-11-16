import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Asks the server to file the record's uploads that no DQ record holds yet
 * (`syncDqFiles`, the same filing the application's triggers do). The server
 * writes them: the DQ tab only reads its records, and uploads and removes the
 * files it adds itself.
 *
 * @returns {Promise<number>} how many records the server wrote
 */
export async function fileDriverUploads({ companyId, collectionName, applicationId }) {
  const { data } = await httpsCallable(functions, 'syncDqFiles')({ companyId, collectionName, applicationId });
  return Number(data?.filed) || 0;
}

/** `companyId/collection/id` -> its filing while it runs, then that it finished. Memory only. */
const filings = new Map();

/**
 * `fileDriverUploads` once a record while the dossier is open: the DQ tab's
 * first opening asks the server, a later one joins a filing still running, and
 * after one that finished it asks nothing and answers 0 (the tab's own read of
 * the list, made after it, already sees what was filed). A failed filing is not
 * kept, so the next opening tries again. The dossier forgets every filing when
 * it closes (`forgetDriverUploadFilings`), so each opening of it files anew.
 *
 * @returns {Promise<number>} how many records this call's filing wrote
 */
export function fileDriverUploadsOnce(record) {
  const key = `${record.companyId}/${record.collectionName}/${record.applicationId}`;
  const held = filings.get(key);
  if (held) return held.done ? Promise.resolve(0) : held.filing;
  const entry = { filing: fileDriverUploads(record), done: false };
  filings.set(key, entry);
  entry.filing.then(
    () => { entry.done = true; },
    () => { if (filings.get(key) === entry) filings.delete(key); },
  );
  return entry.filing;
}

/** The dossier closed: its next opening files each record's uploads again. */
export function forgetDriverUploadFilings() {
  filings.clear();
}
