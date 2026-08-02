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

vi.mock('../hooks/useCampaignTargeting', () => ({
    useCampaignTargeting: () => ({
        matchCount: 10,
        isLoading: false,
        excludedPhones: new Set(),
    })
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
// verified, while keeping the two exclusion checkboxes the older tests drive.
const listProps = [];
vi.mock('./VirtualLeadList', () => ({
    default: (props) => {
        const { filters, excludedIds, onToggleExclusion } = props;
        listProps.push(props);
        return (
            <div data-testid="virtual-lead-list">
                <label>
                    <input
                        type="checkbox"
                        checked={!excludedIds?.includes('lead1')}
                        onChange={() => onToggleExclusion('lead1')}
                    />
                    Alice Driver
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={!excludedIds?.includes('lead2')}
                        onChange={() => onToggleExclusion('lead2')}
                    />
                    Bob Trucker
                </label>
            </div>
        );
    }
}));

describe('AudienceBuilder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCsvData = [];
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

        // Expect handleChange to be called with excludedLeadIds containing 'lead1'
        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({
                excludedLeadIds: ['lead1']
            }),
            10
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
        fireEvent.click(checkboxes[0]); // exclude lead1

        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({ excludedLeadIds: ['lead1'] }),
            10
        );

        mockCsvData = [
            { normalizedPhone: '+15559999991', firstName: 'Carol', lastName: 'Three' },
            { normalizedPhone: '+15559999992', firstName: 'Dan', lastName: 'Four' },
        ];
        rerender(<AudienceBuilder {...props} />);

        const lastCall = handleChange.mock.calls.at(-1);
        expect(lastCall[0].excludedLeadIds || []).toEqual([]);
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
        fireEvent.click(checkboxes[0]); // exclude lead1
        expect(handleChange).toHaveBeenCalledWith(
            expect.objectContaining({ excludedLeadIds: ['lead1'] }),
            10
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
        fireEvent.click(checkboxes[0]); // exclude lead1

        const excludeSelect = screen.getAllByRole('combobox').at(-1);
        fireEvent.change(excludeSelect, { target: { value: '30' } });

        const lastCall = handleChange.mock.calls.at(-1);
        expect(lastCall[0].excludedLeadIds || []).toEqual(['lead1']);
        expect(lastCall[0].excludeRecentDays).toBe('30');
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
        // Parent sync still reports the raw matchCount…
        expect(onChange).toHaveBeenCalledWith(
            expect.objectContaining({ excludedLeadIds: ['lead1'] }),
            10,
        );

        // …while the confirm action reports finalCount = 10 - 1.
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

        fireEvent.click(screen.getByRole('tab', { name: /Upload List/ }));
        const uploadProps = listProps.at(-1);
        expect(uploadProps.localData).toEqual(mockCsvData);
        expect(uploadProps.excludedPhones).toBeInstanceOf(Set);
    });

    it('uses one labelled file input with the exact accept list and no nested controls', () => {
        renderBuilder({ filters: { leadType: 'import', excludedLeadIds: [] } });

        const input = screen.getByLabelText('Upload recipient list file');
        expect(input).toHaveAttribute('type', 'file');
        expect(input).toHaveAttribute(
            'accept',
            '.csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel',
        );
        // The trigger is a sibling button — the input is not nested inside it.
        const trigger = screen.getByRole('button', { name: 'Choose file' });
        expect(trigger.contains(input)).toBe(false);

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
