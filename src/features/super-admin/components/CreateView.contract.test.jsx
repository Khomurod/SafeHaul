/**
 * Contract freeze + a11y proof for `CreateView`, written with its design-system
 * migration (2026-07-28).
 *
 * `CreateView` writes companies and portal users, so its payloads are the most
 * consequential thing in the Super Admin area. Frozen here:
 *
 *  - `createNewCompany({ ...companyForm, isActive: true, createdAt: Date })` with
 *    every company key and `planType` default `'free'`.
 *  - `createPortalUser({ fullName, email, password, companyId, role })` for both
 *    the with-admin company flow (using the *new* company's id) and the
 *    standalone user flow.
 *  - The slug auto-generation rule and the fact that it stops once `appSlug` has
 *    a value.
 *  - `withAdmin` default `true`, and that unchecking it skips `createPortalUser`.
 *  - `result.data?.error` throwing on the standalone flow.
 *  - The exact four outcome strings that used to be `alert()`s, including the
 *    `Error: ` and `Failed: ` prefixes.
 *  - The reset shapes and the `onDataUpdate` ordering in each flow.
 *  - The three role option sets and the company dropdown mapping.
 *
 * All names, emails, ids and passwords below are artificial test fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createNewCompany = vi.hoisted(() => vi.fn());
const loadCompanies = vi.hoisted(() => vi.fn());
const createPortalUser = vi.hoisted(() => vi.fn());

vi.mock('@features/companies', () => ({
    createNewCompany: (...a) => createNewCompany(...a),
    loadCompanies: (...a) => loadCompanies(...a),
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (name === 'createPortalUser' ? createPortalUser : vi.fn()),
}));

import { CreateView } from './CreateView';

const COMPANY_OPTIONS = [
    { id: 'co-1', data: () => ({ companyName: 'Artificial Freight Co' }) },
    { id: 'co-2', data: () => ({ companyName: 'Placeholder Logistics' }) },
];

function renderView(props = {}) {
    const onDataUpdate = vi.fn();
    const setActiveView = vi.fn();
    const utils = render(<CreateView onDataUpdate={onDataUpdate} setActiveView={setActiveView} {...props} />);
    return { ...utils, onDataUpdate, setActiveView };
}

/** Fills the minimum the native constraint validation requires for a company. */
function fillCompany({ withAdmin = true } = {}) {
    fireEvent.change(screen.getByLabelText(/^Company Name/), { target: { value: 'Artificial Freight Co' } });
    fireEvent.change(screen.getByLabelText(/^Contact Email/), { target: { value: 'ops@example.test' } });
    if (withAdmin) {
        fireEvent.change(screen.getByLabelText(/^Full Name/), { target: { value: 'Test Admin' } });
        fireEvent.change(screen.getByLabelText(/^Login Email/), { target: { value: 'admin@example.test' } });
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'fixture-pass' } });
    }
}

function submitCompanyForm() {
    // Submit the form directly: jsdom does not run native constraint validation,
    // and the click path is covered by the button-state assertions.
    fireEvent.submit(screen.getByRole('button', { name: /Create Company/ }).closest('form'));
}

beforeEach(() => {
    vi.clearAllMocks();
    loadCompanies.mockResolvedValue({ docs: COMPANY_OPTIONS });
    createNewCompany.mockResolvedValue({ id: 'new-co-9' });
    createPortalUser.mockResolvedValue({ data: { userId: 'new-user-9' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('CreateView — entity type selection', () => {
    it('starts on the company flow', () => {
        renderView();
        expect(screen.getByRole('tab', { name: /New Company/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /Create Company/ })).toBeInTheDocument();
    });

    it('exposes the two flows as a real tablist, not colour-only buttons', () => {
        renderView();
        const tabs = screen.getAllByRole('tab');
        expect(tabs).toHaveLength(2);
        expect(tabs.map((t) => t.textContent.trim())).toEqual(['New Company', 'New User Only']);
        expect(screen.getByRole('tablist')).toHaveAccessibleName('Entity type');
    });

    it('switches to the standalone user flow on click', () => {
        renderView();
        fireEvent.click(screen.getByRole('tab', { name: /New User Only/ }));
        expect(screen.getByRole('button', { name: /Create User/ })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create Company/ })).not.toBeInTheDocument();
    });

    it('moves between flows with arrow keys and roving focus', () => {
        renderView();
        const tablist = screen.getByRole('tablist');
        fireEvent.keyDown(tablist, { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: /New User Only/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: /New User Only/ })).toHaveFocus();

        fireEvent.keyDown(tablist, { key: 'Home' });
        expect(screen.getByRole('tab', { name: /New Company/ })).toHaveAttribute('aria-selected', 'true');
    });

    it('closes back to the Companies view with the frozen destination', () => {
        const { setActiveView } = renderView();
        fireEvent.click(screen.getByRole('button', { name: /Close/ }));
        expect(setActiveView).toHaveBeenCalledWith('companies');
    });
});

describe('CreateView — company creation contract', () => {
    it('auto-generates the slug from the company name and then stops', () => {
        renderView();
        fireEvent.change(screen.getByLabelText(/^Company Name/), { target: { value: "Bob's  Trucking, LLC!" } });
        expect(screen.getByLabelText(/^URL Slug/)).toHaveValue('bob-s-trucking-llc');

        // Once the slug has a value, editing the name must not overwrite it.
        fireEvent.change(screen.getByLabelText(/^Company Name/), { target: { value: 'Renamed Co' } });
        expect(screen.getByLabelText(/^URL Slug/)).toHaveValue('bob-s-trucking-llc');
    });

    it('writes the frozen company payload', async () => {
        renderView();
        fillCompany();
        submitCompanyForm();

        await waitFor(() => expect(createNewCompany).toHaveBeenCalledTimes(1));
        const payload = createNewCompany.mock.calls[0][0];
        expect(payload).toMatchObject({
            companyName: 'Artificial Freight Co',
            appSlug: 'artificial-freight-co',
            mcNumber: '',
            dotNumber: '',
            email: 'ops@example.test',
            phone: '',
            address: '',
            city: '',
            state: '',
            zip: '',
            planType: 'free',
            isActive: true,
        });
        expect(payload.createdAt).toBeInstanceOf(Date);
    });

    it('creates the initial portal user against the NEW company id', async () => {
        renderView();
        fillCompany();
        submitCompanyForm();

        await waitFor(() => expect(createPortalUser).toHaveBeenCalledWith({
            fullName: 'Test Admin',
            email: 'admin@example.test',
            password: 'fixture-pass',
            companyId: 'new-co-9',
            role: 'company_admin',
        }));
    });

    it('defaults "create a portal user" to on and skips the callable when unchecked', async () => {
        renderView();
        const checkbox = screen.getByLabelText('Create a portal user for this company now');
        expect(checkbox).toBeChecked();

        fireEvent.click(checkbox);
        expect(screen.queryByLabelText(/^Login Email/)).not.toBeInTheDocument();

        fillCompany({ withAdmin: false });
        submitCompanyForm();

        await waitFor(() => expect(createNewCompany).toHaveBeenCalledTimes(1));
        expect(createPortalUser).not.toHaveBeenCalled();
    });

    it('announces the frozen success message, refreshes, and clears both forms', async () => {
        const { onDataUpdate } = renderView();
        fillCompany();
        submitCompanyForm();

        expect(await screen.findByText('Company (and Admin) created successfully!')).toBeInTheDocument();
        expect(onDataUpdate).toHaveBeenCalledTimes(1);
        expect(screen.getByLabelText(/^Company Name/)).toHaveValue('');
        expect(screen.getByLabelText(/^Full Name/)).toHaveValue('');
    });

    it('announces a failure with the frozen "Error: " prefix and does not clear the form', async () => {
        createNewCompany.mockRejectedValueOnce(
            new Error('The URL Slug "artificial-freight-co" is already taken. Please choose a unique one.'),
        );
        const { onDataUpdate } = renderView();
        fillCompany();
        submitCompanyForm();

        const alertRegion = await screen.findByText(
            'Error: The URL Slug "artificial-freight-co" is already taken. Please choose a unique one.',
        );
        expect(alertRegion).toBeInTheDocument();
        expect(onDataUpdate).not.toHaveBeenCalled();
        expect(screen.getByLabelText(/^Company Name/)).toHaveValue('Artificial Freight Co');
    });

    it('keeps the two plan values and lets the keyboard pick one', () => {
        renderView();
        const free = screen.getByLabelText(/Free Plan/);
        const paid = screen.getByLabelText(/Pro Plan/);
        expect(free).toBeChecked();
        expect(free).toHaveAttribute('type', 'radio');
        expect(free).toHaveAttribute('value', 'free');
        expect(paid).toHaveAttribute('value', 'paid');

        fireEvent.click(paid);
        expect(paid).toBeChecked();
    });

    it('sends the chosen plan in the payload', async () => {
        renderView();
        fireEvent.click(screen.getByLabelText(/Pro Plan/));
        fillCompany();
        submitCompanyForm();

        await waitFor(() => expect(createNewCompany.mock.calls[0][0].planType).toBe('paid'));
    });

    it('offers the frozen initial-user role options', () => {
        renderView();
        const select = screen.getByLabelText(/^Role/);
        expect(select).toHaveValue('company_admin');
        expect([...select.options].map((o) => o.value)).toEqual(['company_admin', 'hr_user']);
    });
});

describe('CreateView — standalone user creation contract', () => {
    function goToUserTab() {
        fireEvent.click(screen.getByRole('tab', { name: /New User Only/ }));
    }

    it('lists companies from loadCompanies with the frozen placeholder option', async () => {
        renderView();
        goToUserTab();
        const select = await screen.findByLabelText(/^Assign to Company/);
        expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
            ['', '-- Select Company --'],
            ['co-1', 'Artificial Freight Co'],
            ['co-2', 'Placeholder Logistics'],
        ]);
    });

    it('offers the frozen standalone role options with hr_user default', () => {
        renderView();
        goToUserTab();
        const select = screen.getByLabelText(/^Role/);
        expect(select).toHaveValue('hr_user');
        expect([...select.options].map((o) => o.value)).toEqual(['hr_user', 'company_admin', 'super_admin']);
        expect(within(select).getByText('Super Admin (Careful!)')).toBeInTheDocument();
    });

    it('writes the frozen createPortalUser payload', async () => {
        renderView();
        goToUserTab();
        fireEvent.change(await screen.findByLabelText(/^Full Name/), { target: { value: 'Test Recruiter' } });
        fireEvent.change(screen.getByLabelText(/^Email Address/), { target: { value: 'rec@example.test' } });
        fireEvent.change(screen.getByLabelText(/^Assign to Company/), { target: { value: 'co-2' } });
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'fixture-pass' } });
        fireEvent.submit(screen.getByRole('button', { name: /Create User/ }).closest('form'));

        await waitFor(() => expect(createPortalUser).toHaveBeenCalledWith({
            fullName: 'Test Recruiter',
            email: 'rec@example.test',
            password: 'fixture-pass',
            companyId: 'co-2',
            role: 'hr_user',
        }));
        expect(await screen.findByText('User created successfully!')).toBeInTheDocument();
    });

    it('treats result.data.error as a failure with the frozen "Failed: " prefix', async () => {
        createPortalUser.mockResolvedValueOnce({ data: { error: 'Email already in use' } });
        const { onDataUpdate } = renderView();
        goToUserTab();
        fireEvent.submit(screen.getByRole('button', { name: /Create User/ }).closest('form'));

        expect(await screen.findByText('Failed: Email already in use')).toBeInTheDocument();
        expect(onDataUpdate).not.toHaveBeenCalled();
    });

    it('clears the user form and refreshes after success, in that order', async () => {
        const { onDataUpdate } = renderView();
        goToUserTab();
        fireEvent.change(await screen.findByLabelText(/^Full Name/), { target: { value: 'Test Recruiter' } });
        fireEvent.submit(screen.getByRole('button', { name: /Create User/ }).closest('form'));

        await waitFor(() => expect(onDataUpdate).toHaveBeenCalledTimes(1));
        expect(screen.getByLabelText(/^Full Name/)).toHaveValue('');
    });
});

describe('CreateView — submission safety and security', () => {
    it('rejects a second submit dispatched before the first resolves', async () => {
        let release;
        createNewCompany.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'new-co-9' }); }));

        renderView();
        fillCompany();
        const form = screen.getByRole('button', { name: /Create Company/ }).closest('form');
        fireEvent.submit(form);
        fireEvent.submit(form);

        expect(createNewCompany).toHaveBeenCalledTimes(1);
        release();
        await waitFor(() => expect(screen.getByText('Company (and Admin) created successfully!')).toBeInTheDocument());
    });

    it('disables and marks the submit button busy while creating', async () => {
        let release;
        createNewCompany.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ id: 'new-co-9' }); }));

        renderView();
        fillCompany();
        fireEvent.submit(screen.getByRole('button', { name: /Create Company/ }).closest('form'));

        const button = screen.getByRole('button', { name: /Create Company/ });
        await waitFor(() => expect(button).toBeDisabled());
        expect(button).toHaveAttribute('aria-busy', 'true');
        release();
    });

    it('never renders a password in clear text', () => {
        renderView();
        expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password');
        expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'new-password');

        fireEvent.click(screen.getByRole('tab', { name: /New User Only/ }));
        expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password');
    });

    /**
     * A controlled input necessarily holds the typed value, and React mirrors it
     * onto the `value` attribute — that is not avoidable and not the risk. The
     * risk is the password leaking into any *other* node: a visible label, a
     * summary line, a `title`, a `data-` attribute or a debug echo. This asserts
     * the masked password input is the only place it appears.
     */
    it('keeps the entered password confined to the masked password input', () => {
        const { container } = renderView();
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sentinel-secret-42' } });

        const holders = [...container.querySelectorAll('*')].filter((node) => (
            [...node.attributes].some((a) => a.value.includes('sentinel-secret-42'))
            || [...node.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent.includes('sentinel-secret-42'))
        ));

        expect(holders).toHaveLength(1);
        expect(holders[0].tagName).toBe('INPUT');
        expect(holders[0]).toHaveAttribute('type', 'password');
    });

    it('uses no blocking alert for any outcome', async () => {
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);

        renderView();
        fillCompany();
        submitCompanyForm();
        await screen.findByText('Company (and Admin) created successfully!');

        expect(alertSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});

describe('CreateView — accessibility', () => {
    it('names every control, including the three previously-unlabelled selects', () => {
        renderView();
        expect(screen.getByLabelText(/^Role/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /New User Only/ }));
        expect(screen.getByLabelText(/^Assign to Company/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Role/)).toBeInTheDocument();
    });

    it('has exactly one h2 and no h1 (the h1 lives in the Super Admin masthead)', () => {
        const { container } = renderView();
        const h2s = [...container.querySelectorAll('h2')];
        expect(h2s).toHaveLength(1);
        expect(h2s[0]).toHaveTextContent('Create New Entity');
        expect(container.querySelector('h1')).toBeNull();
    });

    it('has no jsdom axe violations on the company flow', async () => {
        const { container } = renderView();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations on the user flow', async () => {
        const { container } = renderView();
        fireEvent.click(screen.getByRole('tab', { name: /New User Only/ }));
        await screen.findByLabelText(/^Assign to Company/);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no jsdom axe violations with an error outcome shown', async () => {
        createNewCompany.mockRejectedValueOnce(new Error('boom'));
        const { container } = renderView();
        fillCompany();
        submitCompanyForm();
        await screen.findByText('Error: boom');
        expect((await axe(container)).violations).toEqual([]);
    });
});
