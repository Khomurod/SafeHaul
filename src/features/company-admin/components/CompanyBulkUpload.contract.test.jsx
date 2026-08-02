/**
 * Contract freeze for `CompanyBulkUpload`.
 *
 * Written BEFORE the design-system migration. It pins the domain wiring that
 * presentation work must not disturb:
 *
 *  - the frozen dialog title,
 *  - the `uploadStep !== 'upload' ? uploadStep : importStep` step derivation,
 *  - the CSV template headers, sample row and filename,
 *  - `uploadLeads(csvData, importMethod)` and how its rejection is surfaced,
 *  - the reset composition (`resetImport()` + `setUploadStep('upload')`),
 *  - the `'unassigned'` / `'round_robin'` assignment-mode values,
 *  - team-member ids, toggle behaviour and select-all/deselect-all,
 *  - the data-repair confirmation text and `runDataRepair`.
 *
 * Both hooks are mocked so this file tests the component's contract, not
 * Firestore. Hook behaviour is frozen separately.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bulkImport = vi.hoisted(() => ({ value: {} }));
const leadUpload = vi.hoisted(() => ({ value: {} }));
const toastMocks = vi.hoisted(() => ({
    showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
}));

vi.mock('@shared/hooks', () => ({ useBulkImport: (...args) => bulkImport.factory(...args) }));
vi.mock('../hooks/useCompanyLeadUpload', () => ({
    useCompanyLeadUpload: (...args) => leadUpload.factory(...args),
}));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => toastMocks }));

import { CompanyBulkUpload } from './CompanyBulkUpload';

const COMPANY_ID = 'artificial-company-1';
const TEAM = [
    { id: 'artificial-user-a', name: 'Artificial Recruiter A' },
    { id: 'artificial-user-b', name: 'Artificial Recruiter B' },
    { id: 'artificial-user-c', name: 'Artificial Recruiter C' },
];

function importState(overrides = {}) {
    return {
        csvData: [],
        step: 'upload', setStep: vi.fn(),
        importMethod: 'file', setImportMethod: vi.fn(),
        sheetUrl: '', setSheetUrl: vi.fn(),
        processingSheet: false,
        handleSheetImport: vi.fn(),
        handleFileChange: vi.fn(),
        reset: vi.fn(),
        ...overrides,
    };
}

function uploadState(overrides = {}) {
    return {
        uploading: false,
        progress: '',
        stats: { created: 0, updated: 0 },
        step: 'upload', setStep: vi.fn(),
        assignmentMode: 'unassigned', setAssignmentMode: vi.fn(),
        teamMembers: TEAM,
        selectedUserIds: TEAM.map((m) => m.id), setSelectedUserIds: vi.fn(),
        uploadLeads: vi.fn().mockResolvedValue(undefined),
        runDataRepair: vi.fn(),
        ...overrides,
    };
}

function setup({ importOverrides = {}, uploadOverrides = {}, props = {} } = {}) {
    bulkImport.value = importState(importOverrides);
    leadUpload.value = uploadState(uploadOverrides);
    bulkImport.factory = () => bulkImport.value;
    leadUpload.factory = vi.fn(() => leadUpload.value);

    const onClose = vi.fn();
    const onUploadComplete = vi.fn();
    const utils = render(
        <CompanyBulkUpload
            companyId={COMPANY_ID}
            onClose={onClose}
            onUploadComplete={onUploadComplete}
            {...props}
        />,
    );
    return { ...utils, onClose, onUploadComplete };
}

/**
 * Finds an interactive control by accessible name, whatever its role is.
 *
 * The last fallback exists only because several pre-migration controls are
 * `<div onClick>` with no role and no accessible name at all — the very defects
 * this campaign fixes. The freeze must still be able to drive them so the
 * *behaviour* is pinned before the markup changes.
 */
function control(name) {
    const found = screen.queryByRole('button', { name })
        ?? screen.queryByRole('radio', { name })
        ?? screen.queryByRole('checkbox', { name })
        ?? screen.queryByLabelText(name)
        ?? screen.queryByText(name);
    expect(found, `a control named ${name} should exist`).toBeTruthy();
    return found;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('CompanyBulkUpload — preserved contracts', () => {
    it('renders the frozen dialog title', () => {
        setup();
        expect(screen.getByText('Import Private Leads')).toBeInTheDocument();
    });

    it('passes the companyId and completion callback to useCompanyLeadUpload', () => {
        const { onUploadComplete } = setup();
        expect(leadUpload.factory).toHaveBeenCalled();
        const [companyId, callback] = leadUpload.factory.mock.calls[0];
        expect(companyId).toBe(COMPANY_ID);
        expect(callback).toBe(onUploadComplete);
    });

    it.each([
        // uploadStep, importStep, expected rendered step
        ['upload', 'upload', 'upload'],
        ['upload', 'preview', 'preview'],
        ['success', 'upload', 'success'],
        ['success', 'preview', 'success'],
    ])('derives the rendered step from upload=%s import=%s', (uploadStep, importStep, expected) => {
        setup({
            importOverrides: { step: importStep, csvData: [{ firstName: 'Artificial' }] },
            uploadOverrides: { step: uploadStep, stats: { created: 7, updated: 4 } },
        });

        if (expected === 'upload') {
            expect(control('Upload File')).toBeTruthy();
        } else if (expected === 'preview') {
            expect(screen.getByText('Preview (1 records)')).toBeInTheDocument();
        } else {
            expect(screen.getByText('Upload Complete!')).toBeInTheDocument();
        }
    });

    it('calls uploadLeads with the parsed rows and the import method', async () => {
        const csvData = [{ firstName: 'Artificial', lastName: 'Applicant' }];
        setup({
            importOverrides: { step: 'preview', csvData, importMethod: 'gsheet' },
        });

        fireEvent.click(control('Confirm Upload'));
        await waitFor(() => expect(leadUpload.value.uploadLeads).toHaveBeenCalledTimes(1));
        expect(leadUpload.value.uploadLeads).toHaveBeenCalledWith(csvData, 'gsheet');
    });

    it('surfaces an uploadLeads rejection message without losing the preview', async () => {
        const message = 'Please select at least one user for Round Robin distribution.';
        // Pre-migration this message is delivered by a blocking `alert()`;
        // post-migration by a non-blocking in-page alert. Either satisfies the
        // contract "the rejection message reaches the user verbatim".
        // happy-dom implements neither `alert` nor `confirm`, so they are stubbed
        // as globals rather than spied on.
        const alertSpy = vi.fn();
        vi.stubGlobal('alert', alertSpy);
        const csvData = [{ firstName: 'Artificial' }];
        setup({
            importOverrides: { step: 'preview', csvData },
            uploadOverrides: {
                uploadLeads: vi.fn().mockRejectedValue(new Error(message)),
            },
        });

        fireEvent.click(control('Confirm Upload'));

        await waitFor(() => {
            const announced = alertSpy.mock.calls.some(([text]) => text === message)
                || document.body.textContent.includes(message);
            expect(announced, `the rejection message "${message}" reaches the user`).toBe(true);
        });
        expect(screen.getByText('Preview (1 records)')).toBeInTheDocument();
        vi.unstubAllGlobals();
    });

    it('resets both the import state and the upload step', () => {
        setup({ importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] } });

        fireEvent.click(control('Reset'));
        expect(bulkImport.value.reset).toHaveBeenCalledTimes(1);
        expect(leadUpload.value.setStep).toHaveBeenCalledWith('upload');
    });

    it('keeps the "unassigned" and "round_robin" assignment-mode values', () => {
        // Two renders rather than two clicks: post-migration these are radios,
        // and activating the already-selected radio fires no change event.
        const { unmount } = setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'unassigned' },
        });
        fireEvent.click(control('Distribute to Team'));
        expect(leadUpload.value.setAssignmentMode).toHaveBeenCalledWith('round_robin');
        unmount();

        setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin' },
        });
        fireEvent.click(control('Unassigned (Pool)'));
        expect(leadUpload.value.setAssignmentMode).toHaveBeenCalledWith('unassigned');
    });

    it('hides recipient selection unless the mode is round_robin', () => {
        const { unmount } = setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'unassigned' },
        });
        expect(screen.queryByText('Select Recipients')).toBeNull();
        unmount();

        setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin' },
        });
        expect(screen.getByText('Select Recipients')).toBeInTheDocument();
        for (const member of TEAM) {
            expect(screen.getByText(member.name)).toBeInTheDocument();
        }
    });

    it('toggles a single team member id off and back on', () => {
        setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin', selectedUserIds: TEAM.map((m) => m.id) },
        });

        fireEvent.click(control(TEAM[1].name));
        const updater = leadUpload.value.setSelectedUserIds.mock.calls[0][0];
        expect(updater(TEAM.map((m) => m.id)))
            .toEqual(['artificial-user-a', 'artificial-user-c']);
        expect(updater(['artificial-user-a']))
            .toEqual(['artificial-user-a', 'artificial-user-b']);
    });

    it('offers Select All when some are unselected and selects every id', () => {
        setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin', selectedUserIds: ['artificial-user-a'] },
        });

        fireEvent.click(control('Select All'));
        expect(leadUpload.value.setSelectedUserIds)
            .toHaveBeenCalledWith(TEAM.map((m) => m.id));
    });

    it('offers Deselect All when all are selected and clears the selection', () => {
        setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin', selectedUserIds: TEAM.map((m) => m.id) },
        });

        fireEvent.click(control('Deselect All'));
        expect(leadUpload.value.setSelectedUserIds).toHaveBeenCalledWith([]);
    });

    it('reports the selected recipient count with correct pluralisation', () => {
        const { unmount } = setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin', selectedUserIds: ['artificial-user-a'] },
        });
        expect(screen.getByText(
            /Leads will be distributed equally among the 1 selected member\./,
        )).toBeInTheDocument();
        unmount();

        setup({
            importOverrides: { step: 'preview', csvData: [{ firstName: 'A' }] },
            uploadOverrides: { assignmentMode: 'round_robin', selectedUserIds: TEAM.map((m) => m.id) },
        });
        expect(screen.getByText(
            /Leads will be distributed equally among the 3 selected members\./,
        )).toBeInTheDocument();
    });

    it('downloads the frozen CSV template', () => {
        setup();

        const anchor = document.createElement('a');
        const setAttribute = vi.spyOn(anchor, 'setAttribute');
        const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});
        const realCreateElement = document.createElement.bind(document);
        const createElement = vi.spyOn(document, 'createElement')
            .mockImplementation((tag, ...rest) => (
                tag === 'a' ? anchor : realCreateElement(tag, ...rest)
            ));

        fireEvent.click(control('Download CSV Template'));

        const href = setAttribute.mock.calls.find(([name]) => name === 'href')?.[1];
        const download = setAttribute.mock.calls.find(([name]) => name === 'download')?.[1];

        expect(download).toBe('leads_template.csv');
        expect(decodeURI(href)).toBe(
            'data:text/csv;charset=utf-8,'
            + 'First Name,Last Name,Email,Phone,City,State,Experience,Job Type\n'
            + 'John,Doe,john@example.com,(555) 123-4567,Dallas,TX,5,OTR',
        );
        expect(click).toHaveBeenCalledTimes(1);

        createElement.mockRestore();
    });

    it('renders the frozen upload instructions', () => {
        setup();
        expect(screen.getByText(/Format: CSV, XLS, or XLSX\./)).toBeInTheDocument();
        expect(screen.getByText(
            /Required: First Name \+ Last Name \(or just "Name"\), Phone\./,
        )).toBeInTheDocument();
        expect(screen.getByText(/We automatically detect headers\./)).toBeInTheDocument();
        expect(screen.getByText(/Phone numbers are normalized automatically\./)).toBeInTheDocument();
        expect(screen.getByText(
            /Emails are optional — placeholders are auto-generated when missing\./,
        )).toBeInTheDocument();
    });

    it('shows the repair action only on the upload step and not while uploading', () => {
        const cases = [
            { uploadOverrides: { step: 'upload', uploading: false }, expected: true },
            { uploadOverrides: { step: 'upload', uploading: true }, expected: false },
            { uploadOverrides: { step: 'success', uploading: false }, expected: false },
        ];

        for (const { uploadOverrides, expected } of cases) {
            const { unmount } = setup({ uploadOverrides });
            const found = screen.queryByText('Fix Data Mismatch');
            expect(Boolean(found)).toBe(expected);
            unmount();
        }
    });

    // The confirmation question is frozen wording, whether it is delivered by
    // window.confirm (pre-migration) or an accessible dialog (post-migration).
    const REPAIR_QUESTION = "This will scan your leads for 'Email' fields that look like "
        + 'Phone Numbers and move them to the correct field. Continue?';

    it('confirms before running the data repair and runs it on confirmation', async () => {
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);
        setup();

        fireEvent.click(control('Fix Data Mismatch'));

        if (confirmSpy.mock.calls.length) {
            expect(confirmSpy).toHaveBeenCalledWith(REPAIR_QUESTION);
        } else {
            expect(document.body.textContent).toContain(REPAIR_QUESTION);
            fireEvent.click(control('Continue'));
        }

        await waitFor(() => expect(leadUpload.value.runDataRepair).toHaveBeenCalledTimes(1));
        vi.unstubAllGlobals();
    });

    it('does not run the data repair when the confirmation is declined', async () => {
        const confirmSpy = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmSpy);
        setup();

        fireEvent.click(control('Fix Data Mismatch'));

        if (!confirmSpy.mock.calls.length) {
            expect(document.body.textContent).toContain(REPAIR_QUESTION);
            fireEvent.click(control('Cancel'));
            await waitFor(() => expect(document.body.textContent).not.toContain(REPAIR_QUESTION));
        }

        expect(leadUpload.value.runDataRepair).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
