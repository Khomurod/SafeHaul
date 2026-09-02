import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationRulesPanel } from './ApplicationRulesPanel';
import { APPLICATION_RULES_CATALOG, defaultApplicationRules, resolveApplicationRules } from '@/config/applicationRules';

describe('ApplicationRulesPanel', () => {
    it('renders one control per catalog rule, labelled in plain language', () => {
        render(<ApplicationRulesPanel rules={{}} onChange={vi.fn()} />);
        for (const rule of APPLICATION_RULES_CATALOG.rules) {
            const row = document.querySelector(`[data-rule-id="${rule.id}"]`);
            expect(row, rule.id).not.toBeNull();
            expect(within(row).getByText(rule.label, { exact: false })).toBeInTheDocument();
        }
    });

    it('shows every rule on its platform default when the company has configured nothing', () => {
        render(<ApplicationRulesPanel rules={undefined} onChange={vi.fn()} />);
        expect(screen.getByRole('switch', { name: /Require previous addresses/ })).toHaveAttribute('aria-checked', 'false');
        // Both expiry rules and the employment rule use the enforcement scale; the
        // two expiry rules default to Allow, employment to Warn.
        expect(screen.getAllByRole('radio', { name: /Allow — accept the application as entered/, checked: true })).toHaveLength(2);
        expect(screen.getAllByRole('radio', { name: /Warn — tell the applicant/, checked: true })).toHaveLength(1);
        expect(screen.getByRole('checkbox', { name: 'Student / Recent Grad' })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: 'Other' })).not.toBeChecked();
        expect(screen.getByRole('spinbutton', { name: /Years of history/ })).toHaveValue(3);
        expect(screen.queryAllByText('Changed from the platform default')).toHaveLength(0);
    });

    it('hands back the whole resolved rules object with the one change applied', () => {
        const onChange = vi.fn();
        render(<ApplicationRulesPanel rules={{}} onChange={onChange} />);
        fireEvent.click(screen.getByRole('switch', { name: /Require previous addresses/ }));
        expect(onChange).toHaveBeenCalledWith({ ...defaultApplicationRules(), requirePreviousAddressUnderThreeYears: true });
    });

    it('hides an experience option by unticking it, and a hidden one comes back when ticked', () => {
        const onChange = vi.fn();
        const { rerender } = render(<ApplicationRulesPanel rules={{}} onChange={onChange} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Student / Recent Grad' }));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ experienceOptionsHidden: ['New'] }));

        rerender(<ApplicationRulesPanel rules={{ experienceOptionsHidden: ['New'] }} onChange={onChange} />);
        expect(screen.getByRole('checkbox', { name: 'Student / Recent Grad' })).not.toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Student / Recent Grad' }));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ experienceOptionsHidden: [] }));
    });

    it('lets a company pick an enforcement level and marks it as changed', () => {
        const onChange = vi.fn();
        const { rerender } = render(<ApplicationRulesPanel rules={{}} onChange={onChange} />);
        const cdlRow = document.querySelector('[data-rule-id="expiredCdl"]');
        fireEvent.click(within(cdlRow).getByRole('radio', { name: /Block/ }));
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ expiredCdl: 'block' }));

        rerender(<ApplicationRulesPanel rules={{ expiredCdl: 'block' }} onChange={onChange} />);
        expect(within(document.querySelector('[data-rule-id="expiredCdl"]')).getByText('Changed from the platform default')).toBeInTheDocument();
    });

    it('keeps the saved vehicle keys while renaming a category', () => {
        const onChange = vi.fn();
        render(<ApplicationRulesPanel rules={{}} onChange={onChange} />);
        const labelsRow = document.querySelector('[data-rule-id="vehicleExperienceLabels"]');
        fireEvent.change(within(labelsRow).getByRole('textbox', { name: 'Straight Truck' }), { target: { value: 'Box Truck' } });
        const next = onChange.mock.calls.at(-1)[0];
        expect(next.vehicleExperienceLabels).toEqual({ straightTruck: 'Box Truck' });
        expect(resolveApplicationRules(next).vehicleExperienceLabels).toEqual({ straightTruck: 'Box Truck' });
    });

    it('clamps the minimum years to the catalog range', () => {
        const onChange = vi.fn();
        render(<ApplicationRulesPanel rules={{}} onChange={onChange} />);
        fireEvent.change(screen.getByRole('spinbutton', { name: /Years of history/ }), { target: { value: '25' } });
        expect(resolveApplicationRules(onChange.mock.calls.at(-1)[0]).employmentHistoryMinimumYears).toBe(10);
    });

    it('is read-only for users who may look but not change', () => {
        render(<ApplicationRulesPanel rules={{}} onChange={vi.fn()} readOnly />);
        expect(screen.getByRole('switch', { name: /Require previous addresses/ })).toBeDisabled();
        expect(screen.getByRole('checkbox', { name: 'Student / Recent Grad' })).toBeDisabled();
    });

    it('has no serious accessibility violations', async () => {
        const { container } = render(<ApplicationRulesPanel rules={{}} onChange={vi.fn()} />);
        const results = await axe(container);
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    });
});
