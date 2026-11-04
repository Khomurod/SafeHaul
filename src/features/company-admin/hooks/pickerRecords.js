/**
 * The applicants and leads the template wizard's picker offers: the newest
 * ones, or the matches for a search, found the way the Applications and leads
 * lists find them (a name from its start, two letters at least, or an exact
 * email or phone). Each row carries its `collectionName`, `applications` or
 * `leads`, so the picker can say which it is and the document can be linked to
 * it. The picker shows 20, and never reads every record of the company to do it.
 *
 * `useTemplateSendFlow` loads this module when the picker opens, so the
 * Documents workspace does not carry the lists' search code.
 */
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { runDashboardSearch } from '@features/companies/hooks/dashboardQueries';
import { classifySearchTerm, recordMatchesSearch, searchableTerm } from '@features/companies/hooks/dashboardSearch';

export const PICKER_RECORDS = 20;
const COLLECTIONS = Object.freeze(['applications', 'leads']);

const createdSeconds = (record) => {
    const createdAt = record?.createdAt;
    if (typeof createdAt?.seconds === 'number') return createdAt.seconds;
    return typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() / 1000 : 0;
};
const newestFirst = (lists) => lists.flat()
    .sort((a, b) => createdSeconds(b) - createdSeconds(a))
    .slice(0, PICKER_RECORDS);

async function newestOf(companyId, collectionName) {
    const { docs } = await getDocs(query(
        collection(db, 'companies', companyId, collectionName),
        orderBy('createdAt', 'desc'),
        limit(PICKER_RECORDS),
    ));
    return docs.map((record) => ({ id: record.id, ...record.data(), collectionName }));
}

async function matchesIn(companyId, collectionName, term) {
    const found = await runDashboardSearch({ companyId, activeTab: collectionName, term, filterContext: {} });
    return found.map((record) => ({ ...record, collectionName }));
}

export async function findPickerRecords(companyId, term) {
    // An empty box, or one letter of a name: the newest of both.
    const searching = Boolean(searchableTerm(term));
    return newestFirst(await Promise.all(COLLECTIONS.map((collectionName) => (searching
        ? matchesIn(companyId, collectionName, term)
        : newestOf(companyId, collectionName)))));
}

/** The same matching over records already in hand: the browser tests' fixture. */
export function matchPickerRecords(records, term) {
    const classified = classifySearchTerm(searchableTerm(term));
    return records.filter((record) => recordMatchesSearch(record, classified)).slice(0, PICKER_RECORDS);
}
