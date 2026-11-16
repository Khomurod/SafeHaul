// What the audience step asks the server, counted call by call, with the real
// count hook and the real preview list (audit 6.7, owner decision K5). With
// "Exclude Previously Messaged" on, one count reads every matching lead and its
// ledger entry, so it runs on Recalculate audience only; Limit Volume is applied
// in the browser and never asks again. All fixtures are artificial.
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({
    getFilterCount: vi.fn(),
    getFilteredLeadsPage: vi.fn(),
    checkImportPhones: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: (_functions, name) => callables[name] }));
vi.mock('@/lib/firebase/config', () => ({ functions: {} }));
vi.mock('@/shared/hooks/useCompanyTeam', () => ({ useCompanyTeam: () => ({ team: [], isLoading: false }) }));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ currentUser: { uid: 'user-1' } }) }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }) }));
// One list for every render, as the real hook's state is: a new one each time
// would re-sync the filters forever.
const noRows = vi.hoisted(() => []);
vi.mock('@/shared/hooks/useBulkImport', () => ({
    useBulkImport: () => ({
        csvData: noRows, processingSheet: false, handleFileChange: vi.fn(), handleSheetImport: vi.fn(), sheetUrl: '', setSheetUrl: vi.fn(),
    }),
}));
// Virtuoso measures layout the test DOM cannot provide: render every row.
vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }) => <div>{data.map((item, index) => <div key={item.id}>{itemContent(index, item)}</div>)}</div>,
}));

import { AudienceBuilder } from './AudienceBuilder';

const LEADS = [
    { id: 'l1', firstName: 'Artificial', lastName: 'One', phone: '555-0101', status: 'new' },
    { id: 'l2', firstName: 'Artificial', lastName: 'Two', phone: '555-0102', status: 'new' },
];
const WINDOW = { leadType: 'applications', status: ['new'], recruiterId: 'all', excludeRecentDays: '30', excludedLeadIds: [] };
const NO_WINDOW = { ...WINDOW, excludeRecentDays: 'off' };
// Longer than the count's 500 ms wait, so a call that was going to happen has.
const pastTheDebounce = () => new Promise((resolve) => { setTimeout(resolve, 650); });
const shownCount = () => screen.getByText('recipients').previousSibling;
const typeLimit = (value) => fireEvent.change(screen.getByLabelText('Limit Volume'), { target: { value } });

function renderStep(filters) {
    const onChange = vi.fn();
    render(<AudienceBuilder companyId="co-1" filters={filters} onChange={onChange} />);
    return { onChange };
}

beforeEach(() => {
    vi.resetAllMocks();
    callables.getFilterCount.mockResolvedValue({ data: { count: 40, alreadyMessaged: 3 } });
    callables.getFilteredLeadsPage.mockResolvedValue({ data: { leads: LEADS } });
});

describe('AudienceBuilder — with the exclusion window on', () => {
    it('counts only on Recalculate audience; Limit Volume and filter changes ask nothing more', async () => {
        const { onChange } = renderStep(WINDOW);

        await screen.findByText('Count not up to date');
        await screen.findByText('Artificial Two');
        await pastTheDebounce();
        expect(callables.getFilterCount).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenLastCalledWith(expect.anything(), 0, { method: 'sms', alreadyMessaged: 0, needsRecount: true });

        fireEvent.click(screen.getByRole('button', { name: 'Recalculate audience' }));
        await waitFor(() => expect(shownCount()).toHaveTextContent('40'));
        expect(screen.queryByText('Count not up to date')).not.toBeInTheDocument();
        expect(screen.getByText('3 already messaged by SMS')).toBeInTheDocument();
        expect(onChange).toHaveBeenLastCalledWith(expect.anything(), 40, { method: 'sms', alreadyMessaged: 3, needsRecount: false });

        // Typing a limit trims the counted audience and the preview, here.
        for (const typed of ['1', '15', '150', '15', '1']) typeLimit(typed);
        await waitFor(() => expect(shownCount()).toHaveTextContent('1'));
        await waitFor(() => expect(screen.queryByText('Artificial Two')).not.toBeInTheDocument());
        await pastTheDebounce();
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ campaignLimit: '1' }), 1, { method: 'sms', alreadyMessaged: 3, needsRecount: false });
        expect(callables.getFilterCount).toHaveBeenCalledTimes(1);
        expect(callables.getFilteredLeadsPage).toHaveBeenCalledTimes(1);

        // A filter change makes the count out of date and asks for no count.
        fireEvent.click(screen.getByRole('button', { name: 'Hired' }));
        await screen.findByText('Count not up to date');
        await pastTheDebounce();
        expect(shownCount()).toHaveTextContent('—');
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: ['new', 'hired'] }), 0, { method: 'sms', alreadyMessaged: 0, needsRecount: true },
        );
        expect(callables.getFilterCount).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Recalculate audience' }));
        await waitFor(() => expect(shownCount()).toHaveTextContent('1'));
        expect(callables.getFilterCount).toHaveBeenCalledTimes(2);
        expect(callables.getFilterCount.mock.calls[1][0].filters).toEqual(expect.objectContaining({
            status: ['new', 'hired'], excludeRecentDays: '30', campaignLimit: null,
        }));
    });
});

describe('AudienceBuilder — without the exclusion window', () => {
    it('counts by itself, and typing Limit Volume asks the server nothing again', async () => {
        const { onChange } = renderStep(NO_WINDOW);
        await waitFor(() => expect(shownCount()).toHaveTextContent('40'));
        await screen.findByText('Artificial Two');

        for (const typed of ['2', '25', '250', '25']) typeLimit(typed);
        await waitFor(() => expect(shownCount()).toHaveTextContent('25'));
        await pastTheDebounce();

        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ campaignLimit: '25' }), 25, { method: 'sms', alreadyMessaged: 3, needsRecount: false });
        expect(screen.queryByText('Count not up to date')).not.toBeInTheDocument();
        expect(callables.getFilterCount).toHaveBeenCalledTimes(1);
        expect(callables.getFilteredLeadsPage).toHaveBeenCalledTimes(1);
    });
});
