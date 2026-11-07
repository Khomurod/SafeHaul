/**
 * The dashboard's "Company setup" card, for a company admin: what is not set up,
 * each with a link to the page that fixes it, read once when the dashboard
 * opens. Ready, it is one calm line; for anyone else it is nothing, and reads
 * nothing. All names, ids and addresses are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { axe } from 'vitest-axe';

const SIGNATURE = 'secure_documents/co-1/originals/company-signatures/stamp.png';
const READY_DOCS = {
    'companies/co-1': {
        contact: { email: 'office@example.test' },
        pevCcEmails: ['safety@example.test'],
        postApplicationTemplates: [{ templateId: 'tpl-w9', title: 'W-9', enabled: true }],
    },
    'companies/co-1/integrations/sms_provider': { isActive: true, inventory: [{ phoneNumber: '+15555550100' }] },
    'companies/co-1/templates/tpl-w9': {
        title: 'W-9 Form',
        fields: [{ id: 'cs', type: 'company_signature', companySignaturePath: SIGNATURE }],
    },
};

const fx = vi.hoisted(() => ({
    reads: [],
    docs: {},
    failing: new Set(),
    emailSettings: { smtpHost: 'smtp.example.test', isVerified: true },
    emailFails: false,
    gate: null,
    user: { uid: 'uid-1' },
}));

vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    getDoc: async (ref) => {
        fx.reads.push(`doc ${ref.path}`);
        if (fx.gate) await fx.gate;
        if (fx.failing.has(ref.path)) throw new Error('Network unavailable.');
        const data = fx.docs[ref.path];
        return { exists: () => data !== undefined, data: () => data };
    },
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async (payload) => {
        fx.reads.push(`call ${name} ${JSON.stringify(payload)}`);
        if (fx.emailFails) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
        return { data: { success: true, settings: fx.emailSettings } };
    },
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {}, auth: { get currentUser() { return fx.user; } } }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));

import { DataContext } from '@/context/DataContext';
import { CompanyReadinessCard } from './CompanyReadinessCard';
import { forgetCompanyReadiness } from '../hooks/useCompanyReadiness';
import { DASHBOARD_KEEP_MS } from '@shared/utils/keptAnswer';

function Where() {
    const location = useLocation();
    return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderCard({ role = 'company_admin', docs = READY_DOCS, companyId = 'co-1' } = {}) {
    fx.docs = structuredClone(docs);
    return render(
        <MemoryRouter initialEntries={['/company/dashboard']}>
            <DataContext.Provider value={{ currentUserClaims: { roles: { [companyId]: role } } }}>
                <Routes>
                    <Route path="*" element={<><CompanyReadinessCard companyId={companyId} /><Where /></>} />
                </Routes>
            </DataContext.Provider>
        </MemoryRouter>,
    );
}

afterEach(() => {
    cleanup();
    forgetCompanyReadiness();
    Object.assign(fx, {
        reads: [],
        docs: {},
        failing: new Set(),
        emailSettings: { smtpHost: 'smtp.example.test', isVerified: true },
        emailFails: false,
        gate: null,
        user: { uid: 'uid-1' },
    });
    vi.restoreAllMocks();
});

describe('for a company admin', () => {
    it('reads the email settings, the texting set-up, the company and its forms\' templates once', async () => {
        renderCard();

        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        expect([...fx.reads].sort()).toEqual([
            'call getEmailSettingsMeta {"companyId":"co-1"}',
            'doc companies/co-1',
            'doc companies/co-1/integrations/sms_provider',
            'doc companies/co-1/templates/tpl-w9',
        ]);
    });

    it('is one calm line when everything is set up, with no card', async () => {
        renderCard();

        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Company setup' })).toBeNull();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('offers the optional PEV copies in that line, only as a hint', async () => {
        renderCard({ docs: { ...READY_DOCS, 'companies/co-1': { ...READY_DOCS['companies/co-1'], pevCcEmails: [] } } });

        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Add PEV copies (optional)' })).toHaveAttribute('href', '/company/settings?section=email');
    });

    it('says while it checks, without claiming anything', async () => {
        let open;
        fx.gate = new Promise((resolve) => { open = resolve; });
        renderCard();

        expect(screen.getByRole('status')).toHaveTextContent('Checking company setup…');
        expect(screen.queryByText('Company setup is complete.')).toBeNull();
        open();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
    });

    it('lists what is not set up, each with a link to the page that fixes it', async () => {
        fx.emailSettings = { smtpHost: '', isVerified: false };
        const docs = {
            'companies/co-1': { contact: {}, postApplicationTemplates: [{ templateId: 'tpl-w9', title: 'W-9', enabled: true }] },
            'companies/co-1/templates/tpl-w9': { title: 'W-9 Form', fields: [{ id: 'cs', type: 'company_signature' }] },
        };
        renderCard({ docs });

        expect(await screen.findByRole('heading', { name: 'Company setup', level: 2 })).toBeInTheDocument();
        expect(screen.getByText('4 things to set up. Each link opens the page that fixes it.')).toBeInTheDocument();
        const items = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
        expect(items).toEqual([
            'Company email is not connected (to set up)',
            'Text messages are not set up (to set up)',
            'No company contact email (to set up)',
            'A company signature has no image (to set up)',
        ]);
        expect(screen.getByRole('link', { name: 'Open email settings' })).toHaveAttribute('href', '/company/settings?section=email');
        expect(screen.getByRole('link', { name: 'Open text message settings' })).toHaveAttribute('href', '/company/settings?section=sms');
        expect(screen.getByRole('link', { name: 'Open company profile' })).toHaveAttribute('href', '/company/settings?section=company');
        expect(screen.getByRole('link', { name: 'Open templates' })).toHaveAttribute('href', '/company/e-docs?view=templates');
        expect(screen.getByText(/Refused after an application until its template has the image: W-9\./)).toBeInTheDocument();
        // The optional copies are a hint under the list, not a thing to set up.
        expect(screen.getByRole('link', { name: 'Add PEV copies (optional)' })).toBeInTheDocument();
    });

    it('opens the page in the app when a link is pressed', async () => {
        fx.emailSettings = { smtpHost: '', isVerified: false };
        renderCard();

        fireEvent.click(await screen.findByRole('link', { name: 'Open email settings' }));
        expect(screen.getByTestId('where')).toHaveTextContent('/company/settings?section=email');
    });

    it('says a read that failed could not be checked, never that something is missing', async () => {
        fx.emailFails = true;
        fx.failing.add('companies/co-1/integrations/sms_provider');
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        renderCard();

        expect(await screen.findByText('Some settings could not be checked just now.')).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
            'Company email (not checked)',
            'Text messages (not checked)',
        ]);
        expect(screen.queryByText(/not connected|not set up/)).toBeNull();
    });

    it('has no accessibility violations with things to set up', async () => {
        fx.emailSettings = { smtpHost: 'smtp.example.test', isVerified: false };
        const { container } = renderCard({ docs: { ...READY_DOCS, 'companies/co-1': { ...READY_DOCS['companies/co-1'], pevCcEmails: [] } } });

        await screen.findByRole('heading', { name: 'Company setup' });
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('kept for a while', () => {
    const READS = 4;

    it('is not checked again when the dashboard opens again within two minutes, and is after', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const first = renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        first.unmount();
        expect(fx.reads).toHaveLength(READS);

        now.mockReturnValue(1_000_000 + DASHBOARD_KEEP_MS - 1);
        const second = renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        second.unmount();
        expect(fx.reads).toHaveLength(READS);

        now.mockReturnValue(1_000_000 + DASHBOARD_KEEP_MS);
        renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        expect(fx.reads).toHaveLength(2 * READS);
    });

    it('is checked anew for another company, and for another sign-in', async () => {
        const first = renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        first.unmount();

        const other = renderCard({ companyId: 'co-2', docs: {} });
        expect(await screen.findByRole('heading', { name: 'Company setup' })).toBeInTheDocument();
        other.unmount();
        expect(fx.reads.filter((read) => read.startsWith('call getEmailSettingsMeta'))).toEqual([
            'call getEmailSettingsMeta {"companyId":"co-1"}',
            'call getEmailSettingsMeta {"companyId":"co-2"}',
        ]);

        fx.user = { uid: 'uid-1' };
        renderCard({ companyId: 'co-2', docs: {} });
        expect(await screen.findByRole('heading', { name: 'Company setup' })).toBeInTheDocument();
        expect(fx.reads.filter((read) => read.startsWith('call getEmailSettingsMeta'))).toHaveLength(3);
    });

    it('is checked anew after a link to fix something is followed', async () => {
        fx.emailSettings = { smtpHost: '', isVerified: false };
        const first = renderCard();
        fireEvent.click(await screen.findByRole('link', { name: 'Open email settings' }));
        first.unmount();

        fx.emailSettings = { smtpHost: 'smtp.example.test', isVerified: true };
        renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        expect(fx.reads.filter((read) => read.startsWith('call getEmailSettingsMeta'))).toHaveLength(2);
    });

    it('keeps no answer with something that could not be checked', async () => {
        fx.emailFails = true;
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const first = renderCard();
        expect(await screen.findByText('Some settings could not be checked just now.')).toBeInTheDocument();
        first.unmount();

        fx.emailFails = false;
        renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        expect(fx.reads.filter((read) => read.startsWith('call getEmailSettingsMeta'))).toHaveLength(2);
    });

    it('shows nothing kept to someone who is no longer an admin', async () => {
        const first = renderCard();
        expect(await screen.findByText('Company setup is complete.')).toBeInTheDocument();
        first.unmount();

        renderCard({ role: 'recruiter' });
        await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
        expect(screen.queryByText(/Company setup/)).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
    });
});

describe('for anyone else', () => {
    it.each(['recruiter', 'hr_user'])('a %s sees nothing, and nothing is read', async (role) => {
        renderCard({ role });

        await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
        expect(screen.queryByText(/Company setup/)).toBeNull();
        expect(screen.queryByRole('status')).toBeNull();
        expect(fx.reads).toEqual([]);
    });
});
