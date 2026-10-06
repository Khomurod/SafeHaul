import React, { useEffect, useId, useRef, useState } from 'react';
import { daysInMonth, parseIsoDateParts } from '@shared/utils/dateFormHelpers';
import { FieldMessage, Input } from '@/design-system/components';

const PARTS = Object.freeze([
    { key: 'month', name: 'Month', placeholder: 'MM', length: 2 },
    { key: 'day', name: 'Day', placeholder: 'DD', length: 2 },
    { key: 'year', name: 'Year', placeholder: 'YYYY', length: 4 },
]);

const emptyParts = () => ({ month: '', day: '', year: '' });

function partsOf(value) {
    const parsed = parseIsoDateParts(value);
    return parsed
        ? { month: String(parsed.month), day: String(parsed.day), year: String(parsed.year) }
        : emptyParts();
}

function todayIso() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * What is wrong with the typed parts, as `{ part, message }`, or null when they
 * are empty or make a real date. `part` is the box the browser points at when
 * the step's `checkValidity()` gate refuses the page.
 */
function typedDateProblem(parts, { minYear = 1900, maxToday = false } = {}) {
    const filled = PARTS.filter(({ key }) => parts[key] !== '');
    if (filled.length === 0) return null;
    if (filled.length < PARTS.length) {
        const missing = PARTS.find(({ key }) => parts[key] === '');
        return { part: missing.key, message: 'Enter the month, day and year.' };
    }
    const month = Number(parts.month);
    const day = Number(parts.day);
    const year = Number(parts.year);
    if (month < 1 || month > 12) return { part: 'month', message: 'Enter a month from 1 to 12.' };
    if (parts.year.length !== 4 || year < minYear) {
        return { part: 'year', message: `Enter a four-digit year from ${minYear}.` };
    }
    if (day < 1 || day > daysInMonth(year, month)) {
        return { part: 'day', message: 'Enter a day that exists in that month.' };
    }
    if (maxToday && isoOf(parts) > todayIso()) return { part: 'year', message: 'The date cannot be in the future.' };
    return null;
}

function isoOf(parts) {
    return `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;
}

/**
 * A date typed as numbers — Month, Day and Year boxes that open the number pad —
 * stored as `YYYY-MM-DD` once the three make a real date: the value
 * `DateTripletField` stores, so nothing that reads the answer changes. For a date
 * the applicant knows by heart, such as their own date of birth, typing six or
 * eight digits beats scrolling a list of a hundred years on a phone.
 *
 * Until the parts make a real date the parent holds `''`, and the box at fault
 * carries a custom validity message, so the step's `form.checkValidity()` gate
 * holds the page instead of letting a half-typed date through as blank. A
 * complete but impossible date also says what is wrong under the field.
 *
 * Frozen like `DateTripletField`'s: the `${idPrefix}-month|day|year` element
 * ids, and `autoComplete="bday"` giving `bday-month`, `bday-day`, `bday-year`.
 */
export default function TypedDateField({
    label,
    idPrefix,
    name,
    value,
    onChange,
    required = false,
    helpText,
    minYear = 1900,
    maxToday = false,
    autoComplete,
}) {
    const rawId = useId().replace(/:/g, '');
    const groupLabelId = `${idPrefix}-group-label-${rawId}`;
    const helpTextId = `${idPrefix}-help-${rawId}`;
    const errorId = `${idPrefix}-error-${rawId}`;

    const [parts, setParts] = useState(() => partsOf(value));
    const emitted = useRef(value || '');
    const inputs = useRef({});

    // Follow the parent only when it changes the value itself (a restored
    // draft, a reset): echoing our own emission back would wipe a half-typed date.
    useEffect(() => {
        const next = value || '';
        if (next === emitted.current) return;
        emitted.current = next;
        setParts(partsOf(next));
    }, [value]);

    const problem = typedDateProblem(parts, { minYear, maxToday });
    const complete = PARTS.every(({ key }) => parts[key] !== '');

    useEffect(() => {
        for (const { key } of PARTS) {
            inputs.current[key]?.setCustomValidity(problem?.part === key ? problem.message : '');
        }
    }, [problem?.part, problem?.message]);

    const onPartChange = (key, length) => (event) => {
        const next = { ...parts, [key]: event.target.value.replace(/\D/g, '').slice(0, length) };
        setParts(next);
        const iso = PARTS.every((part) => next[part.key] !== '') && !typedDateProblem(next, { minYear, maxToday })
            ? isoOf(next)
            : '';
        if (iso !== emitted.current) {
            emitted.current = iso;
            onChange(name, iso);
        }
    };

    const showError = complete && problem;
    const describedBy = [helpText ? helpTextId : null, showError ? errorId : null].filter(Boolean).join(' ') || undefined;

    return (
        <div className="flex flex-col gap-ds-1">
            {label ? (
                <span id={groupLabelId} className="mb-ds-1 block text-ds-sm font-medium text-ds-content">
                    {label}
                    {required && (
                        <>
                            {' '}
                            <span aria-hidden="true" className="text-ds-status-danger-fg">*</span>
                            <span className="ds-visually-hidden"> required</span>
                        </>
                    )}
                </span>
            ) : (
                required && <span id={groupLabelId} className="ds-visually-hidden">Required date</span>
            )}
            {helpText && <FieldMessage id={helpTextId} tone="help" className="mb-ds-1">{helpText}</FieldMessage>}
            <div
                role="group"
                aria-labelledby={label || required ? groupLabelId : undefined}
                aria-describedby={describedBy}
                className="grid grid-cols-3 gap-ds-2"
            >
                {PARTS.map(({ key, name: partName, placeholder, length }) => (
                    <div key={key} className="min-w-0">
                        <label htmlFor={`${idPrefix}-${key}`} className="mb-ds-1 block text-ds-xs text-ds-content-secondary">
                            {label && <span className="ds-visually-hidden">{label} </span>}
                            {partName}
                        </label>
                        <Input
                            ref={(element) => { inputs.current[key] = element; }}
                            id={`${idPrefix}-${key}`}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={length}
                            placeholder={placeholder}
                            autoComplete={autoComplete ? `${autoComplete}-${key}` : 'off'}
                            value={parts[key]}
                            onChange={onPartChange(key, length)}
                            required={required}
                            aria-invalid={showError && problem.part === key ? true : undefined}
                        />
                    </div>
                ))}
            </div>
            {showError && <FieldMessage id={errorId} tone="error">{problem.message}</FieldMessage>}
        </div>
    );
}
