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
