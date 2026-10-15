/**
 * The driver dossier opens at once. Its code is a chunk of its own; until that
 * chunk arrives the dialog shows the dossier's frame and says it is loading, and
 * Escape closes it.
 *
 * All ids below are artificial.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fx = vi.hoisted(() => {
    let arrive;
    const code = new Promise((resolve) => { arrive = resolve; });
    return { code, arrive, requested: false };
});

vi.mock('./DriverProfileModal', async () => {
    fx.requested = true;
    await fx.code;
    return { DriverProfileModal: ({ driverId }) => <p>Dossier of {driverId}</p> };
});

import { DriverDossier } from './DriverDossier';

describe('the driver dossier', () => {
    it('asks for nothing while no record is open', () => {
        const { container } = render(<DriverDossier companyId="company-1" driverId="app-1" isOpen={false} onClose={() => {}} />);

        expect(container).toBeEmptyDOMElement();
        expect(fx.requested).toBe(false);
    });

    it('opens in its frame, saying it is loading, until its code arrives', async () => {
        const onClose = vi.fn();
        render(<DriverDossier companyId="company-1" driverId="app-1" isOpen onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Driver dossier' });
        expect(within(dialog).getByRole('status')).toHaveTextContent('Loading driver dossier…');
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledTimes(1);

        fx.arrive();
        expect(await screen.findByText('Dossier of app-1')).toBeInTheDocument();
        expect(screen.queryByText('Loading driver dossier…')).not.toBeInTheDocument();
    });
});
