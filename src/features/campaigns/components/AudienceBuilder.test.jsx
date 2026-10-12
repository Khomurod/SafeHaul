import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { AudienceBuilder } from './AudienceBuilder';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';

// Mocks
vi.mock('@/shared/hooks/useCompanyTeam', () => ({
    useCompanyTeam: () => ({
        team: [
            { id: 'recruiter1', name: 'John Doe' },
            { id: 'recruiter2', name: 'Jane Smith' }
        ],
        isLoading: false
    })
}));

vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentUser: { uid: 'user1' } })
}));

const mockSetFilters = vi.fn();
let mockCsvData = [];

// Stable import-hook doubles so the exact file/sheet wiring can be asserted.
const importMocks = vi.hoisted(() => ({
    handleFileChange: vi.fn(),
    handleSheetImport: vi.fn(),
    setSheetUrl: vi.fn(),
    reset: vi.fn(),
    sheetUrl: '',
    processingSheet: false,
}));

// What the count hook answers. A test sets the numbers the ledger found.
const defaultTargeting = () => ({ matchCount: 10, isLoading: false, excludedPhones: new Set() });
let mockTargeting = defaultTargeting();
vi.mock('../hooks/useCampaignTargeting', () => ({
    useCampaignTargeting: () => mockTargeting,
}));

// Captures the options AudienceBuilder passes, so the fix that stopped
// `useBulkImport` falling back to a blocking `alert()` here stays covered.
const bulkImportOptions = { current: undefined };
vi.mock('@/shared/hooks/useBulkImport', () => ({
    useBulkImport: (options) => {
        bulkImportOptions.current = options;
        return {
            csvData: mockCsvData,
            processingSheet: importMocks.processingSheet,
            handleFileChange: importMocks.handleFileChange,
            handleSheetImport: importMocks.handleSheetImport,
            sheetUrl: importMocks.sheetUrl,
            setSheetUrl: importMocks.setSheetUrl,
            reset: importMocks.reset,
        };
    }
}));

const toastMocks = { showSuccess: vi.fn(), showError: vi.fn() };
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => toastMocks,
}));

// Records the props the list receives so the frozen prop contract can be
// verified. Like the real list, it shows the CRM leads or the uploaded rows,
// names a row without an id by its place, and reports what it lists.
const CRM_LEADS = [
    { id: 'lead1', firstName: 'Alice', lastName: 'Driver' },
    { id: 'lead2', firstName: 'Bob', lastName: 'Trucker' },
];
let mockCrmLeads = CRM_LEADS;
const listProps = [];
vi.mock('./VirtualLeadList', () => ({
    default: function MockVirtualLeadList(props) {
        const { filters, excludedIds, onToggleExclusion, localData, onLeadsChange } = props;
        listProps.push(props);
        const leads = localData || mockCrmLeads;
        React.useEffect(() => { onLeadsChange?.(leads); }, [filters, leads, onLeadsChange]);
        return (
            <div data-testid="virtual-lead-list">
                {leads.map((lead, index) => {
                    const id = lead.id || `import_${index}`;
                    return (
                        <label key={id}>
                            <input
                                type="checkbox"
                                checked={!excludedIds?.includes(id)}
                                onChange={() => onToggleExclusion(id)}
                            />
                            {lead.firstName} {lead.lastName}
                        </label>
                    );
                })}
            </div>
        );
    }
}));

describe('AudienceBuilder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCsvData = [];
        mockTargeting = defaultTargeting();
        mockCrmLeads = CRM_LEADS;
    });

    it('renders and handles exclusions', () => {
        const handleChange = vi.fn();
        // Initial filters prop
        const filters = { limit: 100, excludedLeadIds: [] };

        const { rerender } = render(<AudienceBuilder companyId="123" filters={filters} onChange={handleChange} />);

        // Check if leads are displayed
        expect(screen.getByText('Alice Driver')).toBeInTheDocument();
        expect(screen.getByText('Bob Trucker')).toBeInTheDocument();

        // Check initial selection count
        expect(screen.getByText('10')).toBeInTheDocument(); // Match count display

        // Find checkboxes
        const checkboxes = screen.getAllByRole('checkbox');
        expect(checkboxes).toHaveLength(2);

        // Alice is first. Expect checked.
        expect(checkboxes[0]).toBeChecked();

        // Uncheck Alice
        fireEvent.click(checkboxes[0]);

        // Expect handleChange to be called with excludedLeadIds containing 'lead1',
        // and with the count that leaves Alice out: the launch screen shows it.
        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({
                excludedLeadIds: ['lead1']
            }),
            9
        );

        // Simulate parent updating props (as real app would)
        const newFilters = { ...filters, excludedLeadIds: ['lead1'] };
        rerender(<AudienceBuilder companyId="123" filters={newFilters} onChange={handleChange} />);

        // Now Alice should be unchecked
        const newCheckboxes = screen.getAllByRole('checkbox');
        expect(newCheckboxes[0]).not.toBeChecked();

        // Bob should still be checked
        expect(newCheckboxes[1]).toBeChecked();

        // Check if "excluded manually" text appears
        expect(screen.getByText('1 manually excluded')).toBeInTheDocument();
    });

    it('resets manual skips when upload list fingerprint changes', () => {
        mockCsvData = [
            { normalizedPhone: '+15550000001', firstName: 'Alice', lastName: 'One' },
            { normalizedPhone: '+15550000002', firstName: 'Bob', lastName: 'Two' },
        ];
        const handleChange = vi.fn();
        const filters = { leadType: 'import', excludedLeadIds: [] };
        const props = { companyId: '123', filters, onChange: handleChange, campaignScopeKey: 'cmp-a' };

        const { rerender } = render(<AudienceBuilder {...props} />);

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // un-tick Alice, the first row

        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({ excludedLeadIds: ['import_0'] }),
            1
        );

        mockCsvData = [
            { normalizedPhone: '+15559999991', firstName: 'Carol', lastName: 'Three' },
            { normalizedPhone: '+15559999992', firstName: 'Dan', lastName: 'Four' },
        ];
        rerender(<AudienceBuilder {...props} />);

        const lastCall = handleChange.mock.calls.at(-1);
        expect(lastCall[0].excludedLeadIds || []).toEqual([]);
        expect(lastCall[1]).toBe(2);
    });

    it('keeps an uploaded list and its un-ticks when the recruiter comes back to Audience', () => {
        // The editor unmounts this step on Content and Launch. Back on Audience the
        // import hook starts empty, and the list is the one the editor kept.
        const rows = [
            { normalizedPhone: '+15550000001', firstName: 'Alice', lastName: 'One' },
            { normalizedPhone: '+15550000002', firstName: 'Bob', lastName: 'Two' },
        ];
        const handleChange = vi.fn();
        const filters = { leadType: 'import', rawData: rows, excludedLeadIds: ['import_1'] };

        render(<AudienceBuilder companyId="123" filters={filters} onChange={handleChange} campaignScopeKey="cmp-a" />);

        expect(screen.getByText('Alice One')).toBeInTheDocument();
        expect(screen.getByText('Bob Two')).toBeInTheDocument();
        const [lastFilters, lastCount] = handleChange.mock.calls.at(-1);
        expect(lastFilters.rawData).toEqual(rows);
        expect(lastFilters.excludedLeadIds).toEqual(['import_1']);
        expect(lastCount).toBe(1);
    });

    it('drops the old list and its un-ticks while a replacement file is read', () => {
        // Choosing another file empties the import hook until the new one is
        // read; if that read fails or the recruiter leaves, the old list must not
        // stay behind with its un-ticks cleared.
        mockCsvData = [
            { normalizedPhone: '+15550000001', firstName: 'Alice', lastName: 'One' },
            { normalizedPhone: '+15550000002', firstName: 'Bob', lastName: 'Two' },
        ];
        const handleChange = vi.fn();
        const props = { companyId: '123', filters: { leadType: 'import', excludedLeadIds: [] }, onChange: handleChange, campaignScopeKey: 'cmp-a' };
        const { rerender } = render(<AudienceBuilder {...props} />);
        fireEvent.click(screen.getAllByRole('checkbox')[0]);

        mockCsvData = [];
        rerender(<AudienceBuilder {...props} />);

        const [lastFilters, lastCount] = handleChange.mock.calls.at(-1);
        expect(lastFilters.rawData).toEqual([]);
        expect(lastCount).toBe(0);
        expect(screen.queryByText('Alice One')).not.toBeInTheDocument();
    });

    it('keeps the list the editor kept across a switch to CRM and back', () => {
        const rows = [{ normalizedPhone: '+15550000001', firstName: 'Alice', lastName: 'One' }];
        const handleChange = vi.fn();
        render(<AudienceBuilder companyId="123" filters={{ leadType: 'import', rawData: rows, excludedLeadIds: [] }} onChange={handleChange} campaignScopeKey="cmp-a" />);

        fireEvent.click(screen.getByRole('tab', { name: 'CRM Filters' }));
        fireEvent.click(screen.getByRole('tab', { name: /Upload List/ }));

        expect(screen.getByText('Alice One')).toBeInTheDocument();
        expect(handleChange.mock.calls.at(-1)[0].rawData).toEqual(rows);
    });

    it('resets manual skips when campaign scope changes', () => {
        mockCsvData = [{ normalizedPhone: '+15550000001', firstName: 'Alice' }];
        const handleChange = vi.fn();
        const filters = { leadType: 'import', excludedLeadIds: [] };
        const { rerender } = render(
            <AudienceBuilder
                companyId="123"
                filters={filters}
                onChange={handleChange}
                campaignScopeKey="cmp-a"
            />
        );

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // un-tick Alice, the only row
        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({ excludedLeadIds: ['import_0'] }),
            0
        );

        rerender(
            <AudienceBuilder
                companyId="123"
                filters={filters}
                onChange={handleChange}
                campaignScopeKey="cmp-b"
            />
        );

        const lastCall = handleChange.mock.calls.at(-1);
        expect(lastCall[0].excludedLeadIds || []).toEqual([]);
    });

    it('keeps manual skips for normal filter tweaks in same campaign/list', () => {
        mockCsvData = [{ normalizedPhone: '+15550000001', firstName: 'Alice' }];
        const handleChange = vi.fn();
        const filters = { leadType: 'import', excludedLeadIds: [], excludeRecentDays: '7' };

        render(
            <AudienceBuilder
                companyId="123"
                filters={filters}
                onChange={handleChange}
                campaignScopeKey="cmp-a"
            />
        );

        const checkboxes = screen.getAllByRole('checkbox');
        fireEvent.click(checkboxes[0]); // un-tick Alice, the only row

        const excludeSelect = screen.getAllByRole('combobox').at(-1);
        fireEvent.change(excludeSelect, { target: { value: '30' } });

        const lastCall = handleChange.mock.calls.at(-1);
        expect(lastCall[0].excludedLeadIds || []).toEqual(['import_0']);
        expect(lastCall[0].excludeRecentDays).toBe('30');
    });

    it('stops subtracting an un-ticked lead the new filters no longer list', () => {
        const handleChange = vi.fn();
        render(<AudienceBuilder companyId="123" filters={{ excludedLeadIds: [] }} onChange={handleChange} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Alice Driver' }));
        expect(handleChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ excludedLeadIds: ['lead1'] }),
            9,
        );

        // Alice is an applicant, not one of "My Leads": the server's count of 10
        // already leaves her out, and taking her off again would undercount. Her
        // un-tick still goes to the server, in case the filters match her again.
        mockCrmLeads = [{ id: 'lead3', firstName: 'Cara', lastName: 'Hauler' }];
        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'leads' } });

        expect(handleChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ leadType: 'leads', excludedLeadIds: ['lead1'] }),
            10,
        );
        expect(screen.queryByText(/manually excluded/)).not.toBeInTheDocument();
    });

    it('counts an un-ticked row the ledger then finds already messaged once', () => {
        mockCsvData = [
            { normalizedPhone: '+15550000001', firstName: 'Alice', lastName: 'One' },
            { normalizedPhone: '+15550000002', firstName: 'Bob', lastName: 'Two' },
            { normalizedPhone: '+15550000003', firstName: 'Cara', lastName: 'Three' },
        ];
        mockTargeting = { ...defaultTargeting(), matchCount: 3 };
        const handleChange = vi.fn();
        render(
            <AudienceBuilder
                companyId="123"
                filters={{ leadType: 'import', excludeRecentDays: 'off', excludedLeadIds: [] }}
                onChange={handleChange}
            />
        );

        fireEvent.click(screen.getByRole('checkbox', { name: 'Alice One' }));
        expect(handleChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ excludedLeadIds: ['import_0'] }),
            2,
        );

        // Under "Last 7 Days" the ledger finds Alice's number. She is left out
        // once: two of the three rows are messaged, not one.
        mockTargeting = { ...defaultTargeting(), matchCount: 2, excludedPhones: new Set(['+15550000001']) };
        fireEvent.change(screen.getByLabelText('Exclude Previously Messaged'), { target: { value: '7' } });

        expect(handleChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ excludeRecentDays: '7', excludedLeadIds: ['import_0'] }),
            2,
        );
        expect(screen.getByText('1 already messaged')).toBeInTheDocument();
        expect(screen.queryByText(/manually excluded/)).not.toBeInTheDocument();
    });

    it('clears the un-ticks when any row of a re-imported list changes', () => {
        const row = (n, firstName) => ({ normalizedPhone: `+1555000000${n}`, firstName, lastName: 'Driver' });
        mockCsvData = ['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay'].map((name, i) => row(i + 1, name));
        const handleChange = vi.fn();
        const props = {
            companyId: '123',
            filters: { leadType: 'import', excludedLeadIds: [] },
            onChange: handleChange,
            campaignScopeKey: 'cmp-a',
        };
        const { rerender } = render(<AudienceBuilder {...props} />);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Fay Driver' }));
        expect(handleChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ excludedLeadIds: ['import_5'] }),
            5,
        );

        // The sheet is imported again: the same length and the same first five
        // rows, but someone else is sixth now, and they were never un-ticked.
        mockCsvData = [...mockCsvData.slice(0, 5).map((r) => ({ ...r })), row(7, 'Gus')];
        rerender(<AudienceBuilder {...props} />);

        expect(handleChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ excludedLeadIds: [] }),
            6,
        );
        expect(screen.getByRole('checkbox', { name: 'Gus Driver' })).toBeChecked();
    });
});

// --- Design-system migration coverage ------------------------------------
// Freezes the migrated presentation (accessible tablists, labelled filters,
// pressed status pills, announced count, single file-input trigger) and
// re-verifies the targeting/import/exclusion contracts it must not change.
describe('AudienceBuilder — migrated presentation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCsvData = [];
        mockTargeting = defaultTargeting();
        mockCrmLeads = CRM_LEADS;
        listProps.length = 0;
        importMocks.sheetUrl = '';
        importMocks.processingSheet = false;
    });

    const renderBuilder = (overrides = {}) => {
        const onChange = vi.fn();
        const props = {
            companyId: 'co-1',
            filters: { excludedLeadIds: [] },
            onChange,
            ...overrides,
        };
        return { onChange, ...render(<AudienceBuilder {...props} />) };
    };

    it('applies the initial filter defaults when no filters are supplied', () => {
        const { onChange } = renderBuilder({ filters: null });

        expect(onChange).toHaveBeenCalledWith(
            { leadType: 'applications', status: ['new'], recruiterId: 'all' },
            10,
        );
        expect(screen.getByLabelText('Source')).toHaveValue('applications');
        expect(screen.getByLabelText('Owner')).toHaveValue('all');
        expect(screen.getByRole('button', { name: 'New Application' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('restores the upload tab from filters.leadType and exposes selected state', () => {
        renderBuilder({ filters: { leadType: 'import', excludedLeadIds: [] } });

        const tablist = screen.getByRole('tablist', { name: 'Audience source' });
        expect(tablist).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Upload List/ })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'CRM Filters' })).toHaveAttribute('aria-selected', 'false');
        // Upload panel is shown.
        expect(screen.getByRole('tablist', { name: 'Import method' })).toBeInTheDocument();
    });

    it('defaults to the CRM tab and its panel', () => {
        renderBuilder();
        expect(screen.getByRole('tab', { name: 'CRM Filters' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByLabelText('Source')).toBeInTheDocument();
    });

    it('moves the source tab with the arrow keys', () => {
        renderBuilder();
        const crm = screen.getByRole('tab', { name: 'CRM Filters' });
        const upload = screen.getByRole('tab', { name: /Upload List/ });

        crm.focus();
        fireEvent.keyDown(crm, { key: 'ArrowRight' });
        expect(upload).toHaveAttribute('aria-selected', 'true');
        expect(upload).toHaveFocus();

        fireEvent.keyDown(upload, { key: 'ArrowLeft' });
        expect(crm).toHaveAttribute('aria-selected', 'true');
        expect(crm).toHaveFocus();
    });

    it('adds rawData + import leadType on upload and strips rawData back on CRM', () => {
        mockCsvData = [{ normalizedPhone: '+15550000001', firstName: 'Alice' }];
        const { onChange } = renderBuilder();

        fireEvent.click(screen.getByRole('tab', { name: /Upload List/ }));
        let last = onChange.mock.calls.at(-1)[0];
        expect(last.leadType).toBe('import');
        expect(last.rawData).toEqual(mockCsvData);

        fireEvent.click(screen.getByRole('tab', { name: 'CRM Filters' }));
        last = onChange.mock.calls.at(-1)[0];
        expect(last).not.toHaveProperty('rawData');
        expect(last.leadType).toBe('applications');
    });

    it('exposes the exact source, owner and exclusion option values', () => {
        renderBuilder();

        const source = screen.getByLabelText('Source');
        expect([...source.options].map(o => o.value)).toEqual(['applications', 'leads']);

        const owner = screen.getByLabelText('Owner');
        expect([...owner.options].map(o => o.value)).toEqual(['all', 'my_leads', 'recruiter1', 'recruiter2']);

        const exclude = screen.getByLabelText('Exclude Previously Messaged');
        expect([...exclude.options].map(o => o.value)).toEqual(['off', '7', '30', 'forever']);
    });

    it('defaults exclusion to off on CRM and 7 on upload', () => {
        const { unmount } = renderBuilder();
        expect(screen.getByLabelText('Exclude Previously Messaged')).toHaveValue('off');
        unmount();

        renderBuilder({ filters: { leadType: 'import', excludedLeadIds: [] } });
        expect(screen.getByLabelText('Exclude Previously Messaged')).toHaveValue('7');
    });

    it('updates filters through labelled controls', () => {
        const { onChange } = renderBuilder();

        fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'leads' } });
        expect(onChange.mock.calls.at(-1)[0].leadType).toBe('leads');

        fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'recruiter2' } });
        expect(onChange.mock.calls.at(-1)[0].recruiterId).toBe('recruiter2');

        fireEvent.change(screen.getByLabelText('Limit Volume'), { target: { value: '250' } });
        expect(onChange.mock.calls.at(-1)[0].campaignLimit).toBe('250');
    });

    it('toggles status pills as a multi-select with pressed state', () => {
        const { onChange } = renderBuilder({ filters: { status: ['new'], excludedLeadIds: [] } });

        const hired = screen.getByRole('button', { name: 'Hired' });
        expect(hired).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(hired);
        expect(onChange.mock.calls.at(-1)[0].status).toEqual(['new', 'hired']);
        expect(screen.getByRole('button', { name: 'Hired' })).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByRole('button', { name: 'New Application' }));
        expect(onChange.mock.calls.at(-1)[0].status).toEqual(['hired']);
    });

    it('subtracts manual exclusions from the confirmed count', () => {
        const { onChange } = renderBuilder();

        fireEvent.click(screen.getAllByRole('checkbox')[0]); // exclude lead1
        // Parent sync reports finalCount = 10 - 1, the number the launch screen
        // says will be messaged…
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ excludedLeadIds: ['lead1'] }),
            9,
        );

        // …and so does the confirm action.
        const confirm = screen.getByRole('button', { name: 'Confirm Audience (9)' });
        fireEvent.click(confirm);
        expect(onChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ excludedLeadIds: ['lead1'] }),
            9,
        );
    });

    it('passes the frozen VirtualLeadList props in CRM and upload modes', () => {
        mockCsvData = [{ normalizedPhone: '+15550000001', firstName: 'Alice' }];
        renderBuilder();

        const crmProps = listProps.at(-1);
        expect(crmProps.companyId).toBe('co-1');
        expect(crmProps.localData).toBeNull();
        expect(crmProps.excludedPhones).toBeNull();
        expect(crmProps.filters).toEqual(expect.objectContaining({ excludedLeadIds: [] }));
        expect(typeof crmProps.onToggleExclusion).toBe('function');
        expect(typeof crmProps.onLeadsChange).toBe('function');

        fireEvent.click(screen.getByRole('tab', { name: /Upload List/ }));
        const uploadProps = listProps.at(-1);
        expect(uploadProps.localData).toEqual(mockCsvData);
        expect(uploadProps.excludedPhones).toBeInstanceOf(Set);
    });

    /*
     * The picker is the design system's `FileInput variant="dropzone"` since
     * 2026-08-25. The accept list is byte-for-byte the same; what changed is that
     * the visible affordance is the `<label>` wrapping the input rather than a
     * sibling `Button` calling `.click()` on it, and `FileInput`'s `onDrop`
     * makes the whole panel a real drop target.
     */
    it('uses one labelled file input with the exact accept list', () => {
        renderBuilder({ filters: { leadType: 'import', excludedLeadIds: [] } });

        const input = screen.getByLabelText('Upload a recipient list');
        expect(input).toHaveAttribute('type', 'file');
        expect(input).toHaveAttribute(
            'accept',
            '.csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel',
        );
        // One control: the label IS the affordance, and there is no button.
        expect(input.closest('label')).toHaveAttribute('for', input.id);
        expect(screen.queryByRole('button', { name: 'Choose file' })).not.toBeInTheDocument();

        fireEvent.change(input, { target: { files: [] } });
        expect(importMocks.handleFileChange).toHaveBeenCalled();
    });

    it('wires the Google Sheet URL field and import action', () => {
        renderBuilder({ filters: { leadType: 'import', _importTab: 'sheet', excludedLeadIds: [] } });

        expect(screen.getByRole('tab', { name: 'Google Sheets' })).toHaveAttribute('aria-selected', 'true');

        const url = screen.getByLabelText('Google Sheet URL');
        fireEvent.change(url, { target: { value: 'https://docs.google.com/spreadsheets/d/abc' } });
        expect(importMocks.setSheetUrl).toHaveBeenCalledWith('https://docs.google.com/spreadsheets/d/abc');

        fireEvent.click(screen.getByRole('button', { name: 'Import' }));
        expect(importMocks.handleSheetImport).toHaveBeenCalled();
    });

    it('disables the sheet import while processing', () => {
        importMocks.processingSheet = true;
        renderBuilder({ filters: { leadType: 'import', _importTab: 'sheet', excludedLeadIds: [] } });
        expect(screen.getByRole('button', { name: /Loading/ })).toBeDisabled();
    });

    it('switches the import method tab and stores it on the filters', () => {
        const { onChange } = renderBuilder({ filters: { leadType: 'import', excludedLeadIds: [] } });

        expect(screen.getByRole('tab', { name: /File Upload/ })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('tab', { name: 'Google Sheets' }));

        expect(onChange.mock.calls.at(-1)[0]._importTab).toBe('sheet');
    });

    it('flags an audience over the 2,000-a-launch limit', () => {
        mockTargeting = { ...defaultTargeting(), matchCount: 2001 };
        renderBuilder();
        expect(screen.getByText('Over the 2,000-per-launch limit')).toBeInTheDocument();
    });

    it('does not flag an audience of exactly 2,000', () => {
        mockTargeting = { ...defaultTargeting(), matchCount: 2000 };
        renderBuilder();
        expect(screen.queryByText('Over the 2,000-per-launch limit')).not.toBeInTheDocument();
    });

    it('announces the recipient count', () => {
        renderBuilder();
        expect(screen.getByRole('status')).toHaveTextContent('10 recipients selected.');
    });

    /**
     * This was the one `useBulkImport` consumer that passed no `onError`, so the
     * hook fell back to a blocking `alert()` and every CSV/Sheet import failure
     * froze the tab with a native prompt. Fixed 2026-07-28.
     */
    it('gives useBulkImport a non-blocking error sink', () => {
        renderBuilder();
        expect(typeof bulkImportOptions.current?.onError).toBe('function');

        bulkImportOptions.current.onError('Invalid Google Sheet URL.');
        expect(toastMocks.showError).toHaveBeenCalledWith('Invalid Google Sheet URL.');
    });

    it('has no accessibility violations in CRM mode', async () => {
        const { container } = renderBuilder();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations in upload mode', async () => {
        const { container } = renderBuilder({ filters: { leadType: 'import', excludedLeadIds: [] } });
        expect((await axe(container)).violations).toEqual([]);
    });
});
