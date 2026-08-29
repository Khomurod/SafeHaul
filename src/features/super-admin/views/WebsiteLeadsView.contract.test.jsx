/**
 * Contract and safety proof for Super Admin → Website Leads.
 *
 * This screen replaced Landing Page Settings, which managed Telegram credentials
 * and could retry a delivery. The properties worth asserting changed with it, and
 * the ones below are the ones a visual review cannot catch:
 *
 *  1. **It is read only.** No control on this screen writes anything, and the
 *     only callable it may reach is `listLandingLeads`. The retired ones —
 *     `submitLandingLead`, `updateLandingTelegramConfig`, `sendLandingTelegramTest`,
 *     `retryLandingLeadDelivery` and the rest — must stay unreachable from here.
 *  2. **CSV export cannot carry a formula.** Every field came from a member of
 *     the public, and a spreadsheet runs a cell that begins `=`, `+`, `-` or `@`.
 *     An export that opens a browser tab on the operator's machine is a real
 *     attack, not a hypothetical one.
 *  3. **A contact-only lead is presented as a lead**, because those are the
 *     submissions the original single-step form threw away.
 *  4. **A failed delivery is still shown as failed.** Nothing retries it any
 *     more, but rewriting history to hide it would be worse than showing it.
 *
 * All names, emails and identifiers below are artificial.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ functions: { __functions: true } }));

const toast = { showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn() };
vi.mock('@shared/components/feedback', () => ({ useToast: () => toast }));

import { WebsiteLeadsView } from './WebsiteLeadsView';

const lead = (over = {}) => ({
    id: 'lead-1',
    fullName: 'Dana Fixture',
    workEmail: 'dana@example.test',
    phone: '555-0100',
    companyName: 'Ridgeline Carriers',
    companySize: '25',
    primaryGoal: 'hiring',
    stage: 'qualified',
    sourcePage: '/',
    utmSource: null,
    delivery: { status: 'delivered', code: null, attempts: 1 },
    createdAt: Date.UTC(2026, 7, 2, 12, 0, 0),
    ...over,
});

/** Records every callable name the screen asks for. */
let called = [];

function mockLeads(rows) {
    called = [];
    httpsCallable.mockImplementation((_fns, name) => {
        called.push(name);
        return async () => ({ data: { leads: rows } });
    });
}

describe('Website Leads — read-only archive', () => {
    beforeEach(() => {
        // resetAllMocks, not clearAllMocks: this file queues no `*Once` values
        // today, but the hazard is that adding one later leaks into the next
        // test, and `clearAllMocks` does not empty a once-queue.
        vi.resetAllMocks();
        toast.showSuccess = vi.fn();
        toast.showError = vi.fn();
        mockLeads([lead()]);
    });

    it('reads leads and nothing else', async () => {
        render(<WebsiteLeadsView />);
        await screen.findByText('Dana Fixture');
        // The whole security posture of this screen in one assertion.
        expect(called).toEqual(['listLandingLeads']);
    });

    it('offers no control that writes', async () => {
        render(<WebsiteLeadsView />);
        await screen.findByText('Dana Fixture');
        const labels = screen.getAllByRole('button').map((b) => b.textContent || '');
        for (const forbidden of ['Save', 'Send test', 'Retry', 'Enable', 'Disable', 'Delete']) {
            expect(labels.some((l) => l.includes(forbidden))).toBe(false);
        }
    });

    it('shows a contact-only lead as a lead, not a failure', async () => {
        mockLeads([lead({ stage: 'contact', fullName: 'Sam Partial' })]);
        render(<WebsiteLeadsView />);
        await screen.findByText('Sam Partial');
        expect(screen.getByText('Contact only')).toBeInTheDocument();
    });

    it('still reports a delivery that failed', async () => {
        mockLeads([lead({ delivery: { status: 'failed', code: 'telegram_unreachable', attempts: 3 } })]);
        render(<WebsiteLeadsView />);
        await screen.findByText('Dana Fixture');
        expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('says so plainly when the archive is empty', async () => {
        mockLeads([]);
        render(<WebsiteLeadsView />);
        await waitFor(() => expect(screen.getByText(/No leads were captured/i)).toBeInTheDocument());
    });

    it('surfaces a load failure instead of rendering an empty table', async () => {
        httpsCallable.mockImplementation(() => async () => {
            const error = new Error('nope');
            error.code = 'functions/permission-denied';
            throw error;
        });
        render(<WebsiteLeadsView />);
        await screen.findByText(/Only a super admin can view captured leads/i);
    });

    it('has no serious accessibility violations', async () => {
        const { container } = render(<WebsiteLeadsView />);
        await screen.findByText('Dana Fixture');
        const results = await axe(container);
        const serious = (results.violations || []).filter(
            (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(serious).toEqual([]);
    });
});

describe('CSV export — a public field must not become a formula', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        toast.showSuccess = vi.fn();
        toast.showError = vi.fn();
    });

    /** Captures the CSV the screen would hand the browser. */
    async function exportedCsv(rows) {
        mockLeads(rows);
        let captured = '';
        const originalCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
        URL.revokeObjectURL = () => {};
        render(<WebsiteLeadsView />);
        await screen.findByRole('button', { name: /Export CSV/i });
        screen.getByRole('button', { name: /Export CSV/i }).click();
        await waitFor(() => expect(captured).not.toBe(''));
        URL.createObjectURL = originalCreate;
        return captured.text();
    }

    it('neutralises a formula typed into a lead field', async () => {
        const csv = await exportedCsv([lead({ companyName: '=HYPERLINK("http://evil.test","click")' })]);
        // Prefixed with an apostrophe, so the spreadsheet treats it as text.
        expect(csv).toContain('"\'=HYPERLINK');
        // And never as a live formula at the start of a cell.
        expect(csv).not.toContain(',"=HYPERLINK');
    });

    it.each(['+1+1', '-2+3', '@SUM(A1)', '\tlead'])('neutralises %s', async (value) => {
        const csv = await exportedCsv([lead({ fullName: value })]);
        expect(csv).toContain(`"'${value}"`);
    });

    it('escapes a quote and a comma without mangling the field', async () => {
        const csv = await exportedCsv([lead({ companyName: 'Ridgeline, "The Best"' })]);
        expect(csv).toContain('"Ridgeline, ""The Best"""');
    });

    it('writes a header row matching the columns it exports', async () => {
        const csv = await exportedCsv([lead()]);
        const [header] = csv.split('\r\n');
        expect(header).toContain('"workEmail"');
        expect(header).toContain('"deliveryStatus"');
        expect(csv.split('\r\n')).toHaveLength(2);
    });
});
