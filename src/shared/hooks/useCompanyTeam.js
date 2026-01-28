import { useState, useEffect } from 'react';
import { db } from '@lib/firebase';
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore';

export function useCompanyTeam(companyId) {
    const [team, setTeam] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!companyId) {
            setIsLoading(false);
            return;
        }

        const q = query(collection(db, "memberships"), where("companyId", "==", companyId));

        const unsubscribe = onSnapshot(q, async (snapshot) => {
            try {
                const membersPromises = snapshot.docs.map(async (memDoc) => {
                    const memData = memDoc.data();
                    const userId = memData.userId;

                    let userData = { name: 'Unknown', email: '' };
                    try {
                        const userDoc = await getDoc(doc(db, "users", userId));
                        if (userDoc.exists()) {
                            const d = userDoc.data();
                            // Handle various name fields (fullName, firstName/lastName, etc.)
                            const name = d.fullName || d.displayName || (d.firstName && d.lastName ? `${d.firstName} ${d.lastName}` : d.email || 'Unknown User');
                            userData = { name, email: d.email };
                        }
                    } catch (e) {
                        console.warn(`Error fetching user profile for ${userId}:`, e);
                    }

                    return {
                        id: userId,
                        role: memData.role,
                        ...userData
                    };
                });

                const members = await Promise.all(membersPromises);
                setTeam(members);
                setIsLoading(false);
            } catch (err) {
                console.error("Error processing team members:", err);
                setError(err.message);
                setIsLoading(false);
            }
        });

        return () => unsubscribe();
    }, [companyId]);

    return { team, isLoading, error };
}
