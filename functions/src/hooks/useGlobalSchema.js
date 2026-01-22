/**
 * useGlobalSchema Hook
 * 
 * Fetches and manages the global application schema from Firestore.
 * Used by Super Admin to manage questions globally.
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import GLOBAL_SCHEMA_SEED from '@/config/globalSchemaSeed';

const SCHEMA_PATH = 'system_settings';
const SCHEMA_DOC = 'application_schema';

export function useGlobalSchema() {
    const { currentUser } = useData();
    const [schema, setSchema] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    // Fetch schema from Firestore
    const fetchSchema = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const schemaRef = doc(db, SCHEMA_PATH, SCHEMA_DOC);
            const snapshot = await getDoc(schemaRef);

            if (snapshot.exists()) {
                setSchema(snapshot.data());
            } else {
                // Seed with initial schema if not exists
                console.log('[useGlobalSchema] No schema found, seeding...');
                await setDoc(schemaRef, {
                    ...GLOBAL_SCHEMA_SEED,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
                setSchema(GLOBAL_SCHEMA_SEED);
            }
        } catch (err) {
            console.error('[useGlobalSchema] Error fetching schema:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchSchema();
    }, [fetchSchema]);

    // Save schema to Firestore
    const saveSchema = useCallback(async (updatedSchema) => {
        setSaving(true);
        setError(null);

        try {
            const schemaRef = doc(db, SCHEMA_PATH, SCHEMA_DOC);

            // Increment version
            const currentVersion = schema?.version || '1.0.0';
            const [major, minor, patch] = currentVersion.split('.').map(Number);
            const newVersion = `${major}.${minor}.${patch + 1}`;

            const dataToSave = {
                ...updatedSchema,
                version: newVersion,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser?.uid || 'unknown'
            };

            await setDoc(schemaRef, dataToSave);
            setSchema(dataToSave);

            return { success: true, version: newVersion };
        } catch (err) {
            console.error('[useGlobalSchema] Error saving schema:', err);
            setError(err.message);
            return { success: false, error: err.message };
        } finally {
            setSaving(false);
        }
    }, [schema, currentUser]);

    // Update a specific section
    const updateSection = useCallback((sectionId, updatedFields) => {
        if (!schema) return;

        const updatedSections = schema.sections.map(section => {
            if (section.id === sectionId) {
                return { ...section, fields: updatedFields };
            }
            return section;
        });

        setSchema({ ...schema, sections: updatedSections });
    }, [schema]);

    // Add a new field to a section
    const addField = useCallback((sectionId, newField) => {
        if (!schema) return;

        const updatedSections = schema.sections.map(section => {
            if (section.id === sectionId) {
                return {
                    ...section,
                    fields: [...(section.fields || []), newField]
                };
            }
            return section;
        });

        setSchema({ ...schema, sections: updatedSections });
    }, [schema]);

    // Delete a field (only if not DOT required)
    const deleteField = useCallback((sectionId, fieldKey) => {
        if (!schema) return { success: false, error: 'No schema loaded' };

        // Find the field
        const section = schema.sections.find(s => s.id === sectionId);
        const field = section?.fields?.find(f => f.key === fieldKey);

        if (field?.dotRequired) {
            return { success: false, error: 'Cannot delete DOT-required field' };
        }

        const updatedSections = schema.sections.map(section => {
            if (section.id === sectionId) {
                return {
                    ...section,
                    fields: section.fields.filter(f => f.key !== fieldKey)
                };
            }
            return section;
        });

        setSchema({ ...schema, sections: updatedSections });
        return { success: true };
    }, [schema]);

    // Get flattened list of all fields
    const getAllFields = useCallback(() => {
        if (!schema) return [];

        return schema.sections.flatMap(section =>
            (section.fields || []).map(field => ({
                ...field,
                sectionId: section.id,
                sectionTitle: section.title,
                stepNumber: section.stepNumber
            }))
        );
    }, [schema]);

    return {
        schema,
        loading,
        error,
        saving,
        saveSchema,
        updateSection,
        addField,
        deleteField,
        getAllFields,
        refetch: fetchSchema
    };
}

export default useGlobalSchema;
