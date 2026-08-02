/**
 * Accessibility and defect-fix proof for the migrated `CompanyBulkUpload`.
 *
 * `CompanyBulkUpload.contract.test.jsx` freezes the domain wiring. This file
 * asserts the interaction defects the design-system migration fixed.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bulkImport = vi.hoisted(() => ({ value: {}, options: null }));
const leadUpload = vi.hoisted(() => ({ value: {}, options: null }));

vi.mock('@shared/hooks', () => ({
    useBulkImport: (options) => {
        bulkImport.options = options;
        return bulkImport.value;
    },
}));
vi.mock('../hooks/useCompanyLeadUpload', () => ({
    useCompanyLeadUpload: (_companyId, _onComplete, options) => {
        leadUpload.options = options;
        return leadUpload.value;
    },
}));

import { CompanyBulkUpload } from './CompanyBulkUpload';

const TEAM = [
    { id: 'artificial-user-a', name: 'Artificial Recruiter A' },
    { id: 'artificial-user-b', name: 'Artificial Recruiter B' },
];

function setup({ importOverrides = {}, uploadOverrides = {}, props = {} } = {}) {
    bulkImport.value = {
        csvData: [],
        step: 'upload', setStep: vi.fn(),
        importMethod: 'file', setImportMethod: vi.fn(),
        sheetUrl: '', setSheetUrl: vi.fn(),
        processingSheet: false,
        handleSheetImport: vi.fn(),
        handleFileChange: vi.fn(),
        reset: vi.fn(),
        ...importOverrides,
    };
    leadUpload.value = {
        uploading: false,
        progress: '',
        progressCount: { current: 0, total: 0 },
        stats: { created: 0, updated: 0 },
        step: 'upload', setStep: vi.fn(),
        assignmentMode: 'unassigned', setAssignmentMode: vi.fn(),
        teamMembers: TEAM,
        selectedUserIds: TEAM.map((m) => m.id), setSelectedUserIds: vi.fn(),
        uploadLeads: vi.fn().mockResolvedValue(undefined),
        runDataRepair: vi.fn(),
        ...uploadOverrides,
    };

    return render(
        <CompanyBulkUpload
            companyId="artificial-company-1"
            onClose={vi.fn()}
            onUploadComplete={vi.fn()}
            {...props}
        />,
    );
}

const PREVIEW = { step: 'preview', csvData: [{ firstName: 'Artificial' }] };

beforeEach(() => {
    vi.clearAllMocks();
    bulkImport.options = null;
    leadUpload.options = null;
});

describe('CompanyBulkUpload — no blocking dialogs (defects 4, 5)', () => {
    it('passes non-blocking sinks to both hooks instead of leaving them on alert()', () => {
        setup();
        expect(typeof bulkImport.options?.onError).toBe('function');
        expect(typeof leadUpload.options?.onError).toBe('function');
        expect(typeof leadUpload.options?.onInfo).toBe('function');
    });

    it('renders a hook-reported import failure in place, verbatim', async () => {
        setup();

        bulkImport.options.onError('Invalid Google Sheet URL.');
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Invalid Google Sheet URL.');
        });
    });

    it('renders the clean-scan outcome politely rather than as an alert', async () => {
        setup();

        leadUpload.options.onInfo('Scan complete. No misformatted records found.');
        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent(
                'Scan complete. No misformatted records found.',
            );
        });
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('confirms the data repair in an accessible dialog, not window.confirm', async () => {
        const confirmSpy = vi.fn();
        vi.stubGlobal('confirm', confirmSpy);
        setup();

        fireEvent.click(screen.getByRole('button', { name: /Fix Data Mismatch/ }));

        expect(confirmSpy).not.toHaveBeenCalled();
        const dialog = await screen.findByRole('dialog', { name: 'Fix Data Mismatch' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveTextContent(
            "This will scan your leads for 'Email' fields that look like Phone Numbers and move them to the correct field. Continue?",
        );

        fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
        await waitFor(() => expect(leadUpload.value.runDataRepair).toHaveBeenCalledTimes(1));
        vi.unstubAllGlobals();
    });

    it('closes the repair dialog on Escape without repairing', async () => {
        setup();
        fireEvent.click(screen.getByRole('button', { name: /Fix Data Mismatch/ }));

        const dialog = await screen.findByRole('dialog', { name: 'Fix Data Mismatch' });
        fireEvent.keyDown(dialog, { key: 'Escape' });

        await waitFor(() => expect(
            screen.queryByRole('dialog', { name: 'Fix Data Mismatch' }),
        ).toBeNull());
        expect(leadUpload.value.runDataRepair).not.toHaveBeenCalled();
    });

    it('clears a stale message when the user retries', async () => {
        setup({ importOverrides: PREVIEW });

        leadUpload.options.onError('Artificial earlier failure.');
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /Confirm Upload/ }));
        await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    });
});

describe('CompanyBulkUpload — assignment controls (defects 1, 2, 3)', () => {
    it('exposes the assignment modes as a named radio group with selected state', () => {
        setup({ importOverrides: PREVIEW, uploadOverrides: { assignmentMode: 'round_robin' } });

        const group = screen.getByRole('group', { name: 'Lead Assignment' });
        expect(within(group).getByRole('radio', { name: 'Unassigned (Pool)' })).not.toBeChecked();
        expect(within(group).getByRole('radio', { name: 'Distribute to Team' })).toBeChecked();
    });

    it('exposes each team member as a named, keyboard-reachable checkbox', () => {
        setup({
            importOverrides: PREVIEW,
            uploadOverrides: {
                assignmentMode: 'round_robin',
                selectedUserIds: ['artificial-user-a'],
            },
        });

        const group = screen.getByRole('group', { name: 'Select Recipients' });
        const a = within(group).getByRole('checkbox', { name: 'Artificial Recruiter A' });
        const b = within(group).getByRole('checkbox', { name: 'Artificial Recruiter B' });

        expect(a).toBeChecked();
        expect(b).not.toBeChecked();

        b.focus();
        expect(document.activeElement).toBe(b);

        fireEvent.click(b);
        expect(leadUpload.value.setSelectedUserIds).toHaveBeenCalledTimes(1);
    });

    it('never renders body text below the 12px floor', () => {
        const { container } = setup({
            importOverrides: PREVIEW,
            uploadOverrides: { assignmentMode: 'round_robin' },
        });
        expect(container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
    });
});

describe('CompanyBulkUpload — axe', () => {
    it.each([
        ['upload', {}, {}],
        ['preview / unassigned', PREVIEW, { assignmentMode: 'unassigned' }],
        ['preview / round robin', PREVIEW, { assignmentMode: 'round_robin' }],
        ['preview / no recipients', PREVIEW, {
            assignmentMode: 'round_robin', selectedUserIds: [],
        }],
        ['success', {}, { step: 'success', stats: { created: 7, updated: 4 } }],
    ])('has no violations: %s', async (_name, importOverrides, uploadOverrides) => {
        const { container } = setup({ importOverrides, uploadOverrides });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations with the repair confirmation open', async () => {
        const { container } = setup();
        fireEvent.click(screen.getByRole('button', { name: /Fix Data Mismatch/ }));
        await screen.findByRole('dialog', { name: 'Fix Data Mismatch' });
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no violations when embedded in a page', async () => {
        const { container } = setup({ props: { isEmbedded: true } });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect((await axe(container)).violations).toEqual([]);
    });
});
