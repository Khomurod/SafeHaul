import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial data only. Never a real password.
const ARTIFICIAL_PASSWORD = 'NOT_A_REAL_PASSWORD_test_123';

const mocks = vi.hoisted(() => ({
    createFn: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.createFn }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => ({ showSuccess: mocks.showSuccess, showError: mocks.showError }) }));

import { TeamManagementTab } from './TeamManagementTab';

const company = { id: 'company-1' };

function renderTab({ isCompanyAdmin = true, onShowManageTeam = vi.fn() } = {}) {
    return {
        onShowManageTeam,
        ...render(
            <TeamManagementTab
                currentCompanyProfile={company}
                isCompanyAdmin={isCompanyAdmin}
                onShowManageTeam={onShowManageTeam}
            />,
        ),
    };
}

function fillForm({ password = ARTIFICIAL_PASSWORD } = {}) {
    fireEvent.change(screen.getByRole('textbox', { name: /Full Name/i }), { target: { value: 'Artificial Recruiter' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Email/i }), { target: { value: 'artificial@example.test' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: password } });
}

describe('TeamManagementTab — Add New User', () => {
    beforeEach(() => {
        mocks.createFn.mockReset();
        mocks.showSuccess.mockReset();
        mocks.showError.mockReset();
        mocks.createFn.mockResolvedValue({ data: { success: true } });
    });

    it('denies non-admins without rendering the form', () => {
        renderTab({ isCompanyAdmin: false });
        expect(screen.getByText('Access Denied. Only Admins can manage the team.')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: /Full Name/i })).not.toBeInTheDocument();
    });

    it('renders empty fields, the default role, and exactly the two exposed role options', () => {
        renderTab();
        expect(screen.getByRole('textbox', { name: /Full Name/i })).toHaveValue('');
        expect(screen.getByRole('textbox', { name: /Email/i })).toHaveValue('');
        expect(screen.getByLabelText(/Password/i)).toHaveValue('');

        const role = screen.getByRole('combobox', { name: /Role/i });
        expect(role).toHaveValue('hr_user');
        const options = Array.from(role.querySelectorAll('option')).map((o) => `${o.value}:${o.textContent}`);
        expect(options).toEqual(['hr_user:Recruiter (Standard)', 'company_admin:Company Admin (Full Access)']);
    });

    it('exposes required, typed inputs with safe autocomplete', () => {
        renderTab();
        const email = screen.getByRole('textbox', { name: /Email/i });
        const password = screen.getByLabelText(/Password/i);
        expect(screen.getByRole('textbox', { name: /Full Name/i })).toBeRequired();
        expect(email).toBeRequired();
        expect(email).toHaveAttribute('type', 'email');
        expect(email).toHaveAttribute('autocomplete', 'off');
        expect(password).toBeRequired();
        expect(password).toHaveAttribute('type', 'password');
        expect(password).toHaveAttribute('autocomplete', 'new-password');
    });

    it('submits the exact createPortalUser request', async () => {
        renderTab();
        fillForm();
        fireEvent.change(screen.getByRole('combobox', { name: /Role/i }), { target: { value: 'company_admin' } });
        fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

        await waitFor(() => expect(mocks.createFn).toHaveBeenCalledWith({
            fullName: 'Artificial Recruiter',
            email: 'artificial@example.test',
            password: ARTIFICIAL_PASSWORD,
            companyId: 'company-1',
            role: 'company_admin',
        }));
    });

    it('shows the success toast and fully resets the form (password cleared)', async () => {
        renderTab();
        fillForm();
        fireEvent.change(screen.getByRole('combobox', { name: /Role/i }), { target: { value: 'company_admin' } });
        fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

        await waitFor(() => expect(mocks.showSuccess).toHaveBeenCalledWith('User Artificial Recruiter created successfully!'));
        expect(screen.getByRole('textbox', { name: /Full Name/i })).toHaveValue('');
        expect(screen.getByRole('textbox', { name: /Email/i })).toHaveValue('');
        expect(screen.getByLabelText(/Password/i)).toHaveValue('');
        expect(screen.getByRole('combobox', { name: /Role/i })).toHaveValue('hr_user');
    });

    it('disables the submit control while creating', async () => {
        let resolveCreate;
        mocks.createFn.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
        renderTab();
        fillForm();
        fireEvent.click(screen.getByRole('button', { name: /Create User/i }));
        await waitFor(() => expect(screen.getByRole('button', { name: /Create User/i })).toBeDisabled());
        resolveCreate({ data: {} });
        await waitFor(() => expect(mocks.showSuccess).toHaveBeenCalled());
    });

    it('surfaces the backend failure message and never logs the password', async () => {
        mocks.createFn.mockRejectedValue(new Error('This email is already registered.'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderTab();
        fillForm();
        fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

        await waitFor(() => expect(mocks.showError)
            .toHaveBeenCalledWith('Failed to create user: This email is already registered.'));

        const allConsoleArgs = JSON.stringify(consoleError.mock.calls);
        expect(allConsoleArgs).not.toContain(ARTIFICIAL_PASSWORD);
        expect(window.localStorage.getItem('password')).toBeNull();
        expect(screen.getByRole('button', { name: /Create User/i })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('opens the Manage Team view from the link', () => {
        const { onShowManageTeam } = renderTab();
        fireEvent.click(screen.getByRole('button', { name: /View All Team Members & Goals/i }));
        expect(onShowManageTeam).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations', async () => {
        const { container } = renderTab();
        expect((await axe(container)).violations).toEqual([]);
    });
});
