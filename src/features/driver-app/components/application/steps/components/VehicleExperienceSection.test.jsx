// "Experience by Vehicle Type" lets a driver without that experience say so.
//
// Every list offered only amounts (miles, years), so a driver who had never
// driven a straight truck left it on "Select…", and the review, the record and
// the PDF printed "Not provided" — the same as a driver who skipped the
// question. "None" is now the first choice in every list, and one box answers
// every shown list with it.

import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import VehicleExperienceSection from './VehicleExperienceSection';
import { visibleVehicleCategories } from '@/config/applicationRules';
import { EXPERIENCE_OPTIONS, MILES_DRIVEN_OPTIONS, NO_EXPERIENCE } from '@/config/form-options';

let latest = {};

function Harness({ initial = {}, rules }) {
    const [formData, setFormData] = useState(initial);
    latest = formData;
    const updateFormData = (name, value) => setFormData((prev) => ({ ...prev, [name]: value }));
    return (
        <VehicleExperienceSection
            formData={formData}
            updateFormData={updateFormData}
            milesOptions={MILES_DRIVEN_OPTIONS}
            expOptions={EXPERIENCE_OPTIONS}
            categories={visibleVehicleCategories(rules)}
        />
    );
}

const noneBox = () => screen.getByRole('checkbox', { name: /None — I have not driven/ });
const selects = () => screen.getAllByRole('combobox');
const shownFields = (rules) => visibleVehicleCategories(rules).flatMap((c) => [c.milesField, c.expField]);

describe('VehicleExperienceSection — "None"', () => {
    it('offers "None" first in every list, after the placeholder', () => {
        render(<Harness />);
        for (const select of selects()) {
            const options = within(select).getAllByRole('option').map((option) => option.textContent);
            expect(options.slice(0, 2)).toEqual(['Select…', 'None']);
        }
    });

    it('answers every shown list with "None" when the box is ticked, and only those', () => {
        render(<Harness />);
        fireEvent.click(noneBox());
        expect(noneBox()).toBeChecked();
        for (const field of shownFields()) expect(latest[field]).toBe(NO_EXPERIENCE);
        // "Other" is hidden unless the company shows it; its answers are left alone.
        expect(latest.expOtherMiles).toBeUndefined();
        expect(latest.expOtherYears).toBeUndefined();
        for (const select of selects()) expect(select).toHaveValue(NO_EXPERIENCE);
    });

    it('unticks itself when a real amount is chosen anywhere', () => {
        render(<Harness />);
        fireEvent.click(noneBox());
        const [firstMiles] = selects();
        fireEvent.change(firstMiles, { target: { value: '25k-50k' } });
        expect(noneBox()).not.toBeChecked();
        expect(latest[shownFields()[0]]).toBe('25k-50k');
        expect(latest[shownFields()[1]]).toBe(NO_EXPERIENCE);
    });

    it('clears every shown list when the box is unticked', () => {
        render(<Harness />);
        fireEvent.click(noneBox());
        fireEvent.click(noneBox());
        for (const field of shownFields()) expect(latest[field]).toBe('');
    });

    it('is ticked for a saved application that answered "None" everywhere, and not for a partial one', () => {
        const all = Object.fromEntries(shownFields().map((field) => [field, NO_EXPERIENCE]));
        const { unmount } = render(<Harness initial={all} />);
        expect(noneBox()).toBeChecked();
        unmount();
        render(<Harness initial={{ ...all, [shownFields()[0]]: '' }} />);
        expect(noneBox()).not.toBeChecked();
    });

    it('lets one type be "None" while another has an amount', () => {
        render(<Harness />);
        const [firstMiles, firstYears, secondMiles] = selects();
        fireEvent.change(firstMiles, { target: { value: NO_EXPERIENCE } });
        fireEvent.change(firstYears, { target: { value: NO_EXPERIENCE } });
        fireEvent.change(secondMiles, { target: { value: '100k+' } });
        expect(latest[shownFields()[0]]).toBe(NO_EXPERIENCE);
        expect(latest[shownFields()[2]]).toBe('100k+');
        expect(noneBox()).not.toBeChecked();
    });
});
