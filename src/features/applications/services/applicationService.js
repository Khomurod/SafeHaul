import {
  collection,
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from "firebase/firestore";
import { db } from '@lib/firebase';

/** How many of a company's applications the Super Admin's list of them reads at a time. */
export const APPLICATIONS_PAGE_SIZE = 20;

const applicationsOf = (companyId) => collection(db, "companies", companyId, "applications");

/**
 * One page of a company's applications: `size` of them after `after` (the last
 * document of the page before), in document order. That order needs no index
 * and leaves no record out, as a date order would leave out a record without
 * the date. `next` is the page's last document while the page came back full,
 * else null.
 */
export async function loadApplicationsPage(companyId, { after = null, size = APPLICATIONS_PAGE_SIZE } = {}) {
  const cursor = after ? [startAfter(after)] : [];
  const { docs } = await getDocs(query(applicationsOf(companyId), orderBy(documentId()), ...cursor, limit(size)));
  return {
    applications: docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    next: docs.length === size ? docs[docs.length - 1] : null,
  };
}

/** How many applications a company has: a server count, no record read. */
export async function countApplications(companyId) {
  return (await getCountFromServer(applicationsOf(companyId))).data().count;
}
