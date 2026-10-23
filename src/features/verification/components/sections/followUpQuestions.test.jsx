/**
 * The portal's optional follow-up questions appear after the answer they
 * follow: a rehire "No" offers an explanation, a return-to-duty "Yes" or
 * "In Progress" asks for the follow-up testing plan, and "Yes" to other,
 * non-DOT-recordable accidents asks for their details.
 */
import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { EmploymentSection } from './EmploymentSection';
import { SafetySection } from './SafetySection';

const SERVER_LIMIT = '2000';

function Harness({ Section, initial }) {
    const [formData, setFormData] = useState(initial);
    const updateField = (field, value) => setFormData((prev) => ({ ...prev, [field]: value }));
    return <Section formData={formData} formErrors={{}} updateField={updateField} />;
}

describe('verification portal follow-up questions', () => {
    it('offers an optional explanation only after a rehire "No"', () => {
        render(<Harness Section={EmploymentSection} initial={{ wasEmployed: true, eligibleForRehire: null, rehireExplanation: '' }} />);
        expect(screen.queryByLabelText(/Please explain/)).toBeNull();
        const rehire = within(screen.getByRole('group', { name: /Eligible for Rehire/ }));

        fireEvent.click(rehire.getByRole('radio', { name: 'No' }));
        const box = screen.getByLabelText(/Please explain \(optional\)/);
        expect(box).not.toBeRequired();
        expect(box).toHaveAttribute('maxLength', SERVER_LIMIT);

        fireEvent.click(rehire.getByRole('radio', { name: 'Yes' }));
        expect(screen.queryByLabelText(/Please explain/)).toBeNull();
    });

    it('asks for the follow-up testing plan after return-to-duty "Yes" or "In Progress", not "No"', () => {
        render(
            <Harness
                Section={SafetySection}
                initial={{ subjectToDotTesting: true, hadDrugAlcoholViolations: true, completedReturnToDuty: '', followUpTestingPlan: '' }}
            />,
        );
        const returnToDuty = within(screen.getByRole('group', { name: /return-to-duty process/ }));
        const pick = (label) => fireEvent.click(returnToDuty.getByRole('radio', { name: label }));

        expect(screen.queryByLabelText(/Follow-up testing plan/)).toBeNull();
        pick('Yes');
        expect(screen.getByLabelText(/Follow-up testing plan/)).toHaveAttribute('maxLength', SERVER_LIMIT);
        pick('No');
        expect(screen.queryByLabelText(/Follow-up testing plan/)).toBeNull();
        pick('In Progress');
        expect(screen.getByLabelText(/Follow-up testing plan/)).toBeInTheDocument();
    });

    it('asks about other accidents as an optional question, with details after "Yes"', () => {
        render(<Harness Section={SafetySection} initial={{ hadAccidents: false, hadNonRecordableAccidents: null, nonRecordableAccidentDetails: '' }} />);
        const group = screen.getByRole('group', { name: /not DOT-recordable/ });
        expect(group.textContent).not.toMatch(/required/);

        expect(screen.queryByLabelText(/Other Accident Details/)).toBeNull();
        fireEvent.click(within(group).getByRole('radio', { name: 'Yes' }));
        expect(screen.getByLabelText(/Other Accident Details/)).toHaveAttribute('maxLength', SERVER_LIMIT);
    });
});
