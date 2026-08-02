import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { StandardQuestionsConfig, STANDARD_FIELDS } from './StandardQuestionsConfig';

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
    it('exposes the exact standard field ids, labels and default-required values', () => {
        expect(STANDARD_FIELDS).toEqual([
            { id: 'ssn', label: 'Social Security Number', defaultReq: true },
            { id: 'dob', label: 'Date of Birth', defaultReq: true },
            { id: 'addressHistory', label: '3 Years Address History', defaultReq: true },
            { id: 'employmentHistory', label: 'Employment History (3-10 Yrs)', defaultReq: true },
            { id: 'cdlUpload', label: 'CDL Document Upload', defaultReq: true },
            { id: 'medCardUpload', label: 'Medical Card Upload', defaultReq: false },
            { id: 'mvrConsent', label: 'MVR Consent Form', defaultReq: true },
            { id: 'referralSource', label: 'Referral Source', defaultReq: false },
        ]);
    });

    it('renders default-required state from defaults when no config is stored', () => {
        render(<StandardQuestionsConfig config={{}} onChange={vi.fn()} />);
        // ssn defaults required=true, hidden=false
        expect(screen.getByRole('switch', { name: 'Require Social Security Number' }))
            .toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('switch', { name: 'Hide Social Security Number' }))
            .toHaveAttribute('aria-checked', 'false');
        // medCardUpload defaults required=false
        expect(screen.getByRole('switch', { name: 'Require Medical Card Upload' }))
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
