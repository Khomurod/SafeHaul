import { useCallback, useMemo } from "react";
// One list for every state picker and for the writers that fill them, so a
// value a document produced is always one a picker can show. See usStates.js.
import { US_STATE_NAMES } from "@shared/utils/usStates";

/**
 * Hook to contain all static data and non-state-management utility functions.
 */
export const useUtils = () => {

    // Static data list of states
    const states = useMemo(() => US_STATE_NAMES, []);

    /**
     * Updates the page UI with the specific company's branding.
     * This targets placeholders in the HTML/JSX.
     * @param {object} companyData - The company object from Firestore.
     */
    const initializeFormBranding = useCallback((companyData) => {
        if (!companyData) return;
        const companyName = companyData.companyName || "Our Company";

        // Update all legal placeholders
        const placeholders = document.querySelectorAll('.company-name-placeholder');
        placeholders.forEach(el => {
            el.textContent = companyName;
        });

    }, []);

    return {
        states,
        initializeFormBranding,
    };
};