import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from '@lib/firebase';
import { 
    fetchDriverProfile, 
    fetchMyApplications, 
    fetchRecommendedJobs, 
    getSavedJobs 
} from '../services/driverService';

export function useDriverDashboard() {
  const [profile, setProfile] = useState(null);
  const [applications, setApplications] = useState([]);
  const [recommendedJobs, setRecommendedJobs] = useState([]);
  const [savedJobsData, setSavedJobsData] = useState([]);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        navigate('/login'); 
        return;
      }
      setCurrentUser(user);

      try {
          // Load all data in parallel
          // We pass BOTH email and uid to fetchMyApplications to ensure we catch everything
          const [driverProfile, userApps, savedJobs] = await Promise.all([
              fetchDriverProfile(user.uid),
              fetchMyApplications(user.email, user.uid), 
              getSavedJobs(user.uid)
          ]);

          setProfile(driverProfile);
          setApplications(userApps); 
          setSavedJobsData(savedJobs);

          // If profile exists and has a type, fetch recommended jobs
          if (driverProfile && driverProfile.driverProfile?.type) {
              const jobs = await fetchRecommendedJobs(driverProfile.driverProfile.type);
              setRecommendedJobs(jobs);
          }
      } catch (error) {
          console.error("Dashboard Load Error:", error);
      } finally {
          setLoading(false);
      }
    });
    return () => unsubscribe(); 
  }, [navigate]);

  const handleCreateProfile = async () => {
    if (!currentUser) return;
    setCreating(true);
    try {
      const driverDocRef = doc(db, "drivers", currentUser.uid);
      const initialData = {
        personalInfo: { firstName: "Driver", email: currentUser.email, city: "Update Profile", state: "XX" },
        qualifications: { experienceYears: "New" },
        licenses: [],
        createdAt: serverTimestamp(),
        lastUpdatedAt: serverTimestamp()
      };
      await setDoc(driverDocRef, initialData, {merge: true});

      // Refresh profile immediately after creation
      const newProfile = await fetchDriverProfile(currentUser.uid);
      setProfile(newProfile);

    } catch (error) {
      console.error("Error creating profile:", error);
    } finally {
      setCreating(false);
    }
  };

  const onLogout = async () => {
    await auth.signOut();
    navigate('/login');
  };

  const refreshData = async () => {
      if(currentUser) {
          // Pass both Email and UID here as well
          const apps = await fetchMyApplications(currentUser.email, currentUser.uid);
          setApplications(apps);
      }
  }

  const refreshSavedJobs = async () => {
      if(currentUser) {
          const jobs = await getSavedJobs(currentUser.uid);
          setSavedJobsData(jobs);
      }
  }

  return {
      currentUser,
      profile,
      applications,
      recommendedJobs,
      savedJobsData,
      loading,
      creating,
      handleCreateProfile,
      onLogout,
      refreshData,
      refreshSavedJobs
  };
}