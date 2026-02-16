/**
 * useApplicationSchema Hook
 * 
 * Fetches and merges global schema with company overrides.
 * Used by DriverApplicationWizard and ApplicationDetailViewV2.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { getMergedSchema, getFieldsForStep, validateStep, isFieldVisible } from '@/config/questionMerger';

const GLOBAL_SCHEMA_PATH = 'system_settings';
const GLOBAL_SCHEMA_DOC = 'application_schema';

export function useApplicationSchema(companyId) {
    const [globalSchema, setGlobalSchema] = useState(null);
    const [companyOverrides, setCompanyOverrides] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch both schemas
    const fetchSchemas = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            // Fetch global schema
            const globalRef = doc(db, GLOBAL_SCHEMA_PATH, GLOBAL_SCHEMA_DOC);
            const globalSnap = await getDoc(globalRef);

            if (!globalSnap.exists()) {
                console.warn('[useApplicationSchema] No global schema found');
                setGlobalSchema(null);
            } else {
                setGlobalSchema(globalSnap.data());
            }

            // Fetch company overrides (if companyId provided)
            if (companyId) {
                const companyRef = doc(db, 'companies', companyId, 'settings', 'custom_questions');
                const companySnap = await getDoc(companyRef);

                if (companySnap.exists()) {
                    setCompanyOverrides(companySnap.data());
                } else {
                    setCompanyOverrides({});
                }
            } else {
                setCompanyOverrides({});
            }
        } catch (err) {
            console.error('[useApplicationSchema] Error fetching schemas:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    // Initial fetch
    useEffect(() => {
        fetchSchemas();
    }, [fetchSchemas]);

    // Compute merged schema
    const mergedSchema = useMemo(() => {
        if (!globalSchema) return null;
        return getMergedSchema(globalSchema, companyOverrides);
    }, [globalSchema, companyOverrides]);

    // Helper: Get fields for a step
    const getStepFields = useCallback((stepNumber) => {
        if (!mergedSchema) return [];
        return getFieldsForStep(mergedSchema, stepNumber);
    }, [mergedSchema]);

    // Helper: Validate a step
    const validateStepData = useCallback((stepNumber, formData) => {
        if (!mergedSchema) return { valid: true, missingFields: [] };
        return validateStep(mergedSchema, stepNumber, formData);
    }, [mergedSchema]);

    // Helper: Check field visibility
    const checkFieldVisible = useCallback((field, formData) => {
        return isFieldVisible(field, formData);
    }, []);

    // Check if we have custom questions (for step 8)
    const hasCustomQuestions = useMemo(() => {
        if (!mergedSchema?.sections) return false;
        return mergedSchema.sections.some(s => s.isCustom && s.fields?.length > 0);
    }, [mergedSchema]);

    return {
        // Data
        schema: mergedSchema,
        globalSchema,
        companyOverrides,

        // State
        loading,
        error,

        // Helpers
        getStepFields,
        validateStepData,
        checkFieldVisible,
        hasCustomQuestions,

        // Actions
        refetch: fetchSchemas
    };
}

export default useApplicationSchema;
