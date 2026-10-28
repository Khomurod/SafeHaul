import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial data only.
const mocks = vi.hoisted(() => ({
    saveCompanySettings: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
    useData: vi.fn(),
}));

vi.mock('@features/companies', () => ({ saveCompanySettings: mocks.saveCompanySettings }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }) }));
vi.mock('@/context/DataContext', () => ({ useData: () => mocks.useData() }));

// The panels are covered by their own suites; here each is a stand-in that edits its field.
vi.mock('./profile', () => ({
    QuestionsTabContent: ({ compData, onConfigChange, onQuestionsChange }) => (
        <div>
            <p>Questions: {compData.customQuestions.length}</p>
            <button type="button" onClick={() => onConfigChange({ ...compData.applicationConfig, ssnRequired: false })}>Change a standard question</button>
            <button type="button" onClick={() => onQuestionsChange([...compData.customQuestions, { id: 'q2', type: 'multipleChoice', label: 'Endorsement', options: ['Hazmat', '', 'Tanker'] }])}>Add a question</button>
        </div>
    ),
}));
vi.mock('./rules/ApplicationRulesPanel', () => ({
    ApplicationRulesPanel: ({ rules, readOnly, onChange }) => (
        <button type="button" disabled={readOnly} onClick={() => onChange({ ...(rules || {}), minAge: 23 })}>Change a rule</button>
    ),
}));
vi.mock('./rules/ApplicationIntegrationsPanel', () => ({
    ApplicationIntegrationsPanel: ({ onChange }) => (
        <button type="button" onClick={() => onChange({ psp: { enabled: true } })}>Turn on PSP</button>
    ),
}));
vi.mock('./rules/AgreementsPanel', () => ({
    AgreementsPanel: ({ canPublish }) => <p>Agreements panel{canPublish ? ' (can publish)' : ''}</p>,
}));

import { ApplicationFormTab } from './ApplicationFormTab';
import { UnsavedChangesProvider, useUnsavedChangesGuard } from '@/design-system/patterns';

const company = {
    id: 'company-1',
    companyName: 'Artificial Co',
    applicationConfig: { ssnRequired: true },
    customQuestions: [{ id: 'q1', type: 'text', label: 'Nights?' }],
};

const ADMIN = { roles: { 'company-1': 'company_admin' } };

function renderForm({ profile = company, claims = ADMIN } = {}) {
    mocks.useData.mockReturnValue({ currentUserClaims: claims });
    return render(<ApplicationFormTab currentCompanyProfile={profile} />);
}

const saveBar = () => screen.queryByRole('region', { name: 'Unsaved changes' });
const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

beforeEach(() => {
    mocks.saveCompanySettings.mockReset();
    mocks.saveCompanySettings.mockResolvedValue(undefined);
    mocks.showSuccess.mockReset();
    mocks.showError.mockReset();
    mocks.useData.mockReset();
});

describe('ApplicationFormTab', () => {
    it('is its own page with four tabs, Questions first, and nothing to save yet', () => {
        renderForm();
        expect(screen.getByRole('heading', { level: 1, name: 'Application form' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Questions', 'Rules', 'Agreements', 'Integrations']);
        expect(screen.getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true');
        expect(saveBar()).toBeNull();
    });

    it('collects edits from every tab into one save bar that names them', () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Change a standard question' }));
        openTab('Rules');
        fireEvent.click(screen.getByRole('button', { name: 'Change a rule' }));
        expect(saveBar()).toHaveTextContent('Questions, Rules changed');
    });

    it('saves only the four application fields, dropping blank answer options', async () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
        openTab('Integrations');
        fireEvent.click(screen.getByRole('button', { name: 'Turn on PSP' }));
        fireEvent.click(within(saveBar()).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mocks.showSuccess).toHaveBeenCalledWith('Company settings saved successfully.'));
        expect(mocks.saveCompanySettings).toHaveBeenCalledWith('company-1', {
            applicationConfig: { ssnRequired: true },
            customQuestions: [
                { id: 'q1', type: 'text', label: 'Nights?' },
                { id: 'q2', type: 'multipleChoice', label: 'Endorsement', options: ['Hazmat', 'Tanker'] },
            ],
            applicationRules: undefined,
            applicationIntegrations: { psp: { enabled: true } },
        });
        expect(saveBar()).toBeNull();
    });

    it('keeps the edits and the bar when saving fails', async () => {
        mocks.saveCompanySettings.mockRejectedValue(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
        fireEvent.click(within(saveBar()).getByRole('button', { name: 'Save' }));

        await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith('Failed to save settings: offline'));
        expect(saveBar()).toBeInTheDocument();
        expect(screen.getByText('Questions: 2')).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('puts every edit back on Discard', () => {
        renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
        expect(screen.getByText('Questions: 2')).toBeInTheDocument();
        fireEvent.click(within(saveBar()).getByRole('button', { name: 'Discard' }));
        expect(saveBar()).toBeNull();
        expect(screen.getByText('Questions: 1')).toBeInTheDocument();
    });

    it('takes a newer copy of the company, but never under unsaved edits', () => {
        const { rerender } = renderForm();
        rerender(<ApplicationFormTab currentCompanyProfile={{ ...company, customQuestions: [] }} />);
        expect(screen.getByText('Questions: 0')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
        rerender(<ApplicationFormTab currentCompanyProfile={{ ...company, customQuestions: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] }} />);
        expect(screen.getByText('Questions: 1')).toBeInTheDocument();
        expect(saveBar()).toBeInTheDocument();
    });

    it('tells the leave guard while it holds unsaved edits', () => {
        mocks.useData.mockReturnValue({ currentUserClaims: ADMIN });
        let guard;
        function Probe() { guard = useUnsavedChangesGuard(); return null; }
        render(
            <UnsavedChangesProvider>
                <ApplicationFormTab currentCompanyProfile={company} />
                <Probe />
            </UnsavedChangesProvider>,
        );
        expect(guard.dirty).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
        expect(guard.dirty).toBe(true);
    });

    it('lets only a Super Admin publish agreement wording', () => {
        renderForm();
        openTab('Agreements');
        expect(screen.getByText('Agreements panel')).toBeInTheDocument();
    });

    it('shows the rules read-only to someone who is not a company admin', () => {
        renderForm({ claims: { roles: { 'company-1': 'hr_user' } } });
        openTab('Rules');
        expect(screen.getByRole('button', { name: 'Change a rule' })).toBeDisabled();
    });

    it('has no accessibility violations with unsaved edits', async () => {
        const { container } = renderForm();
        fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
        expect((await axe(container)).violations).toEqual([]);
    });
});
