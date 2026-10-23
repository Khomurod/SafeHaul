/**
 * The recruiter an application's link names, checked against the company it was
 * submitted to.
 *
 * A link carries `recruiterCode`: a `recruiter_links` code (`?r=`), or a user id
 * from the older `?recruiter=` link. Only a member of this company's team is
 * assigned; a code for another company, a code nobody owns, or a user outside
 * the team assigns nobody, rather than writing the code itself as `assignedTo`.
 */

const CODE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} companyId
 * @param {unknown} code
 * @returns {Promise<{ assignedTo: string, assignedToName: string } | null>}
 */
async function resolveRecruiterAssignment(db, companyId, code) {
    const value = typeof code === 'string' ? code.trim() : '';
    if (!companyId || !CODE.test(value)) return null;

    const linkSnap = await db.collection('recruiter_links').doc(value).get();
    let userId = value;
    if (linkSnap.exists) {
        const link = linkSnap.data() || {};
        if (link.companyId !== companyId || typeof link.userId !== 'string' || !link.userId) return null;
        userId = link.userId;
    }

    const [membershipSnap, userSnap] = await Promise.all([
        db.collection('memberships')
            .where('userId', '==', userId)
            .where('companyId', '==', companyId)
            .limit(1)
            .get(),
        db.collection('users').doc(userId).get(),
    ]);
    if (membershipSnap.empty) return null;

    const user = userSnap.exists ? userSnap.data() || {} : {};
    // The lists show an assignee only with a name, so a member without one is
    // named by their email, as the team pickers do.
    const name = String(user.name || user.displayName || user.email || '').trim();
    if (!name) return null;
    return { assignedTo: userId, assignedToName: name };
}

module.exports = { resolveRecruiterAssignment };
