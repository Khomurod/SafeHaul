import { 
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  updateDoc, 
  addDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  serverTimestamp 
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from '@lib/firebase';

export async function loadApplications(companyId) {
  if (!companyId) {
      console.error("No Company ID provided to loadApplications");
      return [];
  }
  const nestedAppsRef = collection(db, "companies", companyId, "applications");
  const nestedQuery = query(nestedAppsRef);
  const nestedSnapshot = await getDocs(nestedQuery);
  const appList = [];
  nestedSnapshot.forEach(doc => {
      appList.push({
          id: doc.id,
          ...doc.data(),
          isNestedApp: true
      });
  });
  return appList;
}

export async function loadCompanyLeads(companyId) {
  if (!companyId) return [];
  const leadsRef = collection(db, "companies", companyId, "leads");
  const q = query(leadsRef, orderBy("createdAt", "desc"));
  try {
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
          const data = doc.data();
          return {
              id: doc.id,
              ...data,
              isPlatformLead: data.isPlatformLead !== false 
          };
      });
  } catch (error) {
      console.error("Error loading leads:", error);
      return [];
  }
}

export async function getApplicationDoc(companyId, applicationId) {
  const docRef = doc(db, "companies", companyId, "applications", applicationId);
  return await getDoc(docRef);
}

export async function updateApplicationData(companyId, applicationId, data, collectionName = 'applications') {
  const docRef = doc(db, "companies", companyId, collectionName, applicationId);
  return await updateDoc(docRef, data);
}

export async function updateApplicationStatus(companyId, applicationId, newStatus, collectionName = 'applications') {
  const docRef = doc(db, "companies", companyId, collectionName, applicationId);
  await updateDoc(docRef, { status: newStatus });
}

export async function deleteApplication(companyId, applicationId, collectionName = 'applications') {
  let docRef;
  if (companyId === 'general-leads') {
      const targetCollection = (collectionName === 'drivers' || collectionName === 'leads') ? collectionName : 'leads';
      docRef = doc(db, targetCollection, applicationId);
  } else {
      docRef = doc(db, "companies", companyId, collectionName, applicationId);
  }
  return await deleteDoc(docRef);
}

export async function moveApplication(sourceCompanyId, destinationCompanyId, applicationId) {
  if (!sourceCompanyId || !destinationCompanyId || !applicationId) {
      throw new Error("Missing parameters for moving application.");
  }
  const moveApp = httpsCallable(functions, 'moveApplication');
  return await moveApp({
      sourceCompanyId,
      destinationCompanyId,
      applicationId,
      isSourceNested: true 
  });
}

export async function getApplicationNotes(companyId, applicationId, collectionName = 'applications') {
  const notesRef = collection(db, "companies", companyId, collectionName, applicationId, "internal_notes");
  const q = query(notesRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
  }));
}

export async function addApplicationNote(companyId, applicationId, noteText, authorName, collectionName = 'applications') {
  const notesRef = collection(db, "companies", companyId, collectionName, applicationId, "internal_notes");
  await addDoc(notesRef, {
      text: noteText,
      author: authorName,
      createdAt: serverTimestamp(),
      type: 'note'
  });
}
