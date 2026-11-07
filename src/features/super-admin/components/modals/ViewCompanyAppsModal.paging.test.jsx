/**
 * The Super Admin's list of one company's applications reads them 20 at a time,
 * never all at once: a server count says how many there are, Load more reads
 * the next 20 after the last one shown, and the filter says it looks at the
 * rows read so far. All names and ids are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fx = vi.hoisted(() => ({ apps: [], reads: [], countFails: false, pageFails: false }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => '' }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    documentId: () => '__name__',
    orderBy: (field) => ({ op: 'orderBy', field }),
    limit: (n) => ({ op: 'limit', n }),
    startAfter: (after) => ({ op: 'startAfter', after }),
    query: (ref, ...parts) => ({ path: ref.path, parts }),
    getDocs: async (q) => {
        const part = (op) => q.parts.find((p) => p.op === op);
        fx.reads.push({ path: q.path, orderBy: part('orderBy')?.field, after: part('startAfter')?.after.id ?? null, limit: part('limit')?.n });
        if (fx.pageFails) throw new Error('unavailable');
        const start = part('startAfter') ? fx.apps.findIndex((app) => app.id === part('startAfter').after.id) + 1 : 0;
        const docs = fx.apps.slice(start, start + part('limit').n).map(({ id, ...data }) => ({ id, data: () => data }));
        return { docs };
    },
    getCountFromServer: async (ref) => {
        fx.reads.push({ count: ref.path });
        if (fx.countFails) throw new Error('unavailable');
        return { data: () => ({ count: fx.apps.length }) };
    },
}));

import { ViewCompanyAppsModal } from './ViewCompanyAppsModal';

const apps = (n) => Array.from({ length: n }, (_, i) => ({
    id: `app-${String(i).padStart(3, '0')}`,
    firstName: 'Driver',
    lastName: `Number ${i + 1}`,
    status: i % 2 ? 'Hired' : 'New Application',
}));

const pageReads = () => fx.reads.filter((read) => read.limit);
const rowCount = () => within(screen.getByRole('table')).getAllByRole('rowheader').length;

function renderModal() {
    return render(<ViewCompanyAppsModal companyId="co-1" companyName="Artificial Freight Co" onClose={vi.fn()} />);
}

beforeEach(() => {
    Object.assign(fx, { apps: apps(45), reads: [], countFails: false, pageFails: false });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the company applications list', () => {
    it('reads the first 20 and counts them all, rather than reading every application', async () => {
        renderModal();

        expect(await screen.findByText('Showing 20 of 45 applications.')).toBeInTheDocument();
        expect(rowCount()).toBe(20);
        expect(fx.reads).toEqual([
            { path: 'companies/co-1/applications', orderBy: '__name__', after: null, limit: 20 },
            { count: 'companies/co-1/applications' },
        ]);
    });

    it('reads the next 20 after the last one shown on Load more, until all are shown', async () => {
        renderModal();
        fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));

        expect(await screen.findByText('Showing 40 of 45 applications.')).toBeInTheDocument();
        expect(rowCount()).toBe(40);

        fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }));
        expect(await screen.findByText('All 45 applications are shown.')).toBeInTheDocument();
        expect(rowCount()).toBe(45);
        expect(screen.queryByRole('button', { name: 'Load more applications' })).toBeNull();
        expect(pageReads().map((read) => read.after)).toEqual([null, 'app-019', 'app-039']);
    });

    it('says nothing extra when every application fits in the first page', async () => {
        fx.apps = apps(4);
        renderModal();

        await waitFor(() => expect(rowCount()).toBe(4));
        expect(screen.queryByText(/Showing|are shown/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Load more applications' })).toBeNull();
    });

    it('says the filter looks only at the applications read so far', async () => {
        renderModal();
        await screen.findByText('Showing 20 of 45 applications.');

        fireEvent.change(screen.getByLabelText(/Filter applications/), { target: { value: 'hired' } });

        expect(screen.getByText('Showing 20 of 45 applications. The filter looks at these only.')).toBeInTheDocument();
        expect(rowCount()).toBe(10);
    });

    it('says a search that finds nothing looked only at the applications read so far', async () => {
        renderModal();
        await screen.findByText('Showing 20 of 45 applications.');

        fireEvent.change(screen.getByLabelText(/Filter applications/), { target: { value: 'nobody-by-this-name' } });

        expect(screen.getByRole('heading', { name: 'No matches found.', level: 3 })).toBeInTheDocument();
        expect(screen.getByText('Only the applications loaded so far were searched. Load more to search the rest.')).toBeInTheDocument();
    });

    it('keeps the rows when the next page cannot be read, and reads it on the next press', async () => {
        renderModal();
        const more = await screen.findByRole('button', { name: 'Load more applications' });

        fx.pageFails = true;
        fireEvent.click(more);
        expect(await screen.findByRole('alert')).toHaveTextContent('More applications could not be loaded.');
        expect(rowCount()).toBe(20);

        fx.pageFails = false;
        fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }));
        expect(await screen.findByText('Showing 40 of 45 applications.')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('still pages when the applications could not be counted', async () => {
        fx.countFails = true;
        renderModal();

        expect(await screen.findByText('Showing 20 applications.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }));
        expect(await screen.findByText('Showing 40 applications.')).toBeInTheDocument();
    });
});
