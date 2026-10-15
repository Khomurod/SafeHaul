/**
 * The worklist shows without the application's editor. Reading an application a
 * driver began, or preparing one, replaces the list and brings the editor with
 * it: the two views load together when either is first opened, and the page says
 * so while they do.
 *
 * All names and keys below are artificial.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const fx = vi.hoisted(() => {
    let releaseReview;
    const reviewCode = new Promise((resolve) => { releaseReview = resolve; });
    return {
        loaded: new Set(),
        // Set just before the click, so only a load the click starts waits.
        holdReview: false,
        reviewCode,
        releaseReview,
        rows: [{
            applicantKey: 'aaaa1111bbbb2222cccc',
            origin: 'driver',
            status: 'in_progress',
            firstName: 'Dana',
            lastName: 'Alvarez',
            email: 'dana@example.test',
            phone: '2145550147',
            lastStep: 2,
            updatedAt: '2026-10-05T09:20:00Z',
        }],
    };
});

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async () => {
        if (name === 'listApplicationDrafts') return { data: { drafts: fx.rows, retentionDays: 30 } };
        throw Object.assign(new Error(`unexpected callable ${name}`), { code: 'functions/internal' });
    },
}));
vi.mock('@lib/firebase', () => ({ functions: {}, db: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({
        currentCompanyProfile: { id: 'company-1', companyName: 'Acme Freight', appSlug: 'acme' },
        currentUserClaims: { roles: { 'company-1': 'company_admin' } },
    }),
}));
vi.mock('@features/driver-app/hooks/useGuestFileUpload', () => ({
    useGuestFileUpload: () => ({ handleFileUpload: vi.fn(), isUploading: false }),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showError: vi.fn() }) }));
vi.mock('../applicationPrep/UnfinishedApplicationReview', async () => {
    fx.loaded.add('review');
    if (fx.holdReview) await fx.reviewCode;
    const UnfinishedApplicationReview = ({ entry }) => <p>Reading {entry.firstName}</p>;
    return { UnfinishedApplicationReview, default: UnfinishedApplicationReview };
});
vi.mock('../applicationPrep/ApplicationPrepWorkspace', () => {
    fx.loaded.add('workspace');
    const ApplicationPrepWorkspace = () => <p>Preparing a new application</p>;
    return { ApplicationPrepWorkspace, default: ApplicationPrepWorkspace };
});

import { UnfinishedApplicationsPage } from './UnfinishedApplicationsPage';

describe('the unfinished applications worklist', () => {
    it('shows without the editor, and loads a driver’s application when it is opened', async () => {
        render(<UnfinishedApplicationsPage />);
        const open = await screen.findByRole('button', { name: /Open the application for Dana Alvarez/i });
        expect([...fx.loaded]).toEqual([]);

        fx.holdReview = true;
        fireEvent.click(open);
        expect(await screen.findByText('Loading the application')).toBeInTheDocument();

        fx.releaseReview();
        expect(await screen.findByText('Reading Dana')).toBeInTheDocument();
        expect(fx.loaded.has('review')).toBe(true);
    });

    it('loads the preparation workspace when an application is started', async () => {
        render(<UnfinishedApplicationsPage />);
        fireEvent.click(await screen.findByRole('button', { name: /Start an application/i }));

        expect(await screen.findByText('Preparing a new application')).toBeInTheDocument();
        expect(fx.loaded.has('workspace')).toBe(true);
    });
});
