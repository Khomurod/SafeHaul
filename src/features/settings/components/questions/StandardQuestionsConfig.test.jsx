import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { StandardQuestionsConfig, STANDARD_FIELDS } from './StandardQuestionsConfig';
import { resolveApplicationGate } from '@/config/applicationGates';

// Controlled harness so exclusivity transitions can be observed across clicks.
function Harness({ initialConfig = {}, onChangeSpy }) {
    const [config, setConfig] = useState(initialConfig);
    return (
        <StandardQuestionsConfig
            config={config}
            onChange={(next) => {
                onChangeSpy?.(next);
                setConfig(next);
            }}
        />
    );
}

describe('StandardQuestionsConfig', () => {
    it('exposes the exact standard field ids and labels', () => {
        // Defaults deliberately live in `applicationGates`, not here, so this
        // screen cannot describe a configuration the application does not apply.
        expect(STANDARD_FIELDS).toEqual([
            { id: 'ssn', label: 'Social Security Number' },
            { id: 'dob', label: 'Date of Birth' },
            { id: 'addressHistory', label: '3 Years Address History' },
            { id: 'employmentHistory', label: 'Employment History (3-10 Yrs)' },
            { id: 'cdlUpload', label: 'CDL Document Upload' },
            { id: 'medCardUpload', label: 'Medical Card Upload' },
            { id: 'mvrConsent', label: 'MVR Consent Form' },
            { id: 'referralSource', label: 'Referral Source' },
            { id: 'emergencyContacts', label: 'Emergency Contacts' },
        ]);
    });

    it('renders the same defaults the application actually enforces', () => {
        render(<StandardQuestionsConfig config={{}} onChange={vi.fn()} />);
        for (const field of STANDARD_FIELDS) {
            const gate = resolveApplicationGate({}, field.id);
            expect(
                screen.getByRole('switch', { name: `Require ${field.label}` }),
                `Require ${field.label}`,
            ).toHaveAttribute('aria-checked', String(gate.required));
            expect(
                screen.getByRole('switch', { name: `Hide ${field.label}` }),
                `Hide ${field.label}`,
            ).toHaveAttribute('aria-checked', String(gate.hidden));
        }
        // Spot-check the two the screen used to get backwards.
        expect(screen.getByRole('switch', { name: 'Require Medical Card Upload' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: 'Require MVR Consent Form' }))
            .toHaveAttribute('aria-checked', 'false');
        // Emergency contacts stay opt-in.
        expect(screen.getByRole('switch', { name: 'Hide Emergency Contacts' }))
            .toHaveAttribute('aria-checked', 'true');
    });

    it('reads a legacy showEmergencyContacts boolean as the emergency-contacts gate', () => {
        render(<StandardQuestionsConfig config={{ showEmergencyContacts: true }} onChange={vi.fn()} />);
        expect(screen.getByRole('switch', { name: 'Hide Emergency Contacts' }))
            .toHaveAttribute('aria-checked', 'false');
    });

    it('gives every control a unique required/hide accessible name', () => {
        render(<StandardQuestionsConfig config={{}} onChange={vi.fn()} />);
        STANDARD_FIELDS.forEach((f) => {
            expect(screen.getByRole('switch', { name: `Require ${f.label}` })).toBeInTheDocument();
            expect(screen.getByRole('switch', { name: `Hide ${f.label}` })).toBeInTheDocument();
        });
    });

    it('making a field hidden clears its required flag (exclusivity)', () => {
        const onChangeSpy = vi.fn();
        render(<Harness onChangeSpy={onChangeSpy} />);
        // ssn starts required (default). Hiding it must set required:false, hidden:true.
        fireEvent.click(screen.getByRole('switch', { name: 'Hide Social Security Number' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({ ssn: { required: false, hidden: true } }),
        );
        expect(screen.getByRole('switch', { name: 'Require Social Security Number' }))
            .toHaveAttribute('aria-checked', 'false');
    });

    it('making a hidden field required clears its hidden flag (exclusivity)', () => {
        const onChangeSpy = vi.fn();
        render(
            <Harness
                initialConfig={{ medCardUpload: { required: false, hidden: true } }}
                onChangeSpy={onChangeSpy}
            />,
        );
        fireEvent.click(screen.getByRole('switch', { name: 'Require Medical Card Upload' }));
        expect(onChangeSpy).toHaveBeenLastCalledWith(
            expect.objectContaining({ medCardUpload: { required: true, hidden: false } }),
        );
        expect(screen.getByRole('switch', { name: 'Hide Medical Card Upload' }))
            .toHaveAttribute('aria-checked', 'false');
    });

    it('emits the exact config payload preserving other fields', () => {
        const onChange = vi.fn();
        render(
            <StandardQuestionsConfig
                config={{ dob: { required: true, hidden: false } }}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByRole('switch', { name: 'Hide Referral Source' }));
        expect(onChange).toHaveBeenCalledWith({
            dob: { required: true, hidden: false },
            referralSource: { required: false, hidden: true },
        });
    });

    it('keeps the compliance note', () => {
        render(<StandardQuestionsConfig config={{}} onChange={vi.fn()} />);
        expect(screen.getByText(/may make your application non-compliant/i)).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<StandardQuestionsConfig config={{}} onChange={vi.fn()} />);
        expect((await axe(container)).violations).toEqual([]);
    });
});
