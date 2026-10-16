/**
 * Contract for the Maintenance page: the platform-wide repairs in one place.
 *
 * Every action here writes to live data across companies, so each one's
 * callable name, timeout and payload are frozen, and each one waits for a
 * confirmation: Cancel and Escape run nothing and hand focus back to the
 * button that asked. The employer backfill's suite moved here from the shell's
 * with the button; the public-profile sync's from System Health's.
 *
 * The stats panel and the historical-records panel have their own suites
 * (`StatsBackfillPanel.test.jsx`, `HistoricalMigrationPanel.contract.test.jsx`);
 * here they only need a place on the page.
 *
 * All company and user names below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const httpsCallable = vi.fn();
const showSuccess = vi.fn();
const showError = vi.fn();
const showInfo = vi.fn();
const refreshData = vi.fn();

vi.mock('firebase/functions', () => ({ httpsCallable: (...a) => httpsCallable(...a) }));
vi.mock('@lib/firebase', () => ({ functions: { __functions: true } }));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({ showSuccess, showError, showInfo }),
}));
vi.mock('./StatsBackfillPanel', () => ({
    default: () => <section data-testid="stats-backfill-panel" />,
}));
vi.mock('./HistoricalMigrationPanel', () => ({
    HistoricalMigrationPanel: () => <section data-testid="historical-migration-panel" />,
}));

import { MaintenanceView } from './MaintenanceView';

/** The address the panel is at. */
function AddressProbe() {
    const location = useLocation();
    return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

function renderView() {
    return render(
        <MemoryRouter initialEntries={['/super-admin/maintenance?e2eAuth=super_admin']}>
            <Routes>
                <Route path="/super-admin/*" element={<MaintenanceView onDataUpdate={refreshData} />} />
            </Routes>
            <AddressProbe />
        </MemoryRouter>,
    );
}

/** A callable that has been asked and has not answered yet. */
function pending() {
    let settle;
    const promise = new Promise((resolve) => { settle = resolve; });
    return { promise, resolve: (value) => settle(value) };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('Maintenance page', () => {
    it('is one screen under one h2, a card per action', () => {
        const { container } = renderView();

        expect(container.querySelector('h1')).toBeNull();
        const h2s = [...container.querySelectorAll('h2')];
        expect(h2s.map((h) => h.textContent)).toEqual(['Maintenance']);
        expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
            'Employer backfill',
            'Public profiles',
            'On other screens',
        ]);
        expect(screen.getByTestId('stats-backfill-panel')).toBeInTheDocument();
        expect(screen.getByTestId('historical-migration-panel')).toBeInTheDocument();
    });

    it('keeps the order: employer backfill, stats, public profiles, historical records, then the links', () => {
        renderView();
        const order = [
            screen.getByRole('heading', { name: 'Employer backfill' }),
            screen.getByTestId('stats-backfill-panel'),
            screen.getByRole('heading', { name: 'Public profiles' }),
            screen.getByTestId('historical-migration-panel'),
            screen.getByRole('heading', { name: 'On other screens' }),
        ];
        for (let i = 1; i < order.length; i += 1) {
            expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
    });

    it('has no accessibility violations', async () => {
        const { container } = renderView();
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('Maintenance — the employer backfill keeps its contract', () => {
    const trigger = () => screen.getByRole('button', { name: /Backfill Employers/i });

    it('calls backfillEmployerFields with the exact name, timeout and payload', async () => {
        const backfillFn = vi.fn(async () => ({ data: { message: 'done', stats: {} } }));
        httpsCallable.mockReturnValue(backfillFn);

        renderView();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await waitFor(() => expect(backfillFn).toHaveBeenCalled());
        expect(httpsCallable).toHaveBeenCalledWith(
            { __functions: true },
            'backfillEmployerFields',
            { timeout: 540000 },
        );
        expect(backfillFn).toHaveBeenCalledWith({ dryRun: false });
    });

    it('does not run the backfill unless the confirmation is accepted', async () => {
        const backfillFn = vi.fn(async () => ({ data: { message: 'done', stats: {} } }));
        httpsCallable.mockReturnValue(backfillFn);

        renderView();
        trigger().focus();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(backfillFn).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(trigger());
    });

    it('runs nothing on Escape, and gives focus back to the trigger', async () => {
        const backfillFn = vi.fn(async () => ({ data: { message: 'done', stats: {} } }));
        httpsCallable.mockReturnValue(backfillFn);

        renderView();
        trigger().focus();
        fireEvent.click(trigger());
        fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(backfillFn).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger());
    });

    it('keeps the toast + refresh sequence on success', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => ({
            data: { message: 'Backfill complete', stats: { totalDocs: 9, updatedDocs: 4, skippedDocs: 5, errorDocs: 0 } },
        })));

        renderView();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Backfill complete'));
        expect(showInfo).toHaveBeenCalledWith('Running employer field backfill... this may take a few minutes.');
        expect(refreshData).toHaveBeenCalled();
    });

    it('reports failures through the error toast rather than throwing', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => { throw new Error('nope'); }));

        renderView();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await waitFor(() => expect(showError).toHaveBeenCalledWith('Employer backfill failed: nope'));
        expect(refreshData).not.toHaveBeenCalled();
    });

    it('never calls window.confirm or window.alert', async () => {
        // jsdom does not implement `confirm`/`alert`, so install stubs rather than
        // spy on them. If the page ever reintroduces a blocking dialog these fire.
        const confirmSpy = vi.fn(() => true);
        const alertSpy = vi.fn();
        vi.stubGlobal('confirm', confirmSpy);
        vi.stubGlobal('alert', alertSpy);
        httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { message: 'ok', stats: { totalDocs: 1 } } })));

        renderView();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await screen.findByText('Employer backfill report');
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('returns focus to the Backfill trigger after the report is closed', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { message: 'ok', stats: { totalDocs: 3 } } })));

        renderView();
        trigger().focus();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        await screen.findByText('Employer backfill report');
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        // The confirmation cannot hand focus back itself: confirming disables the
        // trigger and unmounts the dialog in the same commit, so its restore
        // targets a disabled button and lands on <body>. Without the explicit
        // hand-back, a keyboard user ends the flow at the top of the page.
        await waitFor(() => expect(document.activeElement).toBe(trigger()));
    });

    it('presents the confirmation as a real dialog with an accessible name', async () => {
        renderView();
        fireEvent.click(trigger());

        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(within(dialog).getByText('Run employer field backfill?')).toBeInTheDocument();
    });

    it('shows the same four counters the alert() used to print', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => ({
            data: { message: 'ok', stats: { totalDocs: 12, updatedDocs: 7, skippedDocs: 4, errorDocs: 1 } },
        })));

        renderView();
        fireEvent.click(trigger());
        fireEvent.click(await screen.findByRole('button', { name: 'Run backfill' }));

        const report = await screen.findByRole('dialog', { name: 'Employer backfill report' });
        expect(within(report).getByText('Total applications').nextSibling).toHaveTextContent('12');
        expect(within(report).getByText('Updated').nextSibling).toHaveTextContent('7');
        expect(within(report).getByText('Already correct').nextSibling).toHaveTextContent('4');
        expect(within(report).getByText('Errors').nextSibling).toHaveTextContent('1');
    });

    it('explains itself in visible text, as the button\'s accessible description', () => {
        const { container } = renderView();
        const describedBy = trigger().getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(/employer field names/i);
        expect(trigger()).not.toHaveAttribute('title');
    });
});

describe('Maintenance — Sync Public Profiles waits for a confirmation', () => {
    const syncButton = () => screen.getByRole('button', { name: /Sync Public Profiles|Syncing\.\.\.|Profiles Synced ✓/ });

    function openConfirmation() {
        renderView();
        syncButton().focus();
        fireEvent.click(syncButton());
    }

    it('asks first, and calls nothing until the answer is yes', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { success: true, message: 'ok' } })));
        openConfirmation();

        // It rewrites every company's public profile, and used to run on the click.
        const dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAccessibleName('Rewrite every public profile?');
        expect(httpsCallable).not.toHaveBeenCalled();
    });

    it('runs nothing on Cancel, and gives focus back to the trigger', async () => {
        openConfirmation();
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(httpsCallable).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(syncButton());
        expect(screen.getByText('Waiting for a maintenance action...')).toBeInTheDocument();
    });

    it('runs nothing on Escape, and gives focus back to the trigger', async () => {
        openConfirmation();
        fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(httpsCallable).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(syncButton());
    });

    it('calls backfillPublicProfiles exactly as before once confirmed: no options, no payload', async () => {
        const syncFn = vi.fn(async () => ({ data: { success: true, message: 'Backfilled 12 public profiles.' } }));
        httpsCallable.mockReturnValue(syncFn);
        openConfirmation();
        fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));

        await waitFor(() => expect(syncFn).toHaveBeenCalledTimes(1));
        expect(httpsCallable).toHaveBeenCalledTimes(1);
        expect(httpsCallable.mock.calls[0]).toEqual([{ __functions: true }, 'backfillPublicProfiles']);
        expect(syncFn.mock.calls[0]).toEqual([]);
    });

    it('shows "Syncing..." and disables itself while running, then the success label and its announcement', async () => {
        const call = pending();
        httpsCallable.mockReturnValue(vi.fn(() => call.promise));
        openConfirmation();
        fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));

        expect(await screen.findByRole('button', { name: /Syncing\.\.\./ })).toBeDisabled();

        call.resolve({ data: { success: true, message: 'Backfilled 12 public profiles.' } });
        expect(await screen.findByRole('button', { name: /Profiles Synced ✓/ })).toBeInTheDocument();
        expect(screen.getByText('Profiles synced')).toBeInTheDocument();
        expect(screen.getByText('✅ Backfill Complete: Backfilled 12 public profiles.')).toBeInTheDocument();
    });

    it('gives focus back to the trigger once the confirmed sync has finished', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { success: true, message: 'ok' } })));
        openConfirmation();
        fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));

        await screen.findByRole('button', { name: /Profiles Synced ✓/ });
        await waitFor(() => expect(document.activeElement).toBe(syncButton()));
    });

    it('announces a failure and logs it, for a refusal and for a thrown error', async () => {
        httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { success: false, error: 'refused' } })));
        openConfirmation();
        fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));

        expect(await screen.findByText('Failed — see the output log')).toBeInTheDocument();
        expect(screen.getByText('❌ Backfill Failed: refused')).toBeInTheDocument();

        httpsCallable.mockReturnValue(vi.fn(async () => { throw new Error('boom'); }));
        fireEvent.click(syncButton());
        fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));
        expect(await screen.findByText('❌ Backfill Failed: boom')).toBeInTheDocument();
    });

    it('exposes its description as an accessible description, not a title tooltip', () => {
        const { container } = renderView();
        const describedBy = syncButton().getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(container.querySelector(`#${describedBy}`)).toHaveTextContent(
            'Force-sync all company data to public_profiles (fixes broken driver app links)',
        );
        expect(syncButton()).not.toHaveAttribute('title');
    });
});

describe('Maintenance — the public-profile output log', () => {
    it('renders the HH:MM:SS slice and the message for each line', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-28T09:41:07.123Z'));
        httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { success: true, message: '12 profiles' } })));

        renderView();
        fireEvent.click(screen.getByRole('button', { name: /Sync Public Profiles/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));

        expect(await screen.findByText('✅ Backfill Complete: 12 profiles')).toBeInTheDocument();
        expect(screen.getByText('🔄 Starting Public Profiles Backfill...')).toBeInTheDocument();
        expect(screen.getAllByText('09:41:07')).toHaveLength(2);
    });

    it('says it is waiting while the log is empty', () => {
        renderView();
        expect(screen.getByText('Waiting for a maintenance action...')).toBeInTheDocument();
    });

    it('puts the log in a named, keyboard-focusable region so it can be scrolled without a mouse', () => {
        renderView();
        const log = screen.getByRole('log');
        expect(log).toHaveAttribute('tabindex', '0');
        expect(log).toHaveAccessibleName('System Output Log');
    });

    it('scrolls the log, never the page, to the newest line', async () => {
        // jsdom has no `scrollIntoView`; this stub is removed again below.
        const scrollIntoView = vi.fn();
        Element.prototype.scrollIntoView = scrollIntoView;
        try {
            httpsCallable.mockReturnValue(vi.fn(async () => ({ data: { success: true, message: 'ok' } })));

            renderView();
            fireEvent.click(screen.getByRole('button', { name: /Sync Public Profiles/ }));
            fireEvent.click(await screen.findByRole('button', { name: 'Sync public profiles' }));
            await screen.findByText('✅ Backfill Complete: ok');

            // On a long page, `scrollIntoView` scrolls every ancestor, the page
            // included, so it moved the whole screen down to the log the moment
            // the screen opened.
            expect(scrollIntoView).not.toHaveBeenCalled();
        } finally {
            delete Element.prototype.scrollIntoView;
        }
    });
});

describe('Maintenance — links to the screens that keep their own maintenance', () => {
    it.each([
        ['AI Integrations', '/super-admin/ai-integrations?e2eAuth=super_admin'],
        ['Blog Posts', '/super-admin/blog-posts?e2eAuth=super_admin'],
        ['Releases', '/super-admin/releases?e2eAuth=super_admin'],
    ])('links to %s, keeping the query string', (name, href) => {
        renderView();
        const links = within(screen.getByRole('heading', { name: 'On other screens' }).closest('section'));
        expect(links.getByRole('link', { name })).toHaveAttribute('href', href);
    });

    it('opens the screen in place rather than reloading the app', () => {
        renderView();
        fireEvent.click(screen.getByRole('link', { name: 'Releases' }));
        expect(screen.getByTestId('address')).toHaveTextContent(/^\/super-admin\/releases\?e2eAuth=super_admin$/);
    });

    it('moves nothing: the model, blog and release buttons stay on their own screens', () => {
        renderView();
        for (const name of [/Use built-in versions/, /Check versions now/, /publication check/, /Release Testing version/, /Roll back/]) {
            expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
        }
    });
});
