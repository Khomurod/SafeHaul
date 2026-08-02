/**
 * Contract freeze for Quick Add Lead.
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
 *  - every navigation destination.
 *
 * All data below is artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function setCompany(companyId = COMPANY_ID) {
    dataMock.value = {
        currentCompanyProfile: companyId ? { id: companyId } : null,
        currentUser: { uid: UID },
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

describe('Quick Add Lead — preserved contracts', () => {
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

    it('writes the frozen payload to companies/{companyId}/leads and navigates to company leads', async () => {
        render(<QuickAddLeadPage />);

        fillRequired();
        setField('email', /email/i, 'artificial@example.test');
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
            email: 'artificial@example.test',
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
        });

        await waitFor(() => expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Lead added successfully!'));
        expect(navigateMock).toHaveBeenCalledWith('/company/drivers/leads/company');
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
            email: '', city: '', state: '', yearsExperience: '', notes: '',
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

    it('cancels back to the dashboard without writing', () => {
        render(<QuickAddLeadPage />);
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

        expect(navigateMock).toHaveBeenCalledWith('/company/dashboard');
        expect(fsMocks.addDoc).not.toHaveBeenCalled();
    });

    it('falls back to "unknown" when the signed-in uid is missing', async () => {
        dataMock.value = {
            currentCompanyProfile: { id: COMPANY_ID },
            currentUser: null,
        };
        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalled());
        expect(fsMocks.addDoc.mock.calls[0][1].createdBy).toBe('unknown');
    });
});
