/**
 * The line above the applications list opened on a month by the dashboard's
 * brief: which month, of applications added or hired, and Show all
 * applications to leave it.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PeriodNotice } from './PeriodNotice';

describe('the month an applications list was opened on', () => {
    it('names a month of applications added', () => {
        render(<PeriodNotice period={{ field: 'createdAt', month: '2026-11' }} onShowAll={() => {}} />);

        expect(screen.getByText('Showing applications added in November 2026.')).toBeInTheDocument();
    });

    it('names a month of hires, whatever their status now, from the day hire dates began', () => {
        render(<PeriodNotice period={{ field: 'hiredAt', month: '2026-11' }} onShowAll={() => {}} />);

        expect(screen.getByText('Showing applications hired since Nov 6, 2026, whatever their status now.')).toBeInTheDocument();
    });

    it('says when a month held more hires than it lists', () => {
        render(<PeriodNotice period={{ field: 'hiredAt', month: '2026-12' }} truncated onShowAll={() => {}} />);

        expect(screen.getByText(/^Showing applications hired in December 2026, whatever their status now\. Only the 200 most recent hires are listed/))
            .toBeInTheDocument();
    });

    it('leaves the month with Show all applications', () => {
        const onShowAll = vi.fn();
        render(<PeriodNotice period={{ field: 'createdAt', month: '2026-11' }} onShowAll={onShowAll} />);

        fireEvent.click(screen.getByRole('button', { name: 'Show all applications' }));

        expect(onShowAll).toHaveBeenCalledTimes(1);
    });

    it.each([null, undefined, { field: 'hiredAt', month: 'later' }])('renders nothing for %o', (period) => {
        const { container } = render(<PeriodNotice period={period} onShowAll={() => {}} />);

        expect(container).toBeEmptyDOMElement();
    });
});
