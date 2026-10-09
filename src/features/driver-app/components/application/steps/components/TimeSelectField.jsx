import React, { useEffect, useId, useRef, useState } from 'react';
import { FieldMessage, Select } from '@/design-system/components';

const HOURS = Object.freeze([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
const MINUTES = Object.freeze(Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0')));
const PERIODS = Object.freeze(['AM', 'PM']);

const PART_KEYS = Object.freeze(['hour', 'minute', 'period']);
const HALF_CHOSEN = 'Choose the hour, minutes and AM or PM.';

const emptyParts = () => ({ hour: '', minute: '', period: '' });

/** `HH:MM` (24-hour) as the three lists show it; empty parts for anything else. */
function partsOf(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!match) return emptyParts();
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return emptyParts();
    return {
        hour: String(hours % 12 === 0 ? 12 : hours % 12),
        minute: match[2],
        period: hours < 12 ? 'AM' : 'PM',
    };
}

/** The `HH:MM` the three lists make, or `''` until all three are chosen. */
function valueOf(parts) {
    if (PART_KEYS.some((key) => !parts[key])) return '';
    const hour = Number(parts.hour) % 12 + (parts.period === 'PM' ? 12 : 0);
    return `${String(hour).padStart(2, '0')}:${parts.minute}`;
}

/**
 * A time chosen from three lists — hour, minutes, AM/PM — and stored as the
 * 24-hour `HH:MM` an `<input type="time">` stored, so nothing that reads the
 * answer changes.
 *
 * It replaces that input because on a phone the input opens the phone's own time
 * dialog, and the dialog is the only way to set it. A driver whose dialog showed
 * only Clear and Cancel (no Set) could not enter the time and could not finish
 * the application. Lists are what the date beside it already uses
 * (`DateTripletField`).
 *
 * Until all three are chosen the parent holds `''`. Every list is `required` when
 * the field is, and a time half chosen marks the lists still empty invalid even
 * when it is not, as the time input did for a half-typed time: the step's
 * `form.checkValidity()` gate then points at the list still empty instead of
 * dropping a half answer. The `${idPrefix}-hour|minute|period` element ids are
 * its contract.
 *
 * Private to the application wizard, like `TypedDateField`: the hours-of-service
 * statement and a company's own time questions ask with it.
 */
export default function TimeSelectField({
    label,
    idPrefix,
    name,
    value,
    onChange,
    required = false,
    helpText,
}) {
    const rawId = useId().replace(/:/g, '');
    const groupLabelId = `${idPrefix}-group-label-${rawId}`;
    const helpTextId = `${idPrefix}-help-${rawId}`;

    const [parts, setParts] = useState(() => partsOf(value));
    const emitted = useRef(value || '');
    const selects = useRef({});

    // Follow the parent only when it changes the value itself (a restored draft, a
    // reset): echoing our own emission back would wipe a half-chosen time.
    useEffect(() => {
        const next = value || '';
        if (next === emitted.current) return;
        emitted.current = next;
        setParts(partsOf(next));
    }, [value]);

    const chosen = PART_KEYS.filter((key) => parts[key]).length;
    const halfChosen = chosen > 0 && chosen < PART_KEYS.length;

    useEffect(() => {
        for (const key of PART_KEYS) {
            selects.current[key]?.setCustomValidity(halfChosen && !parts[key] ? HALF_CHOSEN : '');
        }
    }, [halfChosen, parts]);

    const onPartChange = (key) => (event) => {
        const next = { ...parts, [key]: event.target.value };
        setParts(next);
        const time = valueOf(next);
        if (time !== emitted.current) {
            emitted.current = time;
            onChange(name, time);
        }
    };

    const partLabel = (part) => (label ? `${label} ${part}` : part);
    const lists = [
        { key: 'hour', part: 'hour', placeholder: 'Hour', options: HOURS.map((hour) => ({ value: String(hour), text: String(hour) })) },
        { key: 'minute', part: 'minutes', placeholder: 'Min', options: MINUTES.map((minute) => ({ value: minute, text: minute })) },
        { key: 'period', part: 'AM or PM', placeholder: 'AM/PM', options: PERIODS.map((period) => ({ value: period, text: period })) },
    ];

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
                required && <span id={groupLabelId} className="ds-visually-hidden">Required time</span>
            )}
            {helpText && <FieldMessage id={helpTextId} tone="help" className="mb-ds-1">{helpText}</FieldMessage>}
            <div
                role="group"
                aria-labelledby={label || required ? groupLabelId : undefined}
                aria-describedby={helpText ? helpTextId : undefined}
                className="grid grid-cols-2 gap-ds-2 sm:grid-cols-3"
            >
                {/* On a phone AM/PM takes the line below, as a date's year does: in a
                    third of a phone's width "AM/PM" was cut to "AM/P". */}
                {lists.map(({ key, part, placeholder, options }) => (
                    <div key={key} className={key === 'period' ? 'col-span-2 min-w-0 sm:col-span-1' : 'min-w-0'}>
                        <label className="ds-visually-hidden" htmlFor={`${idPrefix}-${key}`}>{partLabel(part)}</label>
                        <Select
                            ref={(element) => { selects.current[key] = element; }}
                            id={`${idPrefix}-${key}`}
                            value={parts[key]}
                            onChange={onPartChange(key)}
                            required={required}
                        >
                            <option value="">{placeholder}</option>
                            {options.map((option) => (
                                <option key={option.value} value={option.value}>{option.text}</option>
                            ))}
                        </Select>
                    </div>
                ))}
            </div>
        </div>
    );
}
