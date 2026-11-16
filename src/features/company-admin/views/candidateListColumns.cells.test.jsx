/**
 * What the candidate list's cells show: the dossier's one name for each
 * stored status, the name with the phone number under it as the call button,
 * the Stale mark beside a name (at the start of the facts on a phone), the
 * freight read with the state, and the recruiter from the company's team after
 * their initials. An empty fact is a plain dash, which a phone card leaves out.
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

/** The cell's text without the initials disc, which a screen reader does not read. */
const readText = () => {
    const copy = screen.getByTestId('cell').cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove());
    return copy.textContent;
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

describe('the Driver column', () => {
    it('shows the name with the number under it; the number is the call button, named for the driver and the number', async () => {
        const handlePhoneClick = vi.fn();
        const item = { firstName: 'Maria', lastName: 'Garcia', phone: '5125550134' };
        cell('identity', item, { handlePhoneClick });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Maria Garcia\(512\) 555-0134$/);
        await userEvent.click(screen.getByRole('button', { name: 'Call Maria Garcia at (512) 555-0134' }));

        expect(handlePhoneClick).toHaveBeenCalledWith(expect.anything(), item);
    });

    it('shows the name alone, with nothing to press, for a driver with no number', () => {
        cell('identity', { firstName: 'Maria', lastName: 'Garcia' });

        expect(screen.queryByRole('button')).not.toBeInTheDocument();
        expect(screen.getByTestId('cell')).toHaveTextContent(/^Maria Garcia$/);
    });

    it('marks a first attempt more than 48 hours old as Stale, beside the name in the table only', () => {
        const longAgo = { seconds: Math.floor(Date.now() / 1000) - 80 * 3600 };
        cell('identity', { firstName: 'Omar', lastName: 'Attempt', status: 'Contact Attempt 1', statusEnteredAt: longAgo });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Omar AttemptStale$/);
        // A phone's card shows it at the start of the facts line instead (below).
        expect(screen.getByText('Stale').closest('.max-md\\:hidden')).not.toBeNull();
    });

    it('sets the number in the body size, as the name above it', () => {
        cell('identity', { firstName: 'Maria', lastName: 'Garcia', phone: '5125550134' });

        expect(screen.getByRole('button', { name: /^Call Maria Garcia/ })).toHaveAttribute('data-size', 'md');
    });
});

describe('the initials column', () => {
    it("draws the driver's initials, hidden from a screen reader, which reads the name beside them", () => {
        cell('initials', { firstName: 'maria', lastName: 'garcia' });

        const disc = screen.getByTestId('cell').firstChild;
        expect(disc).toHaveTextContent(/^MG$/);
        expect(disc).toHaveAttribute('aria-hidden', 'true');
    });

    it('draws an empty ring for a record with no name', () => {
        cell('initials', {});

        expect(screen.getByTestId('cell').firstChild).toHaveAttribute('data-tone', 'placeholder');
        expect(screen.getByTestId('cell')).toHaveTextContent(/^$/);
    });
});

describe('the Freight · State column', () => {
    it.each([
        [{ driverType: ['Reefer'], state: 'Illinois' }, 'Reefer · IL'],
        [{ driverType: ['Dry Van', 'Reefer'], state: 'TX' }, 'Dry Van, Reefer · TX'],
        [{ driverType: 'Flatbed' }, 'Flatbed'],
        [{ state: 'Ontario' }, 'Ontario'],
    ])('shows %o as %j', (item, shown) => {
        cell('freightState', item);

        expect(screen.getByTestId('cell')).toHaveTextContent(new RegExp(`^${shown}$`));
    });

    it('shows a plain dash for neither', () => {
        cell('freightState', {});

        expect(screen.getByTestId('cell').innerHTML).toBe('—');
    });

    describe("on a stale lead, whose mark leads a phone card's facts line", () => {
        const stale = { status: 'Contact Attempt 1', statusEnteredAt: { seconds: Math.floor(Date.now() / 1000) - 80 * 3600 } };

        it('puts the Stale mark, for phones only, before the freight and state', () => {
            cell('freightState', { ...stale, driverType: ['Reefer'], state: 'Illinois' }, { scope: 'company_leads' });

            expect(screen.getByTestId('cell')).toHaveTextContent(/^StaleReefer · IL$/);
            expect(screen.getByText('Stale').closest('.md\\:hidden')).not.toBeNull();
        });

        it('keeps the dash for the table only when there is neither, so the card still shows the mark', () => {
            cell('freightState', stale, { scope: 'company_leads' });

            expect(screen.getByTestId('cell')).toHaveTextContent(/^Stale—$/);
            expect(screen.getByText('—')).toHaveClass('max-md:hidden');
        });

        it('adds nothing for a lead that is not stale', () => {
            cell('freightState', { status: 'Contact Attempt 1', driverType: 'Reefer' }, { scope: 'company_leads' });

            expect(screen.getByTestId('cell').innerHTML).toBe('Reefer');
        });
    });
});

describe('the Last call column', () => {
    it('shows the outcome without "Connected / "', () => {
        cell('lastCall', { lastCallOutcome: 'Connected / Not Interested' });

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Not Interested$/);
    });

    it('shows a plain dash for no call', () => {
        cell('lastCall', {});

        expect(screen.getByTestId('cell').innerHTML).toBe('—');
    });
});

describe('the Assigned to column', () => {
    it("shows the assignee's name from the company's team, after their initials", () => {
        cell('assignee', { assignedTo: 'recruiter-1' });

        expect(readText()).toBe('Rae Recruiter');
        expect(screen.getByTestId('cell').querySelector('[aria-hidden="true"]')).toHaveTextContent(/^RR$/);
    });

    it('shows the stored name of an assignee the team no longer lists', () => {
        cell('assignee', { assignedTo: 'recruiter-9', assignedToName: 'Ann Baker' });

        expect(readText()).toBe('Ann Baker');
    });

    it('shows a plain dash, not "Unassigned", for an assignee nobody can name', () => {
        cell('assignee', { assignedTo: 'recruiter-9' });

        expect(screen.getByTestId('cell').innerHTML).toBe('—');
    });

    // A name left on an unassigned record is a leftover: unassigning in the
    // dossier once stored "Unassigned" as the name.
    it.each([
        { assignedTo: '', assignedToName: 'Unassigned' },
        { assignedTo: null, assignedToName: 'Ann Baker' },
        { assignedTo: '', assignedToName: '' },
    ])('shows Unassigned after an empty ring for %o', (item) => {
        cell('assignee', item);

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Unassigned$/);
        expect(screen.getByTestId('cell').querySelector('[data-tone="placeholder"]')).toBeInTheDocument();
    });
});
