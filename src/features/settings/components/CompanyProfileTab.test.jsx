import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const applyCompanyChanges = vi.hoisted(() => vi.fn());

vi.mock('@features/companies', () => ({
    saveCompanySettings: serviceMocks.saveCompanySettings,
}));
vi.mock('@lib/firebase/storage', () => ({
    uploadCompanyLogo: serviceMocks.uploadCompanyLogo,
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => toastMocks,
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => useDataMock(),
}));

import { companyDetailsOf } from '@features/companies/services/companyDetails';
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
    useDataMock.mockReturnValue({ currentUserClaims: claims, applyCompanyChanges });
    return render(<CompanyProfileTab currentCompanyProfile={company} />);
}

describe('CompanyProfileTab information compatibility slice', () => {
    beforeEach(() => {
        serviceMocks.saveCompanySettings.mockReset();
        serviceMocks.uploadCompanyLogo.mockReset();
        toastMocks.showError.mockReset();
        toastMocks.showSuccess.mockReset();
        useDataMock.mockReset();
        applyCompanyChanges.mockReset();
        // The service returns what it wrote; here, what it was given.
        serviceMocks.saveCompanySettings.mockImplementation(async (_id, data) => data);
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

    it('heads each part with what it holds, above its card', () => {
        renderProfile();
        for (const [title, description] of [
            ['Company', 'Name and logo, as drivers see them.'],
            ['Contact Info', 'How drivers reach you.'],
            ['HQ Address', 'Your main office.'],
        ]) {
            const section = screen.getByRole('region', { name: title });
            expect(within(section).getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
            expect(within(section).getByText(description)).toBeInTheDocument();
        }
        expect(within(screen.getByRole('region', { name: 'Company' })).getByText('SafeHaul Logistics')).toBeInTheDocument();
    });

    it('keeps Cancel and Save Changes in reach at the foot of a phone while editing, drawn once', () => {
        renderProfile();
        const header = screen.getByRole('heading', { level: 1, name: 'Company profile' }).closest('header');
        expect(header).not.toHaveAttribute('data-mobile-actions');

        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        expect(header).toHaveAttribute('data-mobile-actions', 'sticky');
        expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
        expect(screen.getAllByRole('button', { name: 'Save Changes' })).toHaveLength(1);
    });

    it('shows the plan as one read-only line, which Edit Profile does not open', () => {
        renderProfile();
        // No plan set: Free, as the Plan section showed it.
        expect(screen.getByText('Plan')).toBeInTheDocument();
        expect(screen.getByText('Free Plan — to change it, contact support.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        expect(screen.queryByText(/Free Plan/)).toBeNull();
        expect(screen.queryByRole('textbox', { name: 'Plan' })).toBeNull();
    });

    it('shows Pro for a company a super admin put on the paid plan', () => {
        useDataMock.mockReturnValue({ currentUserClaims: { roles: { 'company-1': 'company_admin' } }, applyCompanyChanges });
        render(<CompanyProfileTab currentCompanyProfile={{ ...company, planType: 'paid' }} />);
        expect(screen.getByText('Pro Plan — to change it, contact support.')).toBeInTheDocument();
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

    it('holds the fields still while a save is on its way, so what is shown is what was saved', async () => {
        let finishSave;
        serviceMocks.saveCompanySettings.mockImplementation((_id, data) => new Promise((resolve) => { finishSave = () => resolve(data); }));
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Austin' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(serviceMocks.saveCompanySettings).toHaveBeenCalledTimes(1));

        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Fort Worth' } });
        expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Austin');

        finishSave();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument());
        expect(screen.getByText('Austin')).toBeInTheDocument();
        expect(screen.queryByText('Fort Worth')).toBeNull();
    });

    it('keeps what is typed when the company changes while the fields are open', () => {
        const { rerender } = renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Company Name' }), { target: { value: 'Typed name' } });

        // A logo upload updates the company in use while the fields are open.
        rerender(<CompanyProfileTab currentCompanyProfile={{ ...company, companyLogoUrl: 'https://example.test/new.png' }} />);
        expect(screen.getByRole('textbox', { name: 'Company Name' })).toHaveValue('Typed name');
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
                    companyLogoUrl: company.companyLogoUrl,
                },
            );
        });
        expect(toastMocks.showSuccess)
            .toHaveBeenCalledWith('Company settings saved successfully.');
        expect(screen.getByRole('button', { name: 'Edit Profile' }))
            .toBeInTheDocument();
        // The company in use takes the save, so the header and a return here show it.
        expect(applyCompanyChanges).toHaveBeenCalledWith('company-1', serviceMocks.saveCompanySettings.mock.calls[0][1]);
    });

    // The older Create screen saved flat details, `address` the street line.
    const FLAT_COMPANY = {
        id: 'company-1',
        companyName: 'SafeHaul Logistics',
        phone: '555-0100',
        email: 'dispatch@example.com',
        address: '100 Long Transportation Center Drive',
        city: 'Dallas',
        state: 'TX',
        zip: '75001',
        mcNumber: 'MC123456',
        dotNumber: 'DOT654321',
    };

    it('shows a company created with flat details, and its first save keeps them, street included', async () => {
        useDataMock.mockReturnValue({ currentUserClaims: { roles: { 'company-1': 'company_admin' } }, applyCompanyChanges });
        render(<CompanyProfileTab currentCompanyProfile={FLAT_COMPANY} />);

        expect(screen.getByText('DOT654321')).toBeInTheDocument();
        expect(screen.getByText('100 Long Transportation Center Drive')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(serviceMocks.saveCompanySettings).toHaveBeenCalled());
        expect(serviceMocks.saveCompanySettings.mock.calls[0][1]).toMatchObject({
            contact: { phone: '555-0100', email: 'dispatch@example.com' },
            address: { street: '100 Long Transportation Center Drive', city: 'Dallas', state: 'TX', zip: '75001' },
            legal: { mcNumber: 'MC123456', dotNumber: 'DOT654321' },
        });
    });

    it('clears a detail of a company created with flat details for good', async () => {
        useDataMock.mockReturnValue({ currentUserClaims: { roles: { 'company-1': 'company_admin' } }, applyCompanyChanges });
        render(<CompanyProfileTab currentCompanyProfile={FLAT_COMPANY} />);
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'MC Number' }), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(serviceMocks.saveCompanySettings).toHaveBeenCalled());
        const saved = serviceMocks.saveCompanySettings.mock.calls[0][1];
        expect(saved).toMatchObject({ legal: { mcNumber: '', dotNumber: 'DOT654321' }, mcNumber: '', dotNumber: 'DOT654321' });
        expect(companyDetailsOf({ ...FLAT_COMPANY, ...saved }).mcNumber).toBe('');
    });

    it('puts the information back on Cancel, without saving', () => {
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
        expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Dallas');
    });

    it('does not store a cancelled edit with the next save', async () => {
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), {
            target: { value: 'Fort Worth' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Phone' }), {
            target: { value: '555-0199' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(serviceMocks.saveCompanySettings).toHaveBeenCalledTimes(1));
        const [, saved] = serviceMocks.saveCompanySettings.mock.calls[0];
        expect(saved.address.city).toBe('Dallas');
        expect(saved.contact.phone).toBe('555-0199');
    });

    it('puts back what was saved before, not what the company first held', async () => {
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), {
            target: { value: 'Austin' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), {
            target: { value: 'Fort Worth' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));

        expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Austin');
    });

    it('keeps Cancel unavailable while a save is on its way, so what is saved stays on screen', async () => {
        let finishSave;
        serviceMocks.saveCompanySettings.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Fort Worth' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => expect(serviceMocks.saveCompanySettings).toHaveBeenCalledTimes(1));
        const cancel = screen.getByRole('button', { name: 'Cancel' });
        expect(cancel).toBeDisabled();
        fireEvent.click(cancel);
        expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Fort Worth');

        finishSave();
        await waitFor(() => expect(toastMocks.showSuccess).toHaveBeenCalledWith('Company settings saved successfully.'));
        expect(screen.getByText('Fort Worth')).toBeInTheDocument();
    });

    it('preserves save errors and re-enables the save action', async () => {
        serviceMocks.saveCompanySettings.mockRejectedValueOnce(new Error('offline'));
        // Not the error's own word: a plain sentence.
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderProfile();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

        await waitFor(() => {
            expect(toastMocks.showError)
                .toHaveBeenCalledWith('The company settings could not be saved. Please try again. If it keeps happening, contact support.');
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
            expect(applyCompanyChanges).toHaveBeenCalledWith('company-1', { companyLogoUrl: NEW_LOGO_URL });
        });

        it('ignores a change event with no selected file', () => {
            const { input } = enterEditAndGetInput();
            fireEvent.change(input, { target: { files: [] } });
            expect(serviceMocks.uploadCompanyLogo).not.toHaveBeenCalled();
            expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
        });

        it('preserves the upload failure message and keeps the previous logo', async () => {
            serviceMocks.uploadCompanyLogo.mockRejectedValueOnce(Object.assign(
                new Error('Firebase Storage: User does not have permission to access the logo. (storage/unauthorized)'),
                { code: 'storage/unauthorized' },
            ));
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            const { input } = enterEditAndGetInput();

            fireEvent.change(input, {
                target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] },
            });

            await waitFor(() => {
                expect(toastMocks.showError)
                    .toHaveBeenCalledWith('The logo could not be uploaded. You do not have permission to do this. If you think you should, ask your company admin.');
            });
            expect(serviceMocks.saveCompanySettings).not.toHaveBeenCalled();
            expect(screen.getByRole('img', { name: 'Company logo' }))
                .toHaveAttribute('src', company.companyLogoUrl);
            // The picker is `FileInput`: a label, not a button.
            expect(input).toBeEnabled();
            expect(document.querySelector('.ds-file-input__button-label'))
                .toHaveTextContent('Change logo');
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
                expect(document.querySelector('.ds-file-input__button-label'))
                    .toHaveTextContent('Uploading…');
            });
            expect(input).toBeDisabled();
            expect(input).toHaveAttribute('aria-busy', 'true');

            resolveUpload(NEW_LOGO_URL);
            await waitFor(() => {
                expect(toastMocks.showSuccess).toHaveBeenCalled();
            });
        });

        it('hides the logo upload control from members without edit permission', () => {
            renderProfile({ claims: { roles: { 'company-1': 'company_member' } } });
            expect(document.querySelector('.ds-file-input')).toBeNull();
            expect(document.querySelector('input[type="file"]')).toBeNull();
        });
    });
});
