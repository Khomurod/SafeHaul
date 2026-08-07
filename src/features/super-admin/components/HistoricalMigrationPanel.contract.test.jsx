/**
 * Contract and safety proof for the temporary historical-migration action.
 *
 * Three properties matter more than anything visual here:
 *
 *  1. The outstanding count is READ, never assumed. A hard-coded total would be a
 *     claim about production that rots silently, so the button's own label has to
 *     come from the server survey — even when that disagrees with expectations.
 *  2. It self-destructs only on VERIFIED completion. Disappearing while records or
 *     PDFs are still missing would retire the only surface that can finish them.
 *  3. It survives failure visibly. A partial run must leave the action available
 *     and say exactly what is left.
 *
 * All company ids and names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ functions: { __functions: true } }));

import { HistoricalMigrationPanel } from './HistoricalMigrationPanel';

/** Survey response with sensible defaults, overridable per case. */
const surveyData = (over = {}) => ({
    success: true,
    pdfCheckPerformed: true,
    complete: false,
    totals: {
        companiesWithApplications: 2,
        applications: 100,
        preserved: 33,
        reconstructed: 33,
        liveSubmissions: 0,
        remaining: 12,
        neverSubmitted: 29,
        unreadable: 0,
        missingPdfs: 0,
        truncatedCompanies: 0,
        ...(over.totals || {}),
    },
    companies: over.companies || [
        { companyId: 'co-a', companyName: 'Artificial Freight Co', applications: 60, remaining: 9, unreadableApplicationIds: [] },
        { companyId: 'co-b', companyName: 'Synthetic Haulage Ltd', applications: 40, remaining: 3, unreadableApplicationIds: [] },
    ],
    ...(({ totals, companies, ...rest }) => rest)(over),
});

const migrationResult = (over = {}) => ({
    success: true, scanned: 9, reconstructed: 9, skipped: 0, unsubmitted: 0,
    pdfs: 9, failed: 0, truncated: false, lastApplicationId: 'x', errors: [], ...over,
});

let survey;
let reconstruct;

/** Routes each callable name to its own mock, as the panel uses two. */
function wire({ surveyImpl, reconstructImpl }) {
    survey = vi.fn(surveyImpl);
    reconstruct = vi.fn(reconstructImpl || (async () => ({ data: migrationResult() })));
    httpsCallable.mockImplementation((_functions, name) => {
        if (name === 'surveyHistoricalReconstruction') return survey;
        if (name === 'reconstructHistoricalApplications') return reconstruct;
        throw new Error(`unexpected callable ${name}`);
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    wire({ surveyImpl: async () => ({ data: surveyData() }) });
});

const migrateButton = () => screen.getByRole('button', { name: /Migrate the remaining/ });

describe('the count comes from the records, not from the code', () => {
    it('labels the button with whatever the survey reports', async () => {
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        expect(migrateButton()).toHaveAccessibleName('Migrate the remaining 12');
    });

    // The whole point: a number nobody expected must still be the number shown.
    it('shows a different count when production disagrees with expectations', async () => {
        wire({ surveyImpl: async () => ({ data: surveyData({ totals: { remaining: 4 } }) }) });
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        expect(migrateButton()).toHaveAccessibleName('Migrate the remaining 4');
    });

    it('asks the survey to check PDFs, on the frozen callable name and timeout', async () => {
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(survey).toHaveBeenCalled());
        expect(httpsCallable).toHaveBeenCalledWith(
            { __functions: true }, 'surveyHistoricalReconstruction', { timeout: 540000 },
        );
        expect(survey).toHaveBeenCalledWith({ includePdfCheck: true });
    });

    it('says the figures were counted just now', async () => {
        render(<HistoricalMigrationPanel />);
        expect(await screen.findByText(/Counted from the stored records just now/)).toBeInTheDocument();
    });
});

describe('self-destruct', () => {
    it('renders nothing at all once the survey reports verified completion', async () => {
        wire({ surveyImpl: async () => ({ data: surveyData({ complete: true }) }) });
        const { container } = render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    // The trap: `remaining: 0` alone is not completion. A preserved record with no
    // official PDF is unfinished, and the server refuses to call that complete.
    it('stays visible when nothing is eligible but a PDF is missing', async () => {
        wire({
            surveyImpl: async () => ({
                data: surveyData({
                    complete: false,
                    totals: { remaining: 0, missingPdfs: 2 },
                    companies: [{
                        companyId: 'co-a',
                        companyName: 'Artificial Freight Co',
                        applications: 60,
                        remaining: 0,
                        missingPdfs: 2,
                        unreadableApplicationIds: [],
                    }],
                }),
            }),
        });
        render(<HistoricalMigrationPanel />);
        expect(await screen.findByText(/Historical application records/)).toBeInTheDocument();

        // Offering to "migrate 0" would misdescribe the work: the run repairs the
        // documents from the stored records, so that is what the action says.
        const repair = screen.getByRole('button', { name: /Repair 2 missing PDFs/ });
        expect(repair).toBeEnabled();

        // And it must actually visit the company, or the documents stay missing.
        fireEvent.click(repair);
        fireEvent.click(screen.getByRole('button', { name: /^Rebuild 2 PDFs$/ }));
        await waitFor(() => expect(reconstruct).toHaveBeenCalledWith({ companyId: 'co-a' }));
    });

    it('disappears after a run the survey then verifies as complete', async () => {
        let call = 0;
        wire({
            surveyImpl: async () => {
                call += 1;
                return { data: surveyData(call === 1 ? {} : { complete: true }) };
            },
        });
        const { container } = render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());

        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        await waitFor(() => expect(container).toBeEmptyDOMElement());
        expect(survey).toHaveBeenCalledTimes(2);
    });

    // A survey that failed is not evidence of success.
    it('stays visible, with the reason, when the survey itself fails', async () => {
        wire({ surveyImpl: async () => { throw new Error('permission-denied'); } });
        render(<HistoricalMigrationPanel />);
        expect(await screen.findByRole('alert')).toHaveTextContent(/permission-denied/);
        expect(screen.getByText(/Historical application records/)).toBeInTheDocument();
    });
});

describe('confirmation before writing', () => {
    it('does not migrate until the operator confirms', async () => {
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());

        fireEvent.click(migrateButton());
        expect(reconstruct).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(reconstruct).not.toHaveBeenCalled();
    });

    it('states what will not be touched and what is never invented', async () => {
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveTextContent(/drafts and outreach leads are left completely untouched/i);
        expect(dialog).toHaveTextContent(/their PDF is not rewritten/i);
        expect(dialog).toHaveTextContent(/no Clearinghouse consent is ever claimed/i);
        expect(dialog).toHaveTextContent(/cannot be edited or replaced/i);
    });
});

describe('running the migration', () => {
    it('runs company by company, on the frozen callable name and payload', async () => {
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        await waitFor(() => expect(reconstruct).toHaveBeenCalledTimes(2));
        expect(httpsCallable).toHaveBeenCalledWith(
            { __functions: true }, 'reconstructHistoricalApplications', { timeout: 540000 },
        );
        expect(reconstruct).toHaveBeenNthCalledWith(1, { companyId: 'co-a' });
        expect(reconstruct).toHaveBeenNthCalledWith(2, { companyId: 'co-b' });
    });

    it('skips a company with nothing outstanding', async () => {
        wire({
            surveyImpl: async () => ({
                data: surveyData({
                    companies: [
                        { companyId: 'co-a', companyName: 'Artificial Freight Co', applications: 60, remaining: 9, unreadableApplicationIds: [] },
                        { companyId: 'co-done', companyName: 'Already Finished Inc', applications: 5, remaining: 0, unreadableApplicationIds: [] },
                    ],
                }),
            }),
        });
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        await waitFor(() => expect(reconstruct).toHaveBeenCalledTimes(1));
        expect(reconstruct).toHaveBeenCalledWith({ companyId: 'co-a' });
    });

    // Resuming is how a company larger than one invocation is finished at all.
    it('resumes from the cursor while the callable reports more remaining', async () => {
        let calls = 0;
        wire({
            surveyImpl: async () => ({ data: surveyData({ companies: [
                { companyId: 'co-a', companyName: 'Artificial Freight Co', applications: 300, remaining: 250, unreadableApplicationIds: [] },
            ] }) }),
            reconstructImpl: async () => {
                calls += 1;
                return { data: migrationResult(
                    calls === 1
                        ? { truncated: true, lastApplicationId: 'cursor-1' }
                        : { truncated: false },
                ) };
            },
        });
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        await waitFor(() => expect(reconstruct).toHaveBeenCalledTimes(2));
        expect(reconstruct).toHaveBeenNthCalledWith(2, {
            companyId: 'co-a', startAfterApplicationId: 'cursor-1',
        });
    });

    it('announces progress rather than running silently', async () => {
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        await waitFor(() => {
            const live = screen.getAllByRole('status').map((n) => n.textContent).join(' ');
            expect(live).toMatch(/Migration running|Verifying the result/);
        });
    });
});

describe('when something fails', () => {
    const withFailures = {
        surveyImpl: async () => ({ data: surveyData({ totals: { remaining: 12, missingPdfs: 0 } }) }),
        reconstructImpl: async () => ({
            data: migrationResult({
                reconstructed: 7, failed: 2, pdfs: 7,
                errors: [
                    { applicationId: 'abcdefgh12345678', message: 'could not be rebuilt' },
                    { applicationId: 'ijklmnop87654321', message: 'could not be rebuilt' },
                ],
            }),
        }),
    };

    it('keeps the action available and says what is left', async () => {
        wire(withFailures);
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        expect(await screen.findByText(/Work still remains/)).toBeInTheDocument();
        expect(migrateButton()).toBeEnabled();
    });

    it('reports failures per company, truncating application ids', async () => {
        wire(withFailures);
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        const reports = await screen.findAllByText(/Could not rebuild: abcdefgh…, ijklmnop…/);
        expect(reports).toHaveLength(2);
        // The full id is derived from applicant identity and must not be shown.
        expect(document.body.textContent).not.toContain('abcdefgh12345678');
    });

    it('records a company whose call threw, without abandoning the rest', async () => {
        let calls = 0;
        wire({
            surveyImpl: async () => ({ data: surveyData() }),
            reconstructImpl: async () => {
                calls += 1;
                if (calls === 1) throw new Error('deadline-exceeded');
                return { data: migrationResult({ reconstructed: 3, pdfs: 3 }) };
            },
        });
        render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        fireEvent.click(screen.getByRole('button', { name: /^Migrate 12 applications$/ }));

        expect(await screen.findByText(/deadline-exceeded/)).toBeInTheDocument();
        // The second company still ran.
        await waitFor(() => expect(reconstruct).toHaveBeenCalledTimes(2));
    });
});

describe('unreadable applications', () => {
    it('surfaces them for a person, and blocks completion', async () => {
        wire({
            surveyImpl: async () => ({
                data: surveyData({
                    totals: { remaining: 0, unreadable: 1 },
                    companies: [{
                        companyId: 'co-a',
                        companyName: 'Artificial Freight Co',
                        applications: 60,
                        remaining: 0,
                        unreadableApplicationIds: ['brokenapp1234567'],
                    }],
                }),
            }),
        });
        render(<HistoricalMigrationPanel />);

        expect(await screen.findByText(/1 application could not be read/)).toBeInTheDocument();
        expect(document.body.textContent).toContain('brokenap…');
        expect(document.body.textContent).not.toContain('brokenapp1234567');
    });
});

describe('accessibility', () => {
    it('has no detectable violations in its idle state', async () => {
        const { container } = render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no detectable violations with the confirmation open', async () => {
        const { container, baseElement } = render(<HistoricalMigrationPanel />);
        await waitFor(() => expect(migrateButton()).toBeInTheDocument());
        fireEvent.click(migrateButton());
        await screen.findByRole('dialog');
        expect((await axe(baseElement || container, {
            rules: { region: { enabled: false } },
        })).violations).toEqual([]);
    });
});
