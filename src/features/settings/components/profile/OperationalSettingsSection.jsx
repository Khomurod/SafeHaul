import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Card } from '@/design-system/components';
import { CustomQuestionsBuilder } from '../questions/CustomQuestionsBuilder';
import { StandardQuestionsConfig } from '../questions/StandardQuestionsConfig';


export function QuestionsTabContent({
    compData,
    isCompanyAdmin,
    onConfigChange,
    onQuestionsChange,
    onSave,
    loading
}) {
    return (
        <div className="space-y-ds-8">
            <section aria-labelledby="standard-questions-heading">
                <div className="mb-ds-4">
                    <h3 id="standard-questions-heading" className="text-ds-heading-sm font-bold text-ds-content">
                        Standard DOT Questions
                    </h3>
                    <p className="text-ds-sm text-ds-content-muted">
                        Configure visibility and requirements for standard application fields.
                    </p>
                </div>

                {isCompanyAdmin ? (
                    <StandardQuestionsConfig
                        config={compData.applicationConfig}
                        onChange={onConfigChange}
                    />
                ) : (
                    <Card className="text-center text-ds-content-muted">
                        <p>Read-only view for standard questions.</p>
                    </Card>
                )}
            </section>

            <section aria-labelledby="custom-questions-heading" className="border-t border-ds-border-subtle pt-ds-6">
                <div className="mb-ds-6">
                    <h3 id="custom-questions-heading" className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <HelpCircle size={20} className="text-ds-action-primary" aria-hidden="true" /> Custom Questions
                    </h3>
                    <p className="text-ds-sm text-ds-content-muted">
                        Add specific questions for your company (e.g. "Do you have flatbed experience?").
                    </p>
                </div>

                {isCompanyAdmin ? (
                    <CustomQuestionsBuilder
                        questions={compData.customQuestions || []}
                        onChange={onQuestionsChange}
                        onSave={onSave}
                        loading={loading}
                    />
                ) : (
                    <Card className="text-center text-ds-content-muted">
                        <p>Only Company Admins can edit application questions.</p>
                    </Card>
                )}
            </section>
        </div>
    );
}
