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
import { db, functions } from '@lib/firebase';

export async function getPortalUser(userId) {
  if (!userId) return null;
  const userDocRef = doc(db, "users", userId);
  const userDocSnap = await getDoc(userDocRef);
  if (userDocSnap.exists()) {
    return userDocSnap.data();
  } else {
    console.error("No user document found for this user!");
    return null;
  }
}

import { httpsCallable } from "firebase/functions";

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
