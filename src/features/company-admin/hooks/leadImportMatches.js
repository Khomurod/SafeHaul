import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@lib/firebase';

/** Firestore's limit on the values of one `in` filter. */
const VALUES_PER_QUERY = 30;
/** Lookups in flight at once. */
const QUERIES_AT_ONCE = 10;

const hasRealEmail = (row) => !row.isEmailPlaceholder && Boolean(row.email);

function inGroups(values, size) {
    const groups = [];
    for (let i = 0; i < values.length; i += size) groups.push(values.slice(i, i + size));
    return groups;
}

/**
 * The company's leads that a file's rows already match, read in batches: every
 * email the rows give (placeholders aside) and every normalized phone, 30 to a
 * query and up to 10 queries at a time, instead of one or two queries per row.
 * A value two leads share maps to the lowest id, the one a single equality
 * query returned first.
 *
 * `match(row)` answers a row as the import always has: by its email, else by
 * its phone. `remember(row, lead)` files the lead a row created or updated under
 * the row's email and phone, so a later row of the same file finds it; a value
 * already filed keeps its lead.
 */
export async function matchExistingLeads(companyId, rows) {
    const leadsRef = collection(db, 'companies', companyId, 'leads');
    const byEmail = new Map();
    const byPhone = new Map();
    const emails = [...new Set(rows.filter(hasRealEmail).map((row) => row.email))];
    const phones = [...new Set(rows.map((row) => row.normalizedPhone).filter(Boolean))];
    const lookups = [
        ...inGroups(emails, VALUES_PER_QUERY).map((values) => ({ field: 'email', values, found: byEmail })),
        ...inGroups(phones, VALUES_PER_QUERY).map((values) => ({ field: 'normalizedPhone', values, found: byPhone })),
    ];

    for (let start = 0; start < lookups.length; start += QUERIES_AT_ONCE) {
        const wave = lookups.slice(start, start + QUERIES_AT_ONCE);
        const answers = await Promise.all(wave.map(({ field, values }) => getDocs(query(leadsRef, where(field, 'in', values)))));
        answers.forEach((answer, index) => {
            const { field, found } = wave[index];
            answer.docs.forEach((leadDoc) => {
                const value = leadDoc.data()[field];
                const filed = found.get(value);
                if (!filed || leadDoc.id < filed.id) found.set(value, leadDoc);
            });
        });
    }

    return {
        match: (row) => (hasRealEmail(row) && byEmail.get(row.email))
            || (row.normalizedPhone && byPhone.get(row.normalizedPhone))
            || null,
        remember: (row, lead) => {
            if (hasRealEmail(row) && !byEmail.has(row.email)) byEmail.set(row.email, lead);
            if (row.normalizedPhone && !byPhone.has(row.normalizedPhone)) byPhone.set(row.normalizedPhone, lead);
        },
    };
}
