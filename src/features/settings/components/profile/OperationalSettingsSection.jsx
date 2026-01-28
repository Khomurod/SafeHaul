import React from 'react';
import { HelpCircle, Briefcase } from 'lucide-react';
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
        <div className="space-y-8 animate-in slide-in-from-bottom-2">
            <div>
                <div className="mb-4">
                    <h3 className="text-lg font-bold text-gray-900">Standard DOT Questions</h3>
                    <p className="text-sm text-gray-500">Configure visibility and requirements for standard application fields.</p>
                </div>

                {isCompanyAdmin ? (
                    <StandardQuestionsConfig
                        config={compData.applicationConfig}
                        onChange={onConfigChange}
                    />
                ) : (
                    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center text-gray-500">
                        <p>Read-only view for standard questions.</p>
                    </div>
                )}
            </div>

            <div className="border-t border-gray-200 pt-6">
                <div className="mb-6">
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                        <HelpCircle size={20} className="text-blue-600" /> Custom Questions
                    </h3>
                    <p className="text-sm text-gray-500">Add specific questions for your company (e.g. "Do you have flatbed experience?").</p>
                </div>

                {isCompanyAdmin ? (
                    <CustomQuestionsBuilder
                        questions={compData.customQuestions || []}
                        onChange={onQuestionsChange}
                        onSave={onSave}
                        loading={loading}
                    />
                ) : (
                    <div className="p-6 bg-gray-50 border border-gray-200 rounded-xl text-center text-gray-500">
                        <p>Only Company Admins can edit application questions.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export function HiringTabContent() {
    return (
        <div className="animate-in slide-in-from-bottom-2">
            <div className="mb-6">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Briefcase size={20} className="text-blue-600" /> Hiring Positions & Offers
                </h3>
                <p className="text-sm text-gray-500">This section has moved to the new Job Board.</p>
            </div>

            <div className="p-10 bg-blue-50 border border-blue-100 rounded-xl text-center">
                <Briefcase size={40} className="mx-auto text-blue-500 mb-4" />
                <h3 className="text-lg font-bold text-gray-900 mb-2">We've moved!</h3>
                <p className="text-gray-600 max-w-md mx-auto mb-6">
                    Job postings are now managed in the dedicated <strong>Job Board</strong> section of your company settings.
                </p>
            </div>
        </div>
    );
}
