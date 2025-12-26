import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  addDoc, 
  query, 
  where, 
  documentId 
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from '@lib/firebase';

export async function loadCompanies() {
  return await getDocs(collection(db, "companies"));
}

export async function getCompaniesFromIds(companyIds) {
  if (!companyIds || companyIds.length === 0) return null;
  const companyRef = collection(db, "companies");
  const q = query(companyRef, where(documentId(), "in", companyIds));
  return await getDocs(q);
}

export async function getCompanyProfile(companyId) {
  if (!companyId) return null;
  try {
      const getProfile = httpsCallable(functions, 'getCompanyProfile');
      const result = await getProfile({ companyId: companyId });
      return result.data;
  } catch (error) {
      console.error(`Error calling getCompanyProfile function for ${companyId}:`, error);
      return null;
  }
}

export async function createNewCompany(companyData) {
  const slugQuery = query(collection(db, "companies"), where("appSlug", "==", companyData.appSlug));
  const slugSnapshot = await getDocs(slugQuery);

  if (!slugSnapshot.empty) {
      throw new Error(`The URL Slug "${companyData.appSlug}" is already taken. Please choose a unique one.`);
  }

  return await addDoc(collection(db, "companies"), companyData);
}

export async function updateCompany(companyId, companyData, originalSlug) {
  if (companyData.appSlug && originalSlug && companyData.appSlug !== originalSlug) {
      const slugQuery = query(collection(db, "companies"), where("appSlug", "==", companyData.appSlug));
      const slugSnapshot = await getDocs(slugQuery);

      let isSameDoc = false;
      slugSnapshot.forEach(doc => {
          if (doc.id === companyId) isSameDoc = true;
      });

      if (!slugSnapshot.empty && !isSameDoc) {
           throw new Error(`The URL Slug "${companyData.appSlug}" is already taken. Please choose a unique one.`);
      }
  }

  const companyRef = doc(db, "companies", companyId);
  return await updateDoc(companyRef, companyData);
}

export async function saveCompanySettings(companyId, settingsData) {
  if (!companyId) throw new Error("Missing Company ID");
  const companyRef = doc(db, "companies", companyId);

  const payload = {};
  if (settingsData.companyName) payload.companyName = settingsData.companyName;
  if (settingsData.contact) payload.contact = settingsData.contact;
  if (settingsData.address) payload.address = settingsData.address;
  if (settingsData.legal) payload.legal = settingsData.legal;
  if (settingsData.hiringPreferences) payload.hiringPreferences = settingsData.hiringPreferences;
  if (settingsData.structuredOffers) payload.structuredOffers = settingsData.structuredOffers;
  if (settingsData.customQuestions) payload.customQuestions = settingsData.customQuestions;
  if (settingsData.companyLogoUrl) payload.companyLogoUrl = settingsData.companyLogoUrl;
  if (settingsData.driverTypes) payload.driverTypes = settingsData.driverTypes;

  // NEW: Save application configuration (Required/Optional fields)
  if (settingsData.applicationConfig) payload.applicationConfig = settingsData.applicationConfig;

  // NEW: Save hiring positions structure
  if (settingsData.hiringPositions) payload.hiringPositions = settingsData.hiringPositions;

  return await updateDoc(companyRef, payload);
}