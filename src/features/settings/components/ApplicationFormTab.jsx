import React, { useEffect, useState } from 'react';
import { saveCompanySettings } from '@features/companies';
import { ListChecks, SlidersHorizontal, Blocks, FileSignature } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { useData } from '@/context/DataContext';
import { TabList, TabPanel } from '@/design-system/components';
import { PageHeader, Stack } from '@/design-system/layouts';
import { SaveBar, useUnsavedChanges } from '@/design-system/patterns';
import { QuestionsTabContent } from './profile';
import { ApplicationRulesPanel } from './rules/ApplicationRulesPanel';
import { ApplicationIntegrationsPanel } from './rules/ApplicationIntegrationsPanel';
import { AgreementsPanel } from './rules/AgreementsPanel';
import { withoutBlankOptions } from '@/config/customQuestionOptions';
import { isCompanyAdminForRoute, isSuperAdminClaims } from '@app/auth/roles';

const TABS = [
    { id: 'questions', label: 'Questions', icon: ListChecks },
    { id: 'rules', label: 'Rules', icon: SlidersHorizontal },
    { id: 'agreements', label: 'Agreements', icon: FileSignature },
    { id: 'integrations', label: 'Integrations', icon: Blocks },
];

/** What each part of the form is called in the save bar, keyed by the field it saves. */
const PARTS = [
    ['applicationConfig', 'Questions'],
    ['customQuestions', 'Questions'],
    ['applicationRules', 'Rules'],
    ['applicationIntegrations', 'Integrations'],
];

/**
 * The four company fields this section edits. Rules and integrations stay
 * undefined until the company has its own, so a company that never touches
 * them keeps the platform defaults (`saveCompanySettings` writes neither then).
 */
function formOf(profile) {
    return {
        applicationConfig: profile?.applicationConfig || {},
        customQuestions: profile?.customQuestions || [],
        applicationRules: profile?.applicationRules,
        applicationIntegrations: profile?.applicationIntegrations,
    };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings → Application form: what drivers are asked, what happens to their
 * answers, the agreements they sign, and optional imports. Questions, Rules and
 * Integrations are edited together and saved with one `SaveBar` through
 * `saveCompanySettings`, which writes only these keys. Agreements save
 * themselves (their own callables; publishing is Super Admin only).
 */
export function ApplicationFormTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { currentUserClaims } = useData();
    const isSuperAdmin = isSuperAdminClaims(currentUserClaims);
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id);

    const [activeTab, setActiveTab] = useState('questions');
    const [saved, setSaved] = useState(() => formOf(currentCompanyProfile));
    const [form, setForm] = useState(saved);
    const [saving, setSaving] = useState(false);
    const dirty = !same(form, saved);
    useUnsavedChanges(dirty);

    // A newer copy of the company (after a save here, or elsewhere) replaces
    // what is shown, but never under someone's unsaved edits.
    useEffect(() => {
        if (dirty) return;
        const next = formOf(currentCompanyProfile);
        setSaved(next);
        setForm(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new profile re-syncs
    }, [currentCompanyProfile]);

    const setField = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

    const handleSave = async () => {
        setSaving(true);
        // An option whose text was cleared is no choice: a driver's page cannot draw it.
        const next = { ...form, customQuestions: withoutBlankOptions(form.customQuestions) };
        try {
            await saveCompanySettings(currentCompanyProfile.id, next);
            setSaved(next);
            setForm(next);
            showSuccess('Company settings saved successfully.');
        } catch (error) {
            console.error('Save failed', error);
            showError('Failed to save settings: ' + error.message);
        } finally {
            setSaving(false);
        }
    };

    const changedParts = [...new Set(PARTS.filter(([field]) => !same(form[field], saved[field])).map(([, name]) => name))];

    return (
        <Stack gap="lg">
            <PageHeader
                title="Application form"
                description="What drivers are asked, what happens to their answers, and the agreements they sign."
            />
            <TabList
                ariaLabel="Application form sections"
                idBase="application-form"
                tabs={TABS}
                activeTab={activeTab}
                onChange={setActiveTab}
            />
            <TabPanel idBase="application-form" tabId={activeTab}>
                {activeTab === 'questions' && (
                    <QuestionsTabContent
                        compData={form}
                        isCompanyAdmin={isCompanyAdmin}
                        onConfigChange={setField('applicationConfig')}
                        onQuestionsChange={setField('customQuestions')}
                    />
                )}
                {activeTab === 'rules' && (
                    <ApplicationRulesPanel
                        rules={form.applicationRules}
                        readOnly={!isCompanyAdmin}
                        onChange={setField('applicationRules')}
                    />
                )}
                {activeTab === 'agreements' && (
                    <AgreementsPanel companyId={currentCompanyProfile.id} canPublish={isSuperAdmin} />
                )}
                {activeTab === 'integrations' && (
                    <ApplicationIntegrationsPanel
                        integrations={form.applicationIntegrations}
                        readOnly={!isCompanyAdmin}
                        onChange={setField('applicationIntegrations')}
                    />
                )}
            </TabPanel>
            {dirty && (
                <SaveBar
                    summary={`${changedParts.join(', ') || 'Application form'} changed`}
                    saving={saving}
                    onSave={handleSave}
                    onDiscard={() => setForm(saved)}
                />
            )}
        </Stack>
    );
}
