import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  addDoc,
  query,
  where
} from "firebase/firestore";
import { db } from '@lib/firebase';
import { keptAnswer } from '@shared/utils/keptAnswer';
import { FLAT_DETAIL_KEYS } from './companyDetailKeys';

// Every company, as the Super Admin console's screens read it (the console's
// names and membership picker, Features, Activity, Create): one read shared by
// them, kept two minutes for this sign-in (`keptAnswer`). A failed read is not
// kept; a company write made through this service, or `forgetCompanies`, makes
// the next caller read again.
const everyCompany = keptAnswer();

/** Every company document (a query snapshot), shared as described above. */
export async function loadCompanies() {
  return everyCompany.read('companies', () => getDocs(collection(db, "companies")));
}

/** Forgets the kept companies, so the next `loadCompanies` reads them again. */
export function forgetCompanies() {
  everyCompany.forget();
}

export async function getCompanyProfile(companyId) {
  if (!companyId) return null;
  try {
    const docSnap = await getDoc(doc(db, "companies", companyId));
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching company profile for ${companyId}:`, error);
    return null;
  }
}

export async function createNewCompany(companyData) {
  const slugQuery = query(collection(db, "companies"), where("appSlug", "==", companyData.appSlug));
  const slugSnapshot = await getDocs(slugQuery);

  if (!slugSnapshot.empty) {
    throw new Error(`The URL Slug "${companyData.appSlug}" is already taken. Please choose a unique one.`);
  }

  const created = await addDoc(collection(db, "companies"), companyData);
  forgetCompanies();
  return created;
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
  const updated = await updateDoc(companyRef, companyData);
  forgetCompanies();
  return updated;
}

export async function saveCompanySettings(companyId, settingsData) {
  if (!companyId) throw new Error("Missing Company ID");
  const companyRef = doc(db, "companies", companyId);

  const payload = {};
  if (settingsData.companyName) payload.companyName = settingsData.companyName;
  if (settingsData.contact) payload.contact = settingsData.contact;
  if (settingsData.address) payload.address = settingsData.address;
  if (settingsData.legal) payload.legal = settingsData.legal;
  // The flat copies a company the older Create screen made holds, kept in step
  // with the nested details (companyDetailsFields).
  FLAT_DETAIL_KEYS.forEach((key) => {
    if (typeof settingsData[key] === 'string') payload[key] = settingsData[key];
  });
  if (settingsData.hiringPreferences) payload.hiringPreferences = settingsData.hiringPreferences;
  if (settingsData.structuredOffers) payload.structuredOffers = settingsData.structuredOffers;
  if (settingsData.customQuestions) {
    // DOMPurify (12 kB gzip) loads when questions are saved. Imported at the top,
    // it rode in every page's first download with the company chooser, which
    // imports this module for `getCompanyProfile`.
    const { sanitizeQuestionPayload } = await import('@shared/utils/sanitizeUserContent');
    payload.customQuestions = Array.isArray(settingsData.customQuestions)
      ? settingsData.customQuestions.map((q) => sanitizeQuestionPayload(q))
      : settingsData.customQuestions;
  }
  if (settingsData.companyLogoUrl) payload.companyLogoUrl = settingsData.companyLogoUrl;
  if (settingsData.driverTypes) payload.driverTypes = settingsData.driverTypes;
  // The people previous employment verification requests copy; an empty list clears it.
  if (Array.isArray(settingsData.pevCcEmails)) payload.pevCcEmails = settingsData.pevCcEmails;

  // NEW: Save application configuration (Required/Optional fields)
  if (settingsData.applicationConfig) payload.applicationConfig = settingsData.applicationConfig;

  if (settingsData.postApplicationTemplates) {
    payload.postApplicationTemplates = settingsData.postApplicationTemplates;
  }

  // Application Rules and optional integrations. Written only when
  // the company has them, so a company that never opened those tabs keeps the
  // platform defaults and its document is untouched.
  if (settingsData.applicationRules && typeof settingsData.applicationRules === 'object') {
    payload.applicationRules = settingsData.applicationRules;
  }
  if (settingsData.applicationIntegrations && typeof settingsData.applicationIntegrations === 'object') {
    payload.applicationIntegrations = settingsData.applicationIntegrations;
  }

  await updateDoc(companyRef, payload);
  forgetCompanies();
  // What was written, so a caller can show exactly that (cleaned, blanks left out).
  return payload;
}