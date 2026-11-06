/**
 * What the candidate list's cells show: the dossier's one name for each
 * stored status, the phone number as the call button, the Stale mark beside a name,
 * and the recruiter from the company's team.
 *
 * All names below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateColumns } from './candidateListColumns';
import { dossierStatusLabel } from '../components/modals/driver-dossier/dossierStatusLabel';

const TEAM = [{ id: 'recruiter-1', name: 'Rae Recruiter' }];

const cell = (key, item, { scope = 'applications', handlePhoneClick = vi.fn() } = {}) => {
    const columns = buildCandidateColumns({ handlePhoneClick, scope, teamMembers: TEAM });
    const column = columns.find((c) => c.key === key);
    return render(<div data-testid="cell">{column.render(item)}</div>);
};

describe('the Status column', () => {
    it.each([
        ['New Application', 'New'],
        ['Approved', 'Hired'],
        ['Rejected', 'Declined'],
        ['Contact Attempt 1', 'Contact Attempt 1'],
    ])('shows an application stored as %j as %j', (status, shown) => {
        cell('status', { status });

        expect(screen.getByTestId('cell')).toHaveTextContent(new RegExp(`^${shown}$`));
    });

    it.each([
        ['New Lead', 'New'],
        ['New', 'New'],
        ['Rejected', 'Declined'],
        ['Contact Attempt 2', 'Contact Attempt 2'],
        ['Interested', 'Interested'],
        ['Background Check', 'Background Check'],
        ['', 'New'],
    ])("shows a lead stored as %j as %j, the dossier's name for it", (status, shown) => {
        for (const scope of ['company_leads', 'my_leads', 'unassigned_leads']) {
            const { unmount } = cell('status', { status }, { scope });
            expect(screen.getByTestId('cell')).toHaveTextContent(new RegExp(`^${shown}$`));
            expect(dossierStatusLabel(status) || 'New').toBe(shown);
            unmount();
        }
    });
});

describe('the Phone column', () => {
    it('is the call button, named for the driver and the number', async () => {
        const handlePhoneClick = vi.fn();
        const item = { firstName: 'Maria', lastName: 'Garcia', phone: '5125550134' };
        cell('phone', item, { handlePhoneClick });

        await userEvent.click(screen.getByRole('button', { name: 'Call Maria Garcia at (512) 555-0134' }));

        expect(handlePhoneClick).toHaveBeenCalledWith(expect.anything(), item);
    });

    it('says quietly that there is no number, with nothing to press', () => {
        cell('phone', { firstName: 'Maria', lastName: 'Garcia' });

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByTestId('cell')).toHaveTextContent(/^—$/);
    });
});

describe('the Driver column', () => {
    it('marks a first attempt more than 48 hours old as Stale', () => {
        const longAgo = { seconds: Math.floor(Date.now() / 1000) - 80 * 3600 };
        cell('identity', { firstName: 'Omar', lastName: 'Attempt', status: 'Contact Attempt 1', statusEnteredAt: longAgo });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Omar AttemptStale$/);
    });
});

describe('the Assigned to column', () => {
    it("shows the assignee's name from the company's team", () => {
        cell('assignee', { assignedTo: 'recruiter-1' });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Rae Recruiter$/);
    });

    it('shows the stored name of an assignee the team no longer lists', () => {
        cell('assignee', { assignedTo: 'recruiter-9', assignedToName: 'Ann Baker' });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Ann Baker$/);
    });

    it('shows a dash, not "Unassigned", for an assignee nobody can name', () => {
        cell('assignee', { assignedTo: 'recruiter-9' });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^—$/);
    });

    // A name left on an unassigned record is a leftover: unassigning in the
    // dossier once stored "Unassigned" as the name.
    it.each([
        { assignedTo: '', assignedToName: 'Unassigned' },
        { assignedTo: null, assignedToName: 'Ann Baker' },
        { assignedTo: '', assignedToName: '' },
    ])('shows Unassigned for %o', (item) => {
        cell('assignee', item);

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Unassigned$/);
    });
});
