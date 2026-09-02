import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({
    current: { status: 'idle', suggestions: null, skippedPages: 0, error: '', importFile: vi.fn(), reset: vi.fn() },
}));
vi.mock('@features/driver-app/hooks/useReportImport', () => ({
    useReportImport: () => hookState.current,
}));

import { ReportImportPanel } from './ReportImportPanel';

const company = { id: 'co-1', applicationIntegrations: { psp: { enabled: true }, mvr: { enabled: true } } };

/** A `updateFormData` double that applies functional updates against a live store. */
function makeStore(initial) {
    const store = { data: { ...initial } };
    store.update = vi.fn((key, value) => {
        store.data = { ...store.data, [key]: typeof value === 'function' ? value(store.data[key]) : value };
    });
    return store;
}

function setHook(patch) {
    hookState.current = { ...hookState.current, importFile: vi.fn(), reset: vi.fn(), ...patch };
}

describe('ReportImportPanel', () => {
    beforeEach(() => {
        setHook({ status: 'idle', suggestions: null, skippedPages: 0, error: '' });
    });

    it('offers the upload and hands the chosen file to the hook', () => {
        const store = makeStore({});
        render(<ReportImportPanel kind="psp" company={company} formData={store.data} updateFormData={store.update} />);
        expect(screen.getByRole('heading', { level: 2, name: 'Import from your PSP report' })).toBeInTheDocument();
        const input = screen.getByLabelText(/Upload your PSP report/);
        const file = new File(['%PDF'], 'psp.pdf', { type: 'application/pdf' });
        fireEvent.change(input, { target: { files: [file] } });
        expect(hookState.current.importFile).toHaveBeenCalledWith(file);
        expect(store.update).not.toHaveBeenCalled();
    });

    it('announces a read failure', () => {
        setHook({ status: 'error', error: 'This carrier has not enabled report import.' });
        render(<ReportImportPanel kind="mvr" company={company} formData={{}} updateFormData={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent('This carrier has not enabled report import.');
    });

    it('says so when the file yielded nothing usable', () => {
        setHook({ status: 'ready', suggestions: { carriers: [], violations: [] } });
        render(<ReportImportPanel kind="psp" company={company} formData={{}} updateFormData={vi.fn()} />);
        expect(screen.getByTestId('report-import-empty')).toBeInTheDocument();
    });

    describe('PSP carriers', () => {
        const suggestions = {
            carriers: [
                { name: 'Acme Trucking', dotNumber: '123456', firstSeen: '2024-03', lastSeen: '2025-01', recordType: 'inspection' },
                { name: 'Beta Freight', dotNumber: '777', firstSeen: '2022-01', lastSeen: '2022-02', recordType: 'crash' },
            ],
            violations: [{ date: '2023-07-04', charge: 'Speeding 15 over', location: 'Dallas, TX' }],
        };

        it('adds a carrier as an employer row with name and USDOT only, and never twice', () => {
            setHook({ status: 'ready', suggestions });
            const store = makeStore({ employers: [{ companyName: 'Beta Freight', dotNumber: '777', startDate: '2022-01-01' }] });
            const view = render(<ReportImportPanel kind="psp" company={company} formData={store.data} updateFormData={store.update} />);

            const list = within(screen.getByTestId('carrier-suggestions'));
            expect(list.getByText('Already in your history')).toBeInTheDocument();
            expect(list.getByText('On inspection records from Mar 2024 to Jan 2025')).toBeInTheDocument();

            fireEvent.click(list.getByRole('button', { name: 'Add Acme Trucking as an employer' }));
            expect(store.data.employers).toHaveLength(2);
            const added = store.data.employers[1];
            expect(added).toMatchObject({ companyName: 'Acme Trucking', dotNumber: '123456', startDate: '', endDate: '' });
            // The row the applicant already had is untouched.
            expect(store.data.employers[0]).toEqual({ companyName: 'Beta Freight', dotNumber: '777', startDate: '2022-01-01' });

            view.rerender(<ReportImportPanel kind="psp" company={company} formData={store.data} updateFormData={store.update} />);
            expect(within(screen.getByTestId('carrier-suggestions')).getAllByText('Already in your history')).toHaveLength(2);
            expect(screen.queryByRole('button', { name: 'Add Acme Trucking as an employer' })).not.toBeInTheDocument();
        });

        it('adds a violation to the violations list and answers the Yes/No question', () => {
            setHook({ status: 'ready', suggestions });
            const store = makeStore({ violations: [], 'has-violations': 'no' });
            render(<ReportImportPanel kind="psp" company={company} formData={store.data} updateFormData={store.update} />);

            fireEvent.click(screen.getByRole('button', { name: 'Add violation: Speeding 15 over' }));
            expect(store.data.violations).toHaveLength(1);
            expect(store.data.violations[0]).toMatchObject({ date: '2023-07-04', charge: 'Speeding 15 over', location: 'Dallas, TX', penalty: '' });
            expect(store.data['has-violations']).toBe('yes');
        });

        it('offers "add all" only for the carriers not yet listed', () => {
            setHook({ status: 'ready', suggestions });
            const store = makeStore({ employers: [] });
            render(<ReportImportPanel kind="psp" company={company} formData={store.data} updateFormData={store.update} />);
            fireEvent.click(screen.getByRole('button', { name: 'Add all 2 carriers' }));
            expect(store.data.employers.map((row) => row.companyName)).toEqual(['Acme Trucking', 'Beta Freight']);
        });
    });

    describe('MVR licence details', () => {
        const suggestions = {
            license: { cdlNumber: 'TX1234567', cdlState: 'TX', cdlClass: 'Class A', cdlExpiration: '2030-12-31', endorsements: ['H', 'N'] },
            violations: [],
        };

        it('fills only the empty fields and reports the ones it kept', () => {
            setHook({ status: 'ready', suggestions });
            const store = makeStore({ cdlNumber: 'MINE-1', cdlState: '', cdlClass: '', cdlExpiration: '', endorsements: 'T' });
            render(<ReportImportPanel kind="mvr" company={company} formData={store.data} updateFormData={store.update} />);

            expect(screen.getByTestId('license-plan-cdlNumber')).toHaveTextContent('Kept your entry: MINE-1');
            expect(screen.getByTestId('license-plan-endorsements')).toHaveTextContent('Kept your entry: T');
            expect(screen.getByTestId('license-plan-cdlState')).toHaveTextContent('Will fill');

            const button = screen.getByTestId('apply-license-details');
            expect(button).toHaveTextContent('Fill 3 empty fields');
            fireEvent.click(button);

            expect(store.data).toMatchObject({ cdlNumber: 'MINE-1', cdlState: 'TX', cdlClass: 'Class A', cdlExpiration: '2030-12-31', endorsements: 'T' });
            expect(store.update).toHaveBeenCalledTimes(3);
            expect(screen.getByTestId('apply-license-details')).toBeDisabled();
            expect(screen.getByTestId('apply-license-details')).toHaveTextContent('Details filled');
        });

        it('disables the fill when every field is already answered', () => {
            setHook({ status: 'ready', suggestions });
            const store = makeStore({ cdlNumber: 'A', cdlState: 'CA', cdlClass: 'Class B', cdlExpiration: '2031-01-01', endorsements: 'H' });
            render(<ReportImportPanel kind="mvr" company={company} formData={store.data} updateFormData={store.update} />);
            expect(screen.getByTestId('apply-license-details')).toBeDisabled();
            expect(screen.getByTestId('apply-license-details')).toHaveTextContent('Nothing to fill');
        });
    });

    it('clears the suggestions through the hook', () => {
        setHook({ status: 'ready', suggestions: { carriers: [], violations: [] } });
        render(<ReportImportPanel kind="psp" company={company} formData={{}} updateFormData={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear suggestions' }));
        expect(hookState.current.reset).toHaveBeenCalled();
    });
});
