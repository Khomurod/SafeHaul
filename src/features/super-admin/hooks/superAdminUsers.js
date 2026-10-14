/**
 * The owner panel's users, a page at a time: newest first, each with the
 * memberships Firestore holds for it. The first page and every "Load More from
 * Database" read the same way, so a later page carries its memberships too.
 */
import { collection, getDocs, limit, orderBy, query, startAfter, where } from 'firebase/firestore';
import { db } from '@lib/firebase';

export const USERS_PAGE_SIZE = 50;

/** The page of users after `cursor` (the last user document shown), or the first page. */
export function usersPageQuery(cursor) {
    const newestFirst = [collection(db, 'users'), orderBy('createdAt', 'desc')];
    return cursor
        ? query(...newestFirst, startAfter(cursor), limit(USERS_PAGE_SIZE))
        : query(...newestFirst, limit(USERS_PAGE_SIZE));
}

/**
 * Each user with its memberships. An `in` query takes ten ids, so they are read
 * ten users at a time; when they cannot be read, the users still show, with none.
 */
export async function withMemberships(users) {
    const membershipMap = new Map();
    try {
        const chunks = [];
        for (let i = 0; i < users.length; i += 10) {
            chunks.push(users.slice(i, i + 10).map((user) => user.id));
        }
        await Promise.all(chunks.map(async (chunk) => {
            const snap = await getDocs(query(collection(db, 'memberships'), where('userId', 'in', chunk)));
            snap.forEach((doc) => {
                const membership = doc.data();
                membershipMap.set(membership.userId, [...(membershipMap.get(membership.userId) || []), membership]);
            });
        }));
    } catch (memErr) {
        console.error('⚠️ Error fetching memberships:', memErr);
    }
    return users.map((user) => ({ ...user, memberships: membershipMap.get(user.id) || [] }));
}
