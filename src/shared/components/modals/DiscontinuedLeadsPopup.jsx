import React, { useState, useEffect, useCallback } from 'react';
import { useData } from '@/context/DataContext';

const CUTOFF_DATE = new Date('2026-03-04T12:00:00Z').getTime();
const POPUP_SHOWN_KEY = 'discontinued_leads_popup_shown_';

export function DiscontinuedLeadsPopup() {
    const { currentUser } = useData();
    const [isOpen, setIsOpen] = useState(false);

    const checkAndShowPopup = useCallback(() => {
        if (!currentUser || !currentUser.metadata?.creationTime) return;

        // Check if user is a "current user"
        const creationTime = new Date(currentUser.metadata.creationTime).getTime();
        if (creationTime >= CUTOFF_DATE) return; // New user

        // Check if already shown
        const storageKey = POPUP_SHOWN_KEY + currentUser.uid;
        const hasShown = localStorage.getItem(storageKey);
        if (hasShown) return;

        // Show popup
        setIsOpen(true);
        // Mark as shown immediately so we don't trigger it again while open
        localStorage.setItem(storageKey, 'true');
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) return;

        // Trigger on login / refresh (since this mounts on auth state change)
        checkAndShowPopup();

        // Trigger on any button click globally
        const handleGlobalClick = (e) => {
            // Find closest clickable element
            const target = e.target.closest('button, a, [role="button"]');
            if (target) {
                // Run check slightly later to not block the immediate click Event Loop if needed
                setTimeout(checkAndShowPopup, 10);
            }
        };

        document.addEventListener('click', handleGlobalClick, { capture: true });

        return () => {
            document.removeEventListener('click', handleGlobalClick, { capture: true });
        };
    }, [currentUser, checkAndShowPopup]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-center animate-in zoom-in-95 duration-200">
                <div className="mb-4">
                    <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Important Notice: Discontinuation of Lead Distribution Service</h2>
                    <div className="text-gray-600 text-sm mb-6 space-y-3 text-left bg-gray-50 p-4 rounded-lg border border-gray-100">
                        <p>
                            Dear Valued Partner,
                        </p>
                        <p>
                            Effective immediately, SafeHaul has officially discontinued the Lead Distribution feature within our platform.
                        </p>
                        <p>
                            Following a comprehensive legal review, we determined that providing direct driver leads may conflict with current US employment and data privacy legislation. To ensure the highest level of compliance and to protect our partners, we have decided to remove this feature permanently.
                        </p>
                        <p>
                            We remain committed to providing you with the best applicant tracking tools and are currently working on new, compliant features to help you grow your fleet. We appreciate your continued partnership and understanding in this matter.
                        </p>
                        <p className="font-semibold pt-2">
                            — The SafeHaul Team
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => setIsOpen(false)}
                    className="w-full bg-[#3fa8b3] hover:bg-[#348f99] text-white font-semibold py-2.5 px-4 rounded-lg transition-colors"
                >
                    Close
                </button>
            </div>
        </div>
    );
}
