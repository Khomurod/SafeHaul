/**
 * The portal's free-text answers stop where the server does.
 *
 * `submitVerificationResponse` refuses violation details, accident details and
 * additional comments over 2,000 characters. Without the same limit here the
 * employer could type more and only learn it on Submit.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SafetySection } from './SafetySection';
import { AdditionalInfoSection } from './AdditionalInfoSection';

const SERVER_LIMIT = 2000;

describe('verification portal text limits', () => {
    it('caps violation and accident details at the server limit', () => {
        render(
            <SafetySection
                formData={{
                    subjectToDotTesting: true,
                    hadDrugAlcoholViolations: true,
                    hadAccidents: true,
                    violationDetails: '',
                    accidentDetails: '',
                }}
                formErrors={{}}
                updateField={vi.fn()}
            />,
        );

        expect(screen.getByLabelText(/Violation Details/i)).toHaveAttribute('maxLength', String(SERVER_LIMIT));
        expect(screen.getByLabelText(/Accident Details/i)).toHaveAttribute('maxLength', String(SERVER_LIMIT));
    });

    it('caps additional comments at the server limit', () => {
        render(<AdditionalInfoSection formData={{ additionalComments: '' }} updateField={vi.fn()} />);

        expect(screen.getByLabelText(/Additional Comments/i)).toHaveAttribute('maxLength', String(SERVER_LIMIT));
    });
});
