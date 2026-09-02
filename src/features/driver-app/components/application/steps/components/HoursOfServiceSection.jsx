import React, { useEffect, useMemo } from 'react';
import DateTripletField from '@shared/components/form/DateTripletField';
import { FormField, FormSection, Input } from '@/design-system/components';
import { toIsoDay } from '@/config/applicationDates';

/**
 * Hours of Service statement (49 CFR 395.8(j)(2)): on-duty hours for each of
 * the seven days before the application, and when the applicant was last
 * relieved from duty.
 *
 * Optional per company: rendered only when the `hoursOfServiceStatement` rule is
 * `application`. The seven dates are fixed from today so the applicant fills in
 * hours, not dates; a row whose date has rolled off (a draft resumed days later)
 * is replaced and its hours dropped, because a statement about the wrong week is
 * worse than a blank one. Keys: `hosDailyHours` (rows of `{ date, hours }`),
 * `hosLastRelievedDate`, `hosLastRelievedTime`.
 */
function lastSevenDays(today = new Date()) {
    const base = new Date(today);
    return Array.from({ length: 7 }, (_, offset) => {
        const day = new Date(base);
        day.setDate(base.getDate() - (offset + 1));
        return toIsoDay(day);
    });
}

function formatDay(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function HoursOfServiceSection({ formData, updateFormData }) {
    const days = useMemo(() => lastSevenDays(), []);
    const storedRows = formData.hosDailyHours;
    const rows = useMemo(() => (Array.isArray(storedRows) ? storedRows : []), [storedRows]);

    useEffect(() => {
        const current = new Map(rows.map((row) => [row?.date, row?.hours]));
        const aligned = days.every((date, index) => rows[index]?.date === date);
        if (aligned && rows.length === days.length) return;
        updateFormData('hosDailyHours', days.map((date) => ({ date, hours: current.get(date) ?? '' })));
    }, [days, rows, updateFormData]);

    const setHours = (date, hours) => {
        updateFormData('hosDailyHours', (currentRows) => (Array.isArray(currentRows) ? currentRows : [])
            .map((row) => (row?.date === date ? { ...row, hours } : row)));
    };

    return (
        <FormSection
            title="Hours of Service Statement"
            description="Federal rules require a statement of your on-duty hours for the past 7 days and when you were last relieved from duty (49 CFR 395.8). Enter 0 for a day you did not work."
        >
            <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2" data-testid="hos-daily-hours">
                {days.map((date, index) => {
                    const row = rows.find((entry) => entry?.date === date);
                    return (
                        <FormField key={date} id={`hos-day-${index + 1}`} label={`${formatDay(date)} — hours on duty`} required>
                            <Input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                max="24"
                                step="0.5"
                                value={row?.hours ?? ''}
                                onChange={(e) => setHours(date, e.target.value)}
                            />
                        </FormField>
                    );
                })}
            </div>
            <div className="grid grid-cols-1 gap-ds-4 sm:grid-cols-2">
                <DateTripletField
                    label="Last relieved from duty — date"
                    idPrefix="hos-last-relieved-date"
                    name="hosLastRelievedDate"
                    value={formData.hosLastRelievedDate}
                    onChange={updateFormData}
                    required={true}
                    maxToday={true}
                    minYear={new Date().getFullYear() - 1}
                />
                <FormField id="hos-last-relieved-time" label="Last relieved from duty — time" required>
                    <Input
                        type="time"
                        value={formData.hosLastRelievedTime || ''}
                        onChange={(e) => updateFormData('hosLastRelievedTime', e.target.value)}
                    />
                </FormField>
            </div>
            <p className="text-ds-xs text-ds-content-muted">
                By continuing you certify that the hours above are true and correct.
            </p>
        </FormSection>
    );
}

export default HoursOfServiceSection;
