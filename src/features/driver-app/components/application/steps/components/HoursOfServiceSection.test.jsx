// The Hours of Service statement on a phone: no control may need the phone's own
// picker, and what a driver types for hours must reach the rule as the number
// they meant. A driver whose time dialog showed Clear and Cancel without Set
// could not finish the application. All values are made up.
import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HoursOfServiceSection } from './HoursOfServiceSection';
import { evaluateApplicationRules } from '@/config/applicationRules';

let latest = {};

function Harness({ initial = {} }) {
    const [formData, setFormData] = useState(initial);
    latest = formData;
    const updateFormData = (name, value) => setFormData((prev) => ({
        ...prev,
        [name]: typeof value === 'function' ? value(prev[name]) : value,
    }));
    return (
        <form id="driver-form">
            <HoursOfServiceSection formData={formData} updateFormData={updateFormData} />
        </form>
    );
}

const dayBox = (n) => document.getElementById(`hos-day-${n}`);
const typeHours = (n, value) => fireEvent.change(dayBox(n), { target: { value } });
const statementIssue = () => evaluateApplicationRules({
    rules: { hoursOfServiceStatement: 'application' },
    formData: latest,
}).issues.find((issue) => issue.code === 'hours-of-service-required');

function answerEverything({ withTime = true } = {}) {
    for (let n = 1; n <= 7; n += 1) typeHours(n, '8');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fireEvent.change(document.getElementById('hos-last-relieved-date-year'), { target: { value: String(yesterday.getFullYear()) } });
    fireEvent.change(document.getElementById('hos-last-relieved-date-month'), { target: { value: String(yesterday.getMonth() + 1) } });
    fireEvent.change(document.getElementById('hos-last-relieved-date-day'), { target: { value: String(yesterday.getDate()) } });
    if (withTime) {
        fireEvent.change(document.getElementById('hos-last-relieved-time-hour'), { target: { value: '6' } });
        fireEvent.change(document.getElementById('hos-last-relieved-time-minute'), { target: { value: '30' } });
        fireEvent.change(document.getElementById('hos-last-relieved-time-period'), { target: { value: 'PM' } });
    }
}

describe('HoursOfServiceSection', () => {
    it('opens no picker of the phone’s own: no time, date or number input', () => {
        render(<Harness />);
        expect(document.querySelectorAll('input[type="time"], input[type="date"], input[type="number"]')).toHaveLength(0);
        expect(dayBox(1)).toHaveAttribute('inputmode', 'decimal');
    });

    it('takes the time from three lists and keeps it as HH:MM', () => {
        render(<Harness />);
        answerEverything();
        expect(latest.hosLastRelievedTime).toBe('18:30');
    });

    it('satisfies the statement rule once every answer is given through the page', () => {
        render(<Harness />);
        answerEverything();
        expect(statementIssue()).toBeUndefined();
        expect(document.getElementById('driver-form').checkValidity()).toBe(true);
    });

    it('still holds the page while the time is missing', () => {
        render(<Harness />);
        answerEverything({ withTime: false });
        expect(statementIssue()).toBeDefined();
        expect(document.getElementById('driver-form').checkValidity()).toBe(false);
    });

    it.each([
        ['7,5', '7.5'],
        ['.5', '0.5'],
        ['7.25', '7.25'],
        ['10.75', '10.75'],
        ['8 h', '8'],
        ['1.2.5', '1.25'],
    ])('reads hours typed as %s as %s', (typed, expected) => {
        render(<Harness />);
        typeHours(1, typed);
        expect(latest.hosDailyHours[0].hours).toBe(expected);
        expect(dayBox(1).checkValidity()).toBe(true);
    });

    it('says what is wrong with hours over 24, and holds the page on that box', () => {
        render(<Harness />);
        typeHours(2, '25');
        expect(screen.getByText('Enter hours from 0 to 24, for example 7.5.')).toBeInTheDocument();
        expect(dayBox(2)).toHaveAttribute('aria-invalid', 'true');
        expect(dayBox(2).checkValidity()).toBe(false);
    });

    it('does not flag "7." while "7.5" is being typed, and drops a bare point on leaving the box', () => {
        render(<Harness />);
        typeHours(4, '7.');
        expect(screen.queryByText('Enter hours from 0 to 24, for example 7.5.')).not.toBeInTheDocument();
        fireEvent.blur(dayBox(4));
        expect(latest.hosDailyHours[3].hours).toBe('7');
        expect(dayBox(4).checkValidity()).toBe(true);
    });

    it('accepts quarter hours the rule accepts, which the half-hour step refused', () => {
        render(<Harness />);
        answerEverything();
        typeHours(3, '7.25');
        expect(dayBox(3).checkValidity()).toBe(true);
        expect(statementIssue()).toBeUndefined();
    });
});

describe('a driver off duty all seven days', () => {
    const offDuty = () => document.getElementById('hos-not-on-duty');

    it('says so once: every day is 0, and a new driver can leave the last relief blank', () => {
        render(<Harness />);
        fireEvent.click(offDuty());

        expect(latest.hosNotOnDuty).toBe('yes');
        expect(latest.hosDailyHours.map((row) => row.hours)).toEqual(['0', '0', '0', '0', '0', '0', '0']);
        for (let n = 1; n <= 7; n += 1) expect(dayBox(n)).toBeDisabled();
        expect(screen.getByText('If you have never been on duty, leave the date and time blank.')).toBeInTheDocument();
        expect(statementIssue()).toBeUndefined();
        expect(document.getElementById('driver-form').checkValidity()).toBe(true);
    });

    it('gets the day boxes back when it is not so after all', () => {
        render(<Harness />);
        fireEvent.click(offDuty());
        fireEvent.click(offDuty());

        expect(latest.hosNotOnDuty).toBe('no');
        expect(dayBox(1)).toBeEnabled();
        // Hours of 0 without the off-duty answer still ask when the driver was last relieved.
        expect(statementIssue()).toBeDefined();
        expect(document.getElementById('driver-form').checkValidity()).toBe(false);
    });
});

describe('the last relief from duty', () => {
    it('can be years back, for a driver returning after a long break', () => {
        render(<Harness />);
        const years = [...document.getElementById('hos-last-relieved-date-year').options].map((option) => option.value);
        expect(years).toContain(String(new Date().getFullYear() - 10));
        expect(years).toContain(String(new Date().getFullYear() - 50));
    });
});
