/**
 * Contract freeze for Add lead (formerly Quick Add Lead).
 *
 * Written BEFORE the design-system migration of `QuickAddLeadPage` so the
 * behaviour that must survive presentation changes is pinned first. Everything
 * asserted here is a preserved contract, not a design decision:
 *
 *  - the Firestore collection path `companies/{companyId}/leads`,
 *  - the exact `addDoc` payload keys and values (form keys, `name`,
 *    `companyId`, `status = ATS_STATUS_NEW`, `source = 'manual_entry'`,
 *    `createdBy`, `createdAt`, `updatedAt`),
 *  - the initial form values (including `cdlClass: 'A'`),
 *  - the First Name / Last Name / Phone required rule and its exact message,
 *  - the no-company guard and its exact message,
 *  - the success and failure messages,
 *  - every navigation destination: the person's leads list, with the new
 *    lead's dossier opened over it once saved,
 *  - who the lead is assigned to: nobody for a company admin, the person
 *    saving it for anyone else (decision Д13).
 *
 * All data below is artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataMock = vi.hoisted(() => ({ value: {} }));
const toastMocks = vi.hoisted(() => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const fsMocks = vi.hoisted(() => ({ addDoc: vi.fn() }));

vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@lib/firebase', () => ({ db: { __db: true } }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    addDoc: fsMocks.addDoc,
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));

import { collection } from 'firebase/firestore';
import { ATS_STATUS_NEW } from '@shared/constants/atsStatus';
import { QuickAddLeadPage } from './QuickAddLeadPage';

const COMPANY_ID = 'artificial-company-1';
const UID = 'artificial-user-1';
const COMPANY_LEADS = '/company/drivers/leads/company';
const MY_LEADS = '/company/drivers/leads/my';

function setCompany(companyId = COMPANY_ID, role = 'company_admin') {
    dataMock.value = {
        currentCompanyProfile: companyId ? { id: companyId } : null,
        currentUser: { uid: UID, displayName: 'Artificial Recruiter', email: 'recruiter@example.test' },
        currentUserClaims: { roles: { [COMPANY_ID]: role } },
    };
}

/**
 * Fills a control by its accessible name. Both the pre-migration markup (no
 * label association at all) and the migrated markup must let the test reach the
 * control, so fall back to the form-field `name` attribute when the accessible
 * name is not yet wired up.
 */
function setField(name, labelPattern, value) {
    const byRole = screen.queryByLabelText(labelPattern);
    const control = byRole || document.querySelector(`[name="${name}"]`);
    expect(control, `control ${name} should exist`).toBeTruthy();
    fireEvent.change(control, { target: { name, value } });
    return control;
}

function fillRequired() {
    setField('firstName', /first name/i, 'Artificial');
    setField('lastName', /last name/i, 'Applicant');
    setField('phone', /phone/i, '(555) 000-0000');
}

function submit() {
    const form = document.querySelector('form');
    expect(form, 'the page renders a form').toBeTruthy();
    fireEvent.submit(form);
    return form;
}

beforeEach(() => {
    vi.clearAllMocks();
    setCompany();
    fsMocks.addDoc.mockResolvedValue({ id: 'artificial-lead-1' });
});

describe('Add lead — preserved contracts', () => {
    it('is titled Add lead', () => {
        render(<QuickAddLeadPage />);
        expect(screen.getByRole('heading', { level: 1, name: 'Add lead' })).toBeInTheDocument();
    });

    it('starts with the frozen initial form values', () => {
        render(<QuickAddLeadPage />);

        expect(document.querySelector('[name="firstName"]').value).toBe('');
        expect(document.querySelector('[name="lastName"]').value).toBe('');
        expect(document.querySelector('[name="phone"]').value).toBe('');
        expect(document.querySelector('[name="email"]').value).toBe('');
        expect(document.querySelector('[name="city"]').value).toBe('');
        expect(document.querySelector('[name="state"]').value).toBe('');
        expect(document.querySelector('[name="yearsExperience"]').value).toBe('');
        expect(document.querySelector('[name="cdlClass"]').value).toBe('A');
        expect(document.querySelector('[name="notes"]').value).toBe('');
    });

    it('offers exactly the frozen CDL class options', () => {
        render(<QuickAddLeadPage />);

        const options = [...document.querySelectorAll('[name="cdlClass"] option')];
        expect(options.map((option) => option.value)).toEqual(['A', 'B', 'C', 'None']);
        expect(options.map((option) => option.textContent)).toEqual([
            'Class A', 'Class B', 'Class C', 'No CDL',
        ]);
    });

    it("writes the frozen payload to companies/{companyId}/leads and opens the admin's new lead on company leads", async () => {
        render(<QuickAddLeadPage />);

        fillRequired();
        setField('email', /email/i, 'Artificial@Example.test');
        setField('city', /city/i, 'Artificial City');
        setField('state', /state/i, 'TX');
        setField('yearsExperience', /years of experience/i, '5');
        setField('notes', /notes/i, 'Artificial note');

        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledTimes(1));

        expect(collection).toHaveBeenCalledWith(
            expect.anything(), 'companies', COMPANY_ID, 'leads',
        );
        const [ref, payload] = fsMocks.addDoc.mock.calls[0];
        expect(ref).toEqual({ path: `companies/${COMPANY_ID}/leads` });

        expect(payload).toEqual({
            firstName: 'Artificial',
            lastName: 'Applicant',
            phone: '(555) 000-0000',
            email: 'Artificial@Example.test',
            city: 'Artificial City',
            state: 'TX',
            yearsExperience: '5',
            cdlClass: 'A',
            notes: 'Artificial note',
            companyId: COMPANY_ID,
            name: 'Artificial Applicant',
            createdAt: '__serverTimestamp__',
            updatedAt: '__serverTimestamp__',
            status: ATS_STATUS_NEW,
            source: 'manual_entry',
            createdBy: UID,
            // Unassigned as the lists' Unassigned filter matches it, and the
            // phone key the lead import finds a duplicate by.
            assignedTo: '',
            assignedToName: '',
            normalizedPhone: '5550000000',
            // The email as typed, and the copy an application is matched by.
            emailNormalized: 'artificial@example.test',
        });

        await waitFor(() => expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Lead added successfully!'));
        expect(navigateMock).toHaveBeenCalledWith(COMPANY_LEADS, { state: { openRecordId: 'artificial-lead-1', openRecordCollection: 'leads' } });
    });

    it.each(['recruiter', 'hr_user'])("assigns a %s's lead to them and opens it on My Leads", async (role) => {
        setCompany(COMPANY_ID, role);
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(navigateMock)
            .toHaveBeenCalledWith(MY_LEADS, { state: { openRecordId: 'artificial-lead-1', openRecordCollection: 'leads' } }));
        expect(fsMocks.addDoc.mock.calls[0][1]).toMatchObject({
            assignedTo: UID,
            assignedToName: 'Artificial Recruiter',
            createdBy: UID,
            status: ATS_STATUS_NEW,
            companyId: COMPANY_ID,
        });
    });

    it("names a recruiter's lead by their email when their account has no name", async () => {
        setCompany(COMPANY_ID, 'recruiter');
        dataMock.value.currentUser = { uid: UID, displayName: null, email: 'recruiter@example.test' };
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledTimes(1));
        expect(fsMocks.addDoc.mock.calls[0][1]).toMatchObject({
            assignedTo: UID, assignedToName: 'recruiter@example.test',
        });
    });

    it("leaves a super admin's lead unassigned, as a company admin's", async () => {
        setCompany();
        dataMock.value.currentUserClaims = { globalRole: 'super_admin', roles: {} };
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(navigateMock)
            .toHaveBeenCalledWith(COMPANY_LEADS, { state: { openRecordId: 'artificial-lead-1', openRecordCollection: 'leads' } }));
        expect(fsMocks.addDoc.mock.calls[0][1]).toMatchObject({ assignedTo: '', assignedToName: '' });
    });

    it('keeps ATS_STATUS_NEW as the written status value', async () => {
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalled());
        expect(fsMocks.addDoc.mock.calls[0][1].status).toBe(ATS_STATUS_NEW);
        expect(ATS_STATUS_NEW).toBe('New');
    });

    it('derives `name` by trimming "first last" (whitespace-only last name is accepted today)', async () => {
        // Documented as-is behaviour, not an endorsement: the required rule is a
        // truthiness check, so a whitespace-only last name passes and the derived
        // `name` collapses to just the first name. Frozen so the migration does
        // not silently tighten or loosen the rule.
        render(<QuickAddLeadPage />);
        setField('firstName', /first name/i, 'Solo');
        setField('lastName', /last name/i, '  ');
        setField('phone', /phone/i, '5550000000');
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledTimes(1));
        expect(fsMocks.addDoc.mock.calls[0][1].name).toBe('Solo');
        expect(fsMocks.addDoc.mock.calls[0][1].lastName).toBe('  ');
    });

    it('blocks submission with the frozen required-field message', async () => {
        render(<QuickAddLeadPage />);

        setField('firstName', /first name/i, 'Artificial');
        submit();

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith(
            'Please fill in required fields (First Name, Last Name, Phone).',
        ));
        expect(fsMocks.addDoc).not.toHaveBeenCalled();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it.each([
        ['firstName', /first name/i],
        ['lastName', /last name/i],
        ['phone', /phone/i],
    ])('treats %s as required', async (missing) => {
        render(<QuickAddLeadPage />);
        fillRequired();
        fireEvent.change(document.querySelector(`[name="${missing}"]`), {
            target: { name: missing, value: '' },
        });
        submit();

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith(
            'Please fill in required fields (First Name, Last Name, Phone).',
        ));
        expect(fsMocks.addDoc).not.toHaveBeenCalled();
    });

    it('does not require email, city, state, experience or notes', async () => {
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledTimes(1));
        expect(fsMocks.addDoc.mock.calls[0][1]).toMatchObject({
            email: '', emailNormalized: '', city: '', state: '', yearsExperience: '', notes: '',
        });
    });

    it('reports a write failure with the frozen message and stays on the page', async () => {
        fsMocks.addDoc.mockRejectedValue(new Error('artificial failure'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(toastMocks.showError)
            .toHaveBeenCalledWith('Failed to add lead. Please try again.'));
        expect(navigateMock).not.toHaveBeenCalled();
        expect(toastMocks.showSuccess).not.toHaveBeenCalled();
    });

    it('renders the no-company state and routes to settings', () => {
        setCompany(null);
        render(<QuickAddLeadPage />);

        expect(screen.getByText('No Company Selected')).toBeInTheDocument();
        expect(screen.getByText('Please select a company before adding leads.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /select company/i }));
        expect(navigateMock).toHaveBeenCalledWith('/company/settings');
    });

    it.each([
        ['company_admin', COMPANY_LEADS],
        ['recruiter', MY_LEADS],
    ])("cancels a %s back to their leads list without writing", (role, list) => {
        setCompany(COMPANY_ID, role);
        render(<QuickAddLeadPage />);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        expect(navigateMock).toHaveBeenCalledWith(list);
        expect(fsMocks.addDoc).not.toHaveBeenCalled();
    });

    it('falls back to "unknown" when the signed-in uid is missing', async () => {
        dataMock.value = {
            currentCompanyProfile: { id: COMPANY_ID },
            currentUser: null,
            currentUserClaims: { roles: { [COMPANY_ID]: 'recruiter' } },
        };
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalled());
        expect(fsMocks.addDoc.mock.calls[0][1].createdBy).toBe('unknown');
        // Nobody to assign it to: it is left for an admin to hand out.
        expect(fsMocks.addDoc.mock.calls[0][1]).toMatchObject({ assignedTo: '', assignedToName: '' });
    });
});

/** The page's own header (the card's header is a `<header>` too). */
const pageHeader = () => screen.getByRole('heading', { level: 1 }).closest('header');

describe('Add lead — C2 header', () => {
    it('names the section it belongs to above the title', () => {
        render(<QuickAddLeadPage />);
        expect(within(pageHeader()).getByText('Driver Applications & Leads')).toBeInTheDocument();
    });

    it.each([
        ['company_admin', COMPANY_LEADS],
        ['recruiter', MY_LEADS],
    ])('links a %s back to their leads list, followed inside the app', (role, list) => {
        setCompany(COMPANY_ID, role);
        render(<QuickAddLeadPage />);

        const back = screen.getByRole('link', { name: 'Leads' });
        expect(back).toHaveAttribute('href', list);
        fireEvent.click(back);
        expect(navigateMock).toHaveBeenCalledWith(list);
        expect(fsMocks.addDoc).not.toHaveBeenCalled();
    });

    it("keeps Cancel and Save Lead on the header's row, Save Lead still this form's submit button", async () => {
        render(<QuickAddLeadPage />);

        const header = pageHeader();
        const save = within(header).getByRole('button', { name: 'Save Lead' });
        expect(within(header).getByRole('button', { name: /cancel/i })).toBeInTheDocument();
        expect(save).toHaveAttribute('type', 'submit');
        expect(save.form).toBe(document.querySelector('form'));

        fillRequired();
        fireEvent.click(save);
        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledOnce());
    });

    it('pins the actions to the bottom of a phone screen, as the same two buttons', () => {
        render(<QuickAddLeadPage />);
        expect(pageHeader()).toHaveAttribute('data-mobile-actions', 'sticky');
        expect(screen.getAllByRole('button', { name: /cancel/i })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Save Lead' })).toHaveLength(1);
    });

    it('keeps the fields in their order in one grid, Notes across the whole row', () => {
        const { container } = render(<QuickAddLeadPage />);
        const names = [...container.querySelectorAll('input, select, textarea')].map((control) => control.name);
        expect(names).toEqual([
            'firstName', 'lastName', 'phone', 'email', 'city', 'state', 'yearsExperience', 'cdlClass', 'notes',
        ]);
        expect(screen.getByLabelText(/^Notes/).closest('.ds-form-field')).toHaveClass('col-span-full');
    });
});
