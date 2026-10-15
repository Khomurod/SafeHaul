import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from '@lib/firebase';

async function readPortalUser(userId) {
  const userDocSnap = await getDoc(doc(db, "users", userId));
  if (userDocSnap.exists()) {
    return userDocSnap.data();
  } else {
    console.error("No user document found for this user!");
    return null;
  }
}

// The signed-in user's profile, read once per sign-in: the top bar, the
// dashboard greeting and the notes tab all show its name. `auth.currentUser` is
// a new object at each sign-in, so a copy never outlives the session that read
// it. A failed or missing read is not kept.
let cached = null;

/**
 * A user's profile document, or null when there is none. Readers that only
 * show it share the session's copy; a form that edits it passes
 * `{ fresh: true }`, which reads the server and keeps that copy instead.
 */
export function getPortalUser(userId, { fresh = false } = {}) {
  if (!userId) return Promise.resolve(null);
  if (!fresh && cached?.userId === userId && cached.session === auth.currentUser) {
    return cached.promise;
  }
  const entry = { userId, session: auth.currentUser, promise: readPortalUser(userId) };
  cached = entry;
  const drop = () => {
    if (cached === entry) cached = null;
  };
  entry.promise.then((data) => { if (!data) drop(); }, drop);
  return entry.promise;
}

/** After a write to a profile, so its next reader reads it again; with no id, forgets whatever is kept. */
export function forgetPortalUser(userId) {
  if (!userId || cached?.userId === userId) cached = null;
}

export async function updateUser(userId, data, companyId = null) {
  if (!userId) return;

  // Use centralized functions instance
  const updatePortalUser = httpsCallable(functions, 'updatePortalUser');

  const result = await updatePortalUser({
    userId,
    companyId,
    name: data.name,
    email: data.email
  });
  forgetPortalUser(userId);

  return result.data;
}

export async function getMembershipsForUser(userId) {
  if (!userId) return null;
  const membershipsRef = collection(db, "memberships");
  const q = query(membershipsRef, where("userId", "==", userId));
  return await getDocs(q);
}

export async function addMembership(membershipData) {
  const q = query(
    collection(db, "memberships"),
    where("userId", "==", membershipData.userId),
    where("companyId", "==", membershipData.companyId)
  );
  const existing = await getDocs(q);
  if (!existing.empty) {
    throw new Error("User is already a member of this company.");
  }
  return await addDoc(collection(db, "memberships"), membershipData);
}

export async function updateMembershipRole(membershipId, newRole) {
  if (!membershipId) return;
  const membershipRef = doc(db, "memberships", membershipId);
  return await updateDoc(membershipRef, { role: newRole });
}

export async function deleteMembership(membershipId) {
  if (!membershipId) return;
  const membershipRef = doc(db, "memberships", membershipId);
  return await deleteDoc(membershipRef);
}
