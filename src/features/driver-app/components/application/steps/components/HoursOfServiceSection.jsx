import React, { useEffect, useMemo } from 'react';
import DateTripletField from '@shared/components/form/DateTripletField';
import { FormField, FormSection, Input } from '@/design-system/components';
import { toIsoDay } from '@/config/applicationDates';
import TimeSelectField from './TimeSelectField';

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
 *
 * 2026-10-09 — nothing here opens a phone's own picker. The time was an
 * `<input type="time">`, which on a phone can be set only through the phone's
 * dialog; a driver whose dialog showed Clear and Cancel without Set could not
 * finish. It is three lists now (`TimeSelectField`), storing the same `HH:MM`.
 * The hours were a number box stepping by half hours, so a log's 7.25 was
 * refused and a decimal comma read as nothing; they are typed text now, a comma
 * read as a point and ".5" as 0.5, held to the rule's own "0 to 24, two
 * decimals" by `HOURS_PATTERN`.
 */

/** The rule's hours (`isCompleteHoursOfService`): 0 to 24, at most two decimals. */
const HOURS_PATTERN = '(?:[01]?\\d|2[0-3])(?:\\.\\d{1,2})?|24(?:\\.0{1,2})?';
const HOURS_FORMAT = new RegExp(`^(?:${HOURS_PATTERN})$`);

/** What a driver types for a day's hours, as the number the rule reads. */
function normalizeHours(raw) {
    const text = String(raw ?? '').replace(/,/g, '.').replace(/[^\d.]/g, '');
    const dot = text.indexOf('.');
    const single = dot === -1 ? text : text.slice(0, dot + 1) + text.slice(dot + 1).replace(/\./g, '');
    return single.startsWith('.') ? `0${single}` : single;
}

/**
 * The message for a day's hours, or none. "7." is "7.5" half typed, so it is not
 * flagged; leaving the box drops the bare point.
 */
function hoursProblem(hours) {
    const text = String(hours ?? '');
    if (!text || HOURS_FORMAT.test(text.replace(/\.$/, ''))) return undefined;
    return 'Enter hours from 0 to 24, for example 7.5.';
}

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
            <div className="grid grid-cols-1 items-start gap-ds-3 sm:grid-cols-2" data-testid="hos-daily-hours">
                {days.map((date, index) => {
                    const row = rows.find((entry) => entry?.date === date);
                    return (
                        <FormField
                            key={date}
                            id={`hos-day-${index + 1}`}
                            label={`${formatDay(date)} — hours on duty`}
                            required
                            error={hoursProblem(row?.hours)}
                        >
                            <Input
                                type="text"
                                inputMode="decimal"
                                autoComplete="off"
                                maxLength={5}
                                pattern={HOURS_PATTERN}
                                value={row?.hours ?? ''}
                                onChange={(e) => setHours(date, normalizeHours(e.target.value))}
                                onBlur={(e) => { if (e.target.value.endsWith('.')) setHours(date, e.target.value.slice(0, -1)); }}
                            />
                        </FormField>
                    );
                })}
            </div>
            <div className="grid grid-cols-1 items-start gap-ds-4 sm:grid-cols-2">
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
                <TimeSelectField
                    label="Last relieved from duty — time"
                    idPrefix="hos-last-relieved-time"
                    name="hosLastRelievedTime"
                    value={formData.hosLastRelievedTime || ''}
                    onChange={updateFormData}
                    required
                />
            </div>
            <p className="text-ds-xs text-ds-content-muted">
                By continuing you certify that the hours above are true and correct.
            </p>
        </FormSection>
    );
}

export default HoursOfServiceSection;
