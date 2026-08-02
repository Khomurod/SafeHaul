import { collection, getDocs, query } from "firebase/firestore";
import { db } from '@lib/firebase';

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
