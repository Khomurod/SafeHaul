/**
 * Public-profile lookup for the guest application.
 *
 * One responsibility: resolve a company's public profile from an application
 * link slug. Tries the `appSlug` field first, then falls back to treating the
 * slug as a raw document id (legacy links).
 */
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore';
import { db } from '@lib/firebase';

/**
 * @param {string} slug
 * @returns {Promise<object|null>} `{ id, ...profile }` or null when not found.
 */
export async function fetchPublicProfileBySlug(slug) {
  const q = query(collection(db, 'public_profiles'), where('appSlug', '==', slug), limit(1));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  }

  const docSnap = await getDoc(doc(db, 'public_profiles', slug));
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() };
  }
  return null;
}
