/**
 * GlobalQuestionsManager
 * 
 * Super Admin view for managing global application questions.
 * Connects CustomQuestionsBuilder to Firestore via useGlobalSchema hook.
 */

import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { CustomQuestionsBuilder } from '@/features/settings/components/questions/CustomQuestionsBuilder';
import { useGlobalSchema } from '@/hooks/useGlobalSchema';
import { sanitizeQuestionPayload } from '@shared/utils/sanitizeUserContent';
import { Badge, Button, Card } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';

/**
 * Super Admin view for managing global application questions.
 *
 * Migrated to the design system 2026-07-28. This view is a thin wrapper: the
 * question list, creation/editing, type/required/active controls, reordering,
 * per-field validation and delete confirmation all live in the shared,
 * already-migrated `CustomQuestionsBuilder` (a settings-feature primitive reused
 * here). This migration touches only the wrapper's own presentation — the
 * loading/error/header/legend/success states — and preserves every contract
 * frozen in `GlobalQuestionsManager.contract.test.jsx`: the schema flatten, the
 * save rebuild (sanitise, section grouping, stripped wrapper keys, defaults),
 * the success/clear behaviour, the `useGlobalSchema` interface, and every
 * user-facing string.
 *
 * Presentation defects fixed: legacy palette (`bg-red-50`/`text-blue-600`/
 * `bg-gray-100`) replaced with `--ds-*` tokens and `Card`/`Button`/`Badge`; the
 * spinner is the shared `SafeHaulLoader`; the error and success blocks are now
 * announced (`role="alert"`/`role="status"`).
 */

export function GlobalQuestionsManager() {
    const {
        schema,
        loading,
        error,
        saving,
        saveSchema,
        refetch
    } = useGlobalSchema();

    const [saveSuccess, setSaveSuccess] = useState(false);
    const [localQuestions, setLocalQuestions] = useState(null);

    // Convert schema sections to flat question list for the builder
    const questions = useMemo(() => {
        if (localQuestions !== null) return localQuestions;
        if (!schema?.sections) return [];

        return schema.sections.flatMap((section, sectionIndex) =>
            (section.fields || []).map((field, fieldIndex) => ({
                ...field,
                id: field.key,
                sectionId: section.id,
                sectionTitle: section.title,
                stepNumber: section.stepNumber,
                order: sectionIndex * 100 + fieldIndex
            }))
        );
    }, [schema, localQuestions]);

    // Handle question changes (local state)
    const handleQuestionsChange = (updatedQuestions) => {
        setLocalQuestions(updatedQuestions);
        setSaveSuccess(false);
    };

    // Save to Firestore
    const handleSave = async () => {
        if (!schema) return;

        // Rebuild sections from flat question list
        const sectionMap = new Map();

        for (const q of localQuestions || questions) {
            const sanitizedQuestion = sanitizeQuestionPayload(q);
            const sectionId = q.sectionId || 'custom';
            if (!sectionMap.has(sectionId)) {
                // Find original section or create new
                const originalSection = schema.sections.find(s => s.id === sectionId);
                sectionMap.set(sectionId, {
                    id: sectionId,
                    title: originalSection?.title || q.sectionTitle || 'Custom Questions',
                    stepNumber: originalSection?.stepNumber || q.stepNumber || 8,
                    order: originalSection?.order || 99,
                    fields: []
                });
            }

            // Clean question object for storage
            const { sectionId: _, sectionTitle: __, order: ___, ...fieldData } = sanitizedQuestion;
            sectionMap.get(sectionId).fields.push(fieldData);
        }

        const updatedSchema = {
            ...schema,
            sections: Array.from(sectionMap.values())
        };

        const result = await saveSchema(updatedSchema);

        if (result.success) {
            setSaveSuccess(true);
            setLocalQuestions(null);
            setTimeout(() => setSaveSuccess(false), 3000);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <SafeHaulLoader size="h-10 w-10" />
                <span role="status" className="ml-ds-3 text-ds-content-secondary">Loading global schema...</span>
            </div>
        );
    }

    if (error) {
        return (
            <Card padding="lg" className="text-center">
                <AlertCircle className="mx-auto mb-ds-3 text-ds-status-danger-fg" size={40} aria-hidden="true" />
                <h3 className="text-ds-heading-sm font-bold text-ds-status-danger-fg">Failed to load schema</h3>
                <p role="alert" className="mb-ds-4 mt-ds-1 text-ds-sm text-ds-status-danger-fg">{error}</p>
                <Button variant="danger" onClick={refetch}>
                    <RefreshCw size={16} aria-hidden="true" /> Retry
                </Button>
            </Card>
        );
    }

    return (
        <div className="mx-auto max-w-5xl p-ds-6">
            {/* Header */}
            <div className="mb-ds-6">
                <div className="flex flex-col justify-between gap-ds-3 sm:flex-row sm:items-center">
                    <div>
                        <h2 className="text-ds-heading-md font-bold text-ds-content">Global Application Questions</h2>
                        <p className="text-ds-sm text-ds-content-muted">
                            Define the standard questions asked to all drivers.
                            {schema?.version && (
                                <span className="ml-ds-2 inline-flex align-middle">
                                    <Badge tone="neutral">v{schema.version}</Badge>
                                </span>
                            )}
                        </p>
                    </div>
                    {saveSuccess && (
                        <div role="status" className="flex items-center gap-ds-2 rounded-ds-md bg-ds-status-success-bg px-ds-4 py-ds-2 text-ds-status-success-fg">
                            <CheckCircle size={18} aria-hidden="true" />
                            <span className="font-medium">Saved successfully!</span>
                        </div>
                    )}
                </div>

                {/* Legend */}
                <div className="mt-ds-4 flex flex-wrap gap-ds-3">
                    <Badge tone="warning">🛡️ DOT Required = FMCSA mandated</Badge>
                    <Badge tone="neutral">🔒 Locked = Companies cannot hide</Badge>
                    <Badge tone="info">📝 Editable = Label can be customized</Badge>
                </div>
            </div>

            {/* Form Builder */}
            <CustomQuestionsBuilder
                questions={questions}
                onChange={handleQuestionsChange}
                onSave={handleSave}
                loading={saving}
            />
        </div>
    );
}

export default GlobalQuestionsManager;
