/**
 * The leads the template wizard's picker offers: the newest ones, or the
 * matches for a search, found the way the leads list finds them (a name from
 * its start, an exact email or phone). The picker shows 20, and never reads
 * every lead of the company to do it.
 *
 * `useTemplateSendFlow` loads this module when the picker opens, so the
 * Documents workspace does not carry the list's search code.
 */
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { runDashboardSearch } from '@features/companies/hooks/dashboardQueries';
import { classifySearchTerm, recordMatchesSearch } from '@features/companies/hooks/dashboardSearch';

export const PICKER_LEADS = 20;

export async function findPickerLeads(companyId, term) {
    if (!String(term ?? '').trim()) {
        const { docs } = await getDocs(query(
            collection(db, 'companies', companyId, 'leads'),
            orderBy('createdAt', 'desc'),
            limit(PICKER_LEADS),
        ));
        return docs.map((lead) => ({ id: lead.id, ...lead.data() }));
    }
    const found = await runDashboardSearch({ companyId, activeTab: 'leads', term, filterContext: {} });
    return found.slice(0, PICKER_LEADS);
}

/** The same matching over leads already in hand: the browser tests' fixture. */
export function matchPickerLeads(leads, term) {
    const classified = classifySearchTerm(term);
    return leads.filter((lead) => recordMatchesSearch(lead, classified)).slice(0, PICKER_LEADS);
}
