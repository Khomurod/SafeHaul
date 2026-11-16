import { db } from '@lib/firebase';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';

/**
 * After a lead import: one bell notification per recruiter it gave new leads
 * to, saying how many ("15 leads assigned to you"), instead of one per lead.
 * The leads are created already assigned, so the assignment trigger never sees
 * them (`functions/notificationTriggers.js` watches updates only).
 *
 * Written by the importer, a company admin (the import page is admin-only),
 * whom the rules let create notifications. None for leads the importer gave
 * themselves: nobody is told about their own action. A count only, since the
 * whole team can read every notification. A failure is logged and the import
 * stands.
 *
 * @param {string} companyId
 * @param {Map<string, number>} counts recruiter uid → new leads assigned to them
 * @param {string} importerId the uid of the admin who ran the import
 */
export async function noticeImportAssignments(companyId, counts, importerId) {
    const recipients = [...counts].filter(([uid, count]) => uid && uid !== importerId && count > 0);
    if (recipients.length === 0) return;
    try {
        const notifications = collection(db, 'companies', companyId, 'notifications');
        const batch = writeBatch(db);
        recipients.forEach(([recipientId, count]) => {
            batch.set(doc(notifications), {
                type: 'leads_assigned',
                title: 'Leads Assigned',
                message: `${count} ${count === 1 ? 'lead' : 'leads'} assigned to you`,
                recipientId,
                count,
                actorId: importerId,
                read: false,
                createdAt: serverTimestamp(),
            });
        });
        await batch.commit();
    } catch (error) {
        console.error('[useCompanyLeadUpload] Could not tell the recruiters about their imported leads:', error);
    }
}
