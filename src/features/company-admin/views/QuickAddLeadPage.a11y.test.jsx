/**
 * Accessibility and defect-fix proof for the migrated `QuickAddLeadPage`.
 *
 * `QuickAddLeadPage.contract.test.jsx` freezes the payload, the required rule
 * and the navigation. This file asserts what the migration fixed: labelling,
 * reachable validation with focus management, duplicate-submit protection and
 * autofill support.
 *
 * All data below is artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dataMock = vi.hoisted(() => ({ value: {} }));
const toastMocks = vi.hoisted(() => ({
    showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
const fsMocks = vi.hoisted(() => ({ addDoc: vi.fn() }));

vi.mock('@/context/DataContext', () => ({ useData: () => dataMock.value }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
    addDoc: fsMocks.addDoc,
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));

import { QuickAddLeadPage } from './QuickAddLeadPage';

const COMPANY_ID = 'artificial-company-1';

const FIELD_NAMES = [
    ['First Name', 'firstName'],
    ['Last Name', 'lastName'],
    ['Phone', 'phone'],
    ['Email', 'email'],
    ['City', 'city'],
    ['State', 'state'],
    ['Years of Experience', 'yearsExperience'],
    ['CDL Class', 'cdlClass'],
    ['Notes', 'notes'],
];

function fillRequired() {
    fireEvent.change(screen.getByLabelText(/First Name/), { target: { name: 'firstName', value: 'Artificial' } });
    fireEvent.change(screen.getByLabelText(/Last Name/), { target: { name: 'lastName', value: 'Applicant' } });
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { name: 'phone', value: '(555) 000-0000' } });
}

function submit() {
    fireEvent.submit(document.querySelector('form'));
}

beforeEach(() => {
    vi.clearAllMocks();
    dataMock.value = {
        currentCompanyProfile: { id: COMPANY_ID },
        currentUser: { uid: 'artificial-user-1' },
    };
    fsMocks.addDoc.mockResolvedValue({ id: 'artificial-lead-1' });
});

describe('QuickAddLeadPage — labelling (defect 1)', () => {
    it('gives every control an accessible name tied to its form key', () => {
        render(<QuickAddLeadPage />);

        for (const [label, name] of FIELD_NAMES) {
            const control = screen.getByLabelText(new RegExp(`^${label}`));
            expect(control, `${label} is labelled`).toBeTruthy();
            expect(control.getAttribute('name')).toBe(name);
        }
    });

    it('marks the three required fields as required to assistive technology', () => {
        render(<QuickAddLeadPage />);

        for (const label of ['First Name', 'Last Name', 'Phone']) {
            expect(screen.getByLabelText(new RegExp(`^${label}`)))
                .toHaveAttribute('aria-required', 'true');
        }
        expect(screen.getByLabelText(/^Email/)).not.toHaveAttribute('aria-required');
    });

    it('renders a single level-1 page heading', () => {
        render(<QuickAddLeadPage />);
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Quick Add Lead');
    });
});

describe('QuickAddLeadPage — reachable validation with focus (defect 2)', () => {
    it('runs application validation instead of deferring to the browser bubble', () => {
        render(<QuickAddLeadPage />);
        expect(document.querySelector('form')).toHaveAttribute('novalidate');
    });

    it('shows the frozen message, marks the fields invalid and focuses the first one', async () => {
        render(<QuickAddLeadPage />);
        submit();

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalledWith(
            'Please fill in required fields (First Name, Last Name, Phone).',
        ));

        const first = screen.getByLabelText(/^First Name/);
        expect(first).toHaveAttribute('aria-invalid', 'true');
        expect(document.activeElement).toBe(first);

        const alerts = screen.getAllByRole('alert').map((node) => node.textContent);
        expect(alerts).toEqual([
            'First Name is required.',
            'Last Name is required.',
            'Phone is required.',
        ]);
    });

    it('associates each error with its own field', async () => {
        render(<QuickAddLeadPage />);
        submit();

        await waitFor(() => expect(toastMocks.showError).toHaveBeenCalled());

        const phone = screen.getByLabelText(/^Phone/);
        const describedBy = phone.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy.split(' ').pop()))
            .toHaveTextContent('Phone is required.');
    });

    it('focuses the first field that is actually missing, not always the first field', async () => {
        render(<QuickAddLeadPage />);
        fireEvent.change(screen.getByLabelText(/^First Name/), {
            target: { name: 'firstName', value: 'Artificial' },
        });
        submit();

        await waitFor(() => expect(document.activeElement)
            .toBe(screen.getByLabelText(/^Last Name/)));
    });

    it('clears a field error as soon as the field is edited', async () => {
        render(<QuickAddLeadPage />);
        submit();
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));

        fireEvent.change(screen.getByLabelText(/^Phone/), {
            target: { name: 'phone', value: '5550000000' },
        });
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
        expect(screen.getByLabelText(/^Phone/)).not.toHaveAttribute('aria-invalid');
    });

    it('clears every error once a valid submission goes through', async () => {
        render(<QuickAddLeadPage />);
        submit();
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));

        fillRequired();
        submit();

        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledTimes(1));
        expect(screen.queryAllByRole('alert')).toHaveLength(0);
    });
});

describe('QuickAddLeadPage — duplicate submission (defect 3)', () => {
    it('writes once even when the form is submitted twice in the same tick', async () => {
        let resolveWrite;
        fsMocks.addDoc.mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));

        render(<QuickAddLeadPage />);
        fillRequired();

        const form = document.querySelector('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(fsMocks.addDoc).toHaveBeenCalledTimes(1);

        resolveWrite({ id: 'artificial-lead-1' });
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledTimes(1));
        expect(navigateMock).toHaveBeenCalledTimes(1);
    });

    it('marks the submit control busy and disabled while saving', async () => {
        let resolveWrite;
        fsMocks.addDoc.mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));

        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        const saving = await screen.findByRole('button', { name: /Saving\.\.\./ });
        expect(saving).toBeDisabled();
        expect(saving).toHaveAttribute('aria-busy', 'true');

        resolveWrite({ id: 'artificial-lead-1' });
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalled());
    });

    it('allows a retry after a failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fsMocks.addDoc.mockRejectedValueOnce(new Error('artificial failure'));

        render(<QuickAddLeadPage />);
        fillRequired();
        submit();

        await waitFor(() => expect(toastMocks.showError)
            .toHaveBeenCalledWith('Failed to add lead. Please try again.'));

        fsMocks.addDoc.mockResolvedValue({ id: 'artificial-lead-1' });
        submit();
        await waitFor(() => expect(fsMocks.addDoc).toHaveBeenCalledTimes(2));
        expect(navigateMock).toHaveBeenCalledWith('/company/drivers/leads/company');
    });
});

describe('QuickAddLeadPage — autofill (defect 4)', () => {
    it.each([
        ['First Name', 'given-name'],
        ['Last Name', 'family-name'],
        ['Phone', 'tel'],
        ['Email', 'email'],
        ['City', 'address-level2'],
        ['State', 'address-level1'],
    ])('gives %s the %s autocomplete token', (label, token) => {
        render(<QuickAddLeadPage />);
        expect(screen.getByLabelText(new RegExp(`^${label}`)))
            .toHaveAttribute('autocomplete', token);
    });
});

describe('QuickAddLeadPage — axe', () => {
    it('has no violations in the default state', async () => {
        const { container } = render(<QuickAddLeadPage />);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with validation errors on screen', async () => {
        const { container } = render(<QuickAddLeadPage />);
        submit();
        await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(3));
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations while saving', async () => {
        let resolveWrite;
        fsMocks.addDoc.mockImplementation(() => new Promise((resolve) => { resolveWrite = resolve; }));

        const { container } = render(<QuickAddLeadPage />);
        fillRequired();
        submit();
        await screen.findByRole('button', { name: /Saving\.\.\./ });

        expect((await axe(container)).violations).toEqual([]);
        resolveWrite({ id: 'artificial-lead-1' });
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalled());
    });

    it('has no violations in the no-company state', async () => {
        dataMock.value = { currentCompanyProfile: null, currentUser: null };
        const { container } = render(<QuickAddLeadPage />);

        expect(screen.getByRole('heading', { level: 1, name: 'No Company Selected' }))
            .toBeInTheDocument();
        expect((await axe(container)).violations).toEqual([]);
    });
});
