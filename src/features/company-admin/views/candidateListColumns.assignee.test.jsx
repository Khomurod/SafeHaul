/**
 * The candidate list's Recruiter column: the assignee's name while the record
 * has an assignee, else "Unassigned". A name left on an unassigned record is a
 * leftover: unassigning in the dossier once stored "Unassigned" as the name.
 *
 * All names below are artificial.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildCandidateColumns } from './candidateListColumns';

const recruiterCell = (item) => {
    const columns = buildCandidateColumns({ handlePhoneClick: vi.fn() });
    const column = columns.find((c) => c.key === 'assignee');
    return render(<div data-testid="cell">{column.render(item)}</div>);
};

describe('the Recruiter column', () => {
    it("shows the assignee's name", () => {
        recruiterCell({ assignedTo: 'recruiter-1', assignedToName: 'Ann Baker' });

        expect(screen.getByTestId('cell')).toHaveTextContent('AAnn Baker');
    });

    it.each([
        { assignedTo: '', assignedToName: 'Unassigned' },
        { assignedTo: null, assignedToName: 'Ann Baker' },
        { assignedTo: '', assignedToName: '' },
    ])('shows Unassigned for %o', (item) => {
        recruiterCell(item);

        expect(screen.getByTestId('cell')).toHaveTextContent(/^Unassigned$/);
    });
});
