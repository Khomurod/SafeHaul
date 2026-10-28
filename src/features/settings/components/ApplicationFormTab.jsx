import React, { useState } from 'react';
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

const FIELDS = ['applicationConfig', 'customQuestions', 'applicationRules', 'applicationIntegrations'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings → Application form: what drivers are asked, what happens to their
 * answers, the agreements they sign, and optional imports. Questions, Rules and
 * Integrations are edited together and saved with one `SaveBar` through
 * `saveCompanySettings`, which writes only the parts changed here. Agreements save
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

    // A newer copy of the company replaces what is shown, but never under
    // someone's unsaved edits: then it waits, and Discard shows it.
    const [seenProfile, setSeenProfile] = useState(currentCompanyProfile);
    const [heldProfile, setHeldProfile] = useState(null);
    if (currentCompanyProfile !== seenProfile) {
        setSeenProfile(currentCompanyProfile);
        if (dirty) {
            setHeldProfile(currentCompanyProfile);
        } else {
            const next = formOf(currentCompanyProfile);
            setHeldProfile(null);
            setSaved(next);
            setForm(next);
        }
    }
    const discard = () => {
        const base = heldProfile ? formOf(heldProfile) : saved;
        setHeldProfile(null);
        setSaved(base);
        setForm(base);
    };

    const setField = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

    const handleSave = async () => {
        setSaving(true);
        // An option whose text was cleared is no choice: a driver's page cannot draw it.
        const next = { ...form, customQuestions: withoutBlankOptions(form.customQuestions) };
        // Only the parts changed here: another admin's change to a part left
        // alone here is not overwritten with this page's older copy of it.
        const changes = Object.fromEntries(FIELDS.filter((field) => !same(next[field], saved[field]))
            .map((field) => [field, next[field]]));
        try {
            // A cleared answer option alone changes nothing once dropped.
            if (Object.keys(changes).length > 0) await saveCompanySettings(currentCompanyProfile.id, changes);
            // What the company now holds: a newer copy that waited during the
            // edit, with what was just saved here on top.
            const base = heldProfile ? { ...formOf(heldProfile), ...changes } : next;
            setSaved(base);
            // Cleared, unless an even newer copy arrived while saving.
            setHeldProfile((held) => (held === heldProfile ? null : held));
            // A part edited while the save was on its way keeps that edit, still
            // unsaved; every other part shows the company as it now is.
            setForm((current) => Object.fromEntries(FIELDS.map((field) => (
                [field, current[field] === form[field] ? base[field] : current[field]]))));
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
                    onDiscard={discard}
                />
            )}
        </Stack>
    );
}
