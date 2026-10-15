/**
 * An application opened from the owner's panel opens at once: the dossier's code
 * loads on that open, and the dialog says so until it arrives.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const fx = vi.hoisted(() => {
    let arrive;
    const code = new Promise((resolve) => { arrive = resolve; });
    return { code, arrive };
});

vi.mock('./modals', () => ({
    EditCompanyModal: () => null,
    EditUserModal: () => null,
    ViewCompanyAppsModal: () => null,
    DeleteCompanyModal: () => null,
    DeleteUserModal: () => null,
}));
vi.mock('@features/company-admin/components/modals/driver-dossier/DriverProfileModal', async () => {
    await fx.code;
    return { DriverProfileModal: ({ companyId, driverId }) => <p>Dossier of {driverId} at {companyId}</p> };
});

import { DashboardModals } from './DashboardModals';

describe('an application opened from the owner panel', () => {
    it('shows the dossier frame at once, and the dossier when its code arrives', async () => {
        render(<DashboardModals selectedApplication={{ companyId: 'company-1', appId: 'app-1' }} onClose={() => {}} />);

        expect(screen.getByRole('dialog', { name: 'Driver dossier' })).toHaveTextContent('Loading driver dossier…');

        fx.arrive();
        expect(await screen.findByText('Dossier of app-1 at company-1')).toBeInTheDocument();
    });
});
