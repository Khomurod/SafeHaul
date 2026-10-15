/**
 * The CDL photos in the dossier's License card. The link stored with an upload
 * has expired by the time anybody looks, and an image that fails to load hides
 * itself for good: while the dossier signs its files the card shows that the
 * photos are coming, and draws them from the fresh links.
 *
 * All paths below are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LicenseCard } from './applicationTabCards';

afterEach(cleanup);

const appData = {
    cdlNumber: 'D0000000',
    'cdl-front': { name: 'front.jpg', url: 'https://storage.example.test/expired-front', storagePath: 'companies/co-1/applications/guest_uploads/a/front.jpg' },
    'cdl-back': { name: 'back.jpg', url: 'https://storage.example.test/expired-back', storagePath: 'companies/co-1/applications/guest_uploads/a/back.jpg' },
};

describe('the License card’s CDL photos', () => {
    it('wait for their links while the files are signed', () => {
        render(<LicenseCard appData={appData} fileUrls={{}} filesPending />);

        expect(screen.queryByRole('img', { name: 'CDL Front' })).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Loading photos…');
    });

    it('show from the fresh links once they arrive', () => {
        render(
            <LicenseCard
                appData={appData}
                fileUrls={{ 'cdl-front': 'https://storage.example.test/signed-front', 'cdl-back': 'https://storage.example.test/signed-back' }}
                filesPending={false}
            />,
        );

        expect(screen.getByRole('img', { name: 'CDL Front' })).toHaveAttribute('src', 'https://storage.example.test/signed-front');
        expect(screen.getByRole('img', { name: 'CDL Back' })).toHaveAttribute('src', 'https://storage.example.test/signed-back');
        expect(screen.queryByText('Loading photos…')).toBeNull();
    });
});
