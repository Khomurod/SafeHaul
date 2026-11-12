import React from 'react';
import { FormSection } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { CustomQuestionsBuilder } from '../questions/CustomQuestionsBuilder';
import { CUSTOM_QUESTIONS_DESCRIPTION } from '../questions/QuestionConfig';
import { StandardQuestionsConfig } from '../questions/StandardQuestionsConfig';

/**
 * Application questions → Questions: the standard DOT questions, a table that
 * is its section's card, then the company's own questions. Each section's
 * heading sits above its card.
 */
export function QuestionsTabContent({
    compData,
    isCompanyAdmin,
    onConfigChange,
    onQuestionsChange,
}) {
    return (
        <Stack gap="xl">
            <FormSection
                layout="stacked"
                padding={isCompanyAdmin ? 'none' : 'md'}
                title="Standard DOT Questions"
                description="Configure visibility and requirements for standard application fields."
            >
                {isCompanyAdmin ? (
                    <StandardQuestionsConfig
                        config={compData.applicationConfig}
                        onChange={onConfigChange}
                    />
                ) : (
                    <p className="text-center text-ds-content-muted">Read-only view for standard questions.</p>
                )}
            </FormSection>

            {isCompanyAdmin ? (
                <CustomQuestionsBuilder
                    questions={compData.customQuestions || []}
                    onChange={onQuestionsChange}
                />
            ) : (
                <FormSection layout="stacked" title="Custom Questions" description={CUSTOM_QUESTIONS_DESCRIPTION}>
                    <p className="text-center text-ds-content-muted">Only Company Admins can edit application questions.</p>
                </FormSection>
            )}
        </Stack>
    );
}
