// The recruiter's employer editor and the dossier's current record read one
// field table, EMPLOYMENT_SECTION.itemFields. The two 49 CFR 391.21(b)(10)(iv)
// answers the Employment page collects have to be in it to be seen or corrected
// anywhere but the preserved record.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviousEmployersEditor } from './PreviousEmployersEditor';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';

vi.mock('@shared/hooks/useUtils', () => ({ useUtils: () => ({ states: ['TX'] }) }));

const ROW = { companyName: 'Artificial Freight Co', subjectToFmcsrs: 'yes', subjectToDotTesting: 'no' };
const FMCSRS = 'Subject to FMCSRs?';
const DOT_TESTING = 'Safety-Sensitive (DOT Drug & Alcohol Testing)?';

describe("an employer's (b)(10)(iv) answers outside the preserved record", () => {
    it('lets the recruiter see and correct them', () => {
        const onChange = vi.fn();
        render(<PreviousEmployersEditor employers={[ROW]} onChange={onChange} />);

        expect(within(screen.getByRole('group', { name: FMCSRS })).getByRole('radio', { name: 'Yes' })).toBeChecked();
        const testing = screen.getByRole('group', { name: DOT_TESTING });
        expect(within(testing).getByRole('radio', { name: 'No' })).toBeChecked();

        fireEvent.click(within(testing).getByRole('radio', { name: 'Yes' }));
        expect(onChange).toHaveBeenCalledWith([{ ...ROW, subjectToDotTesting: 'yes' }]);
    });

    it("shows them in the dossier's current record", () => {
        render(<SchemaSection sectionId="employmentHistory" data={{ employers: [ROW] }} mode="display" />);

        expect(screen.getByText(FMCSRS)).toBeInTheDocument();
        expect(screen.getByText(DOT_TESTING)).toBeInTheDocument();
    });
});
