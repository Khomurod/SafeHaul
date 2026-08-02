import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    saveCompanySettings: vi.fn(),
    uploadCompanyLogo: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
    showError: vi.fn(),
    showSuccess: vi.fn(),
}));

const useDataMock = vi.hoisted(() => vi.fn());

vi.mock('@features/companies', () => ({
    saveCompanySettings: serviceMocks.saveCompanySettings,
}));
vi.mock('@lib/firebase', () => ({
    uploadCompanyLogo: serviceMocks.uploadCompanyLogo,
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => toastMocks,
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => useDataMock(),
}));

import { CompanyProfileTab } from './CompanyProfileTab';

const company = {
    id: 'company-1',
    companyName: 'SafeHaul Logistics',
    contact: {
        phone: '555-0100',
        email: 'dispatch@example.com',
    },
    address: {
        street: '100 Long Transportation Center Drive',
        city: 'Dallas',
        state: 'TX',
        zip: '75001',
    },
    legal: {
        mcNumber: 'MC123456',
        dotNumber: 'DOT654321',
    },
    companyLogoUrl: 'https://example.com/logo.png',
    applicationConfig: {
        requireCdl: true,
        nested: { preserved: 'yes' },
    },
    customQuestions: [
        { id: 'question-1', text: 'Can you drive nights?' },
    ],
};

function renderProfile({
    claims = { roles: { 'company-1': 'company_admin' } },
} = {}) {
    useDataMock.mockReturnValue({ currentUserClaims: claims });
    return render(<CompanyProfileTab currentCompanyProfile={company} />);
}

describe('CompanyProfileTab information compatibility slice', () => {
    beforeEach(() => {
        serviceMocks.saveCompanySettings.mockReset();
        serviceMocks.uploadCompanyLogo.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        useDataMock.mockReset();
        serviceMocks.saveCompanySettings.mockResolvedValue();
    });

    it('loads every company information value into labelled display fields', () => {
        renderProfile();

        expect(screen.getByText('SafeHaul Logistics')).toBeInTheDocument();
        expect(screen.getByText('MC123456')).toBeInTheDocument();
        expect(screen.getByText('DOT654321')).toBeInTheDocument();
        expect(screen.getByText('555-0100')).toBeInTheDocument();
        expect(screen.getByText('dispatch@example.com')).toBeInTheDocument();
        expect(screen.getByText('100 Long Transportation Center Drive'))
            .toBeInTheDocument();
        expect(screen.getByText('Dallas')).toBeInTheDocument();
        expect(screen.getByText('TX')).toBeInTheDocument();
        expect(screen.getByText('75001')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('exposes accessible editable fields with the original field keys', () => {
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

        const companyName = screen.getByRole('textbox', { name: 'Company Name' });
        expect(companyName).toHaveAttribute('name', 'companyName');
        expect(companyName).toHaveFocus();
        expect(screen.getByRole('textbox', { name: 'MC Number' }))
            .toHaveAttribute('name', 'mcNumber');
        expect(screen.getByRole('textbox', { name: 'DOT Number' }))
            .toHaveAttribute('name', 'dotNumber');
        expect(screen.getByRole('textbox', { name: 'Phone' }))
            .toHaveAttribute('name', 'phone');
        expect(screen.getByRole('textbox', { name: 'Email' }))
            .toHaveAttribute('type', 'email');
        expect(screen.getByRole('textbox', { name: 'State' }))
            .toHaveAttribute('maxlength', '2');
    });

    it('preserves the exact nested save payload and success behavior', async () => {
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

        fireEvent.change(screen.getByRole('textbox', { name: 'Company Name' }), {
            target: { value: 'Updated SafeHaul' },
        });
        fireEvent.change(screen.getByRole('textbox', { name: 'Phone' }), {
            target: { value: '555-0199' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith(
                'company-1',
                {
                    companyName: 'Updated SafeHaul',
                    contact: {
                        phone: '555-0199',
                        email: 'dispatch@example.com',
                    },
                    address: {
                        street: '100 Long Transportation Center Drive',
                        city: 'Dallas',
                        state: 'TX',
                        zip: '75001',
                    },
                    legal: {
                        mcNumber: 'MC123456',
                        dotNumber: 'DOT654321',
                    },
                    applicationConfig: company.applicationConfig,
                    customQuestions: company.customQuestions,
                    companyLogoUrl: company.companyLogoUrl,
                },
            );
        });
        expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Company settings saved successfully.');
        expect(screen.getByRole('button', { name: 'Edit Profile' }))
            .toBeInTheDocument();
    });

    it('preserves the existing cancel behavior without saving', () => {
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), {
            target: { value: 'Fort Worth' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
        const editProfile = screen.getByRole('button', { name: 'Edit Profile' });
        expect(editProfile).toHaveFocus();
        fireEvent.click(editProfile);
        expect(screen.getByRole('textbox', { name: 'City' }))
            .toHaveValue('Fort Worth');
    });

    it('preserves save errors and re-enables the save action', async () => {
        serviceMocks.saveCompanySettings.mockRejectedValueOnce(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('Failed to save settings: offline');
        });
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
        consoleError.mockRestore();
    });

    it('preserves the company-admin edit permission', () => {
        renderProfile({
            claims: { roles: { 'company-1': 'company_member' } },
        });

        expect(screen.queryByRole('button', { name: 'Edit Profile' }))
            .not.toBeInTheDocument();
    });

    it('has no structural accessibility violations in display or edit mode', async () => {
        const { container } = renderProfile();
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        expect((await axe(container)).violations).toEqual([]);
    });

    describe('branding logo upload', () => {
        const NEW_LOGO_URL = 'https://cdn.example.test/company-1/logo-new.png';

        function enterEditAndGetInput() {
            const view = renderProfile();
            fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
            const input = view.container.querySelector('input[type="file"]');
            return { ...view, input };
        }

        it('uploads to Storage then persists only the logo URL to Firestore', async () => {
            serviceMocks.uploadCompanyLogo.mockResolvedValue(NEW_LOGO_URL);
            const { input } = enterEditAndGetInput();

            const file = new File(['x'], 'logo.png', { type: 'image/png' });
            fireEvent.change(input, { target: { files: [file] } });

            await waitFor(() => {
                expect(serviceMocks.uploadCompanyLogo).toHaveBeenCalledWith('company-1', file);
            });
            expect(serviceMocks.saveCompanySettings).toHaveBeenCalledWith('company-1', {
                companyLogoUrl: NEW_LOGO_URL,
            });
            expect(toastMocks.showSuccess).toHaveBeenCalledWith('Logo uploaded successfully!');
            await waitFor(() => {
                expect(screen.getByRole('img', { name: 'Company logo' }))
                    .toHaveAttribute('src', NEW_LOGO_URL);
            });
        });

        it('ignores a change event with no selected file', () => {
            const { input } = enterEditAndGetInput();
            fireEvent.change(input, { target: { files: [] } });
            expect(serviceMocks.uploadCompanyLogo).not.toHaveBeenCalled();
            expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
        });

        it('preserves the upload failure message and keeps the previous logo', async () => {
            serviceMocks.uploadCompanyLogo.mockRejectedValueOnce(new Error('storage/unauthorized'));
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const { input } = enterEditAndGetInput();

            fireEvent.change(input, {
                target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] },
            });

            await waitFor(() => {
                expect(toastMocks.showError)
                    .toHaveBeenCalledWith('Logo upload failed: storage/unauthorized');
            });
            expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
            expect(screen.getByRole('img', { name: 'Company logo' }))
                .toHaveAttribute('src', company.companyLogoUrl);
            expect(screen.getByRole('button', { name: 'Change logo' })).toBeEnabled();
            consoleError.mockRestore();
        });

        it('disables the upload controls while the upload is in flight', async () => {
            let resolveUpload;
            serviceMocks.uploadCompanyLogo.mockImplementation(
                () => new Promise((resolve) => { resolveUpload = resolve; }),
            );
            const { input } = enterEditAndGetInput();

            fireEvent.change(input, {
                target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] },
            });

            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();
            });
            expect(input).toBeDisabled();

            resolveUpload(NEW_LOGO_URL);
            await waitFor(() => {
                expect(toastMocks.showSuccess).toHaveBeenCalled();
            });
        });

        it('hides the logo upload control from members without edit permission', () => {
            renderProfile({ claims: { roles: { 'company-1': 'company_member' } } });
            expect(screen.queryByRole('button', { name: /change logo|upload logo/i }))
                .not.toBeInTheDocument();
            expect(document.querySelector('input[type="file"]')).toBeNull();
        });
    });
});
