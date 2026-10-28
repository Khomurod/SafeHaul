import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { AddPersonDialog } from './AddPersonDialog';

function renderDialog() {
    const onClose = vi.fn();
    const onAdded = vi.fn();
    return { onClose, onAdded, ...render(<AddPersonDialog companyId="company-1" onClose={onClose} onAdded={onAdded} />) };
}

function fillForm({ password = ARTIFICIAL_PASSWORD } = {}) {
    fireEvent.change(screen.getByRole('textbox', { name: /Full Name/i }), { target: { value: 'Artificial Recruiter' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Email/i }), { target: { value: 'artificial@example.test' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: password } });
}

const submit = () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^Add person/ }));

describe('AddPersonDialog', () => {
    beforeEach(() => {
        mocks.createFn.mockReset();
        mocks.showSuccess.mockReset();
        mocks.showError.mockReset();
        mocks.createFn.mockResolvedValue({ data: { success: true } });
    });

    it('is a dialog named "Add person"', () => {
        renderDialog();
        expect(screen.getByRole('dialog', { name: 'Add person' })).toBeInTheDocument();
    });

    it('renders empty fields, the default role, and exactly the two exposed role options', () => {
        renderDialog();
        expect(screen.getByRole('textbox', { name: /Full Name/i })).toHaveValue('');
        expect(screen.getByRole('textbox', { name: /Email/i })).toHaveValue('');
        expect(screen.getByLabelText(/Password/i)).toHaveValue('');

        const role = screen.getByRole('combobox', { name: /Role/i });
        expect(role).toHaveValue('hr_user');
        const options = Array.from(role.querySelectorAll('option')).map((o) => `${o.value}:${o.textContent}`);
        expect(options).toEqual(['hr_user:Recruiter (Standard)', 'company_admin:Company Admin (Full Access)']);
    });

    it('exposes required, typed inputs with safe autocomplete', () => {
        renderDialog();
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
        renderDialog();
        fillForm();
        fireEvent.change(screen.getByRole('combobox', { name: /Role/i }), { target: { value: 'company_admin' } });
        submit();

        await waitFor(() => expect(mocks.createFn).toHaveBeenCalledWith({
            fullName: 'Artificial Recruiter',
            email: 'artificial@example.test',
            password: ARTIFICIAL_PASSWORD,
            companyId: 'company-1',
            role: 'company_admin',
        }));
    });

    it('toasts success, refreshes the team and closes', async () => {
        const { onClose, onAdded } = renderDialog();
        fillForm();
        submit();

        await waitFor(() => expect(mocks.showSuccess).toHaveBeenCalledWith('User Artificial Recruiter created successfully!'));
        expect(onAdded).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('says an email that already had an account was added, keeping its own password', async () => {
        mocks.createFn.mockResolvedValue({
            data: { status: 'success', message: 'User added to company. They keep their existing password.' },
        });
        renderDialog();
        fillForm();
        submit();

        await waitFor(() => expect(mocks.showSuccess)
            .toHaveBeenCalledWith('User added to company. They keep their existing password.'));
    });

    it('disables the submit control while creating', async () => {
        let resolveCreate;
        mocks.createFn.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));
        renderDialog();
        fillForm();
        submit();
        await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^Add person/ })).toBeDisabled());
        resolveCreate({ data: {} });
        await waitFor(() => expect(mocks.showSuccess).toHaveBeenCalled());
    });

    it('surfaces the backend failure message, stays open, and never logs the password', async () => {
        mocks.createFn.mockRejectedValue(new Error('This email is already registered.'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { onClose } = renderDialog();
        fillForm();
        submit();

        await waitFor(() => expect(mocks.showError)
            .toHaveBeenCalledWith('Failed to create user: This email is already registered.'));
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain(ARTIFICIAL_PASSWORD);
        expect(window.localStorage.getItem('password')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect(within(screen.getByRole('dialog')).getByRole('button', { name: /^Add person/ })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('closes from Cancel without creating anyone', () => {
        const { onClose } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(mocks.createFn).not.toHaveBeenCalled();
    });

    it('has no accessibility violations', async () => {
        const { container } = renderDialog();
        expect((await axe(container)).violations).toEqual([]);
    });
});
