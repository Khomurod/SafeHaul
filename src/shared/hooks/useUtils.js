import { useCallback, useMemo } from "react";

const US_STATES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
    'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
    'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
];

/**
 * Hook to contain all static data and non-state-management utility functions.
 */
export const useUtils = () => {

    // Static data list of states
    const states = useMemo(() => US_STATES, []);

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