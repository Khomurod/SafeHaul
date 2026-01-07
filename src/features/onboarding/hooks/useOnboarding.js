import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';

export function useOnboarding(user) {
  const [showTour, setShowTour] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function checkTourStatus() {
      if (!user?.uid) {
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const snapshot = await getDoc(userRef);

        if (snapshot.exists()) {
          const data = snapshot.data();
          if (isMounted) {
            setShowTour(!data.onboardingTourCompleted);
          }
        } else {
          if (isMounted) setShowTour(true);
        }
      } catch (error) {
        console.error("Error checking onboarding status:", error);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    checkTourStatus();

    return () => {
      isMounted = false;
    };
  }, [user]);

  const completeTour = async () => {
    if (!user?.uid) return;
    
    setShowTour(false);

    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        onboardingTourCompleted: true,
        tourCompletedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to mark tour as complete:", error);
    }
  };

  return {
    showTour,
    loading,
    completeTour
  };
}
