import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepIssues } from './StepIssues';

describe('StepIssues', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps two issues with one code apart, without a duplicate-key warning', () => {
        const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <StepIssues blocking={[
                { code: 'invalid-date', message: 'Employer 1: the end date is before the start date.' },
                { code: 'invalid-date', message: 'Employer 2: the end date is before the start date.' },
            ]} />,
        );

        expect(within(screen.getByTestId('step-blocking-issues')).getAllByRole('listitem')).toHaveLength(2);
        expect(warn.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    });

    it('turns an issue that names a field into a link that takes the applicant there', () => {
        const onFocusField = vi.fn();
        render(
            <StepIssues
                title="Before you continue:"
                onFocusField={onFocusField}
                blocking={[
                    { key: 'employers-0', code: 'employment-missing', message: 'Employer 1: start date.', focusId: 'emp-start-0-month' },
                    { code: 'other-rule', message: 'Add a violation or answer No.' },
                ]}
            />,
        );

        const notice = within(screen.getByTestId('step-blocking-issues'));
        expect(notice.getByText('Before you continue:')).toBeInTheDocument();
        const line = notice.getByRole('link', { name: 'Employer 1: start date.' });
        expect(line).toHaveAttribute('href', '#emp-start-0-month');
        fireEvent.click(line);
        expect(onFocusField).toHaveBeenCalledWith('emp-start-0-month');
        // A rule's own line stays plain text.
        expect(notice.queryByRole('link', { name: /violation/ })).not.toBeInTheDocument();
    });

    it('shows nothing until asked to', () => {
        render(<StepIssues blocking={[{ code: 'x', message: 'Hidden.' }]} showBlocking={false} />);
        expect(screen.queryByTestId('step-blocking-issues')).not.toBeInTheDocument();
    });
});
