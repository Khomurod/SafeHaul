import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    buildIsoDate,
    daysInMonth,
    formatMonthYearIso,
    parseIsoDateParts,
    parseMonthYear,
} from '@shared/utils/dateFormHelpers';
import { FieldMessage, Select } from '@/design-system/components';

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const emptyParts = () => ({ year: '', month: '', day: '' });

/**
 * What differs between a full date (`DateTripletField`, stored YYYY-MM-DD) and
 * a month (`MonthYearField`, stored YYYY-MM): how a stored value reads back,
 * the default year range, the hidden group name when there is no label, and
 * the layout. A full date's year takes a row of its own on a phone. Below
 * `sm` a month's two selects are never narrower than a four-digit year needs
 * (7rem): they share a row while the space allows and wrap when it does not,
 * as in a list row on a 360 px phone, where side by side the year read "202".
 */
const PRECISION = {
    day: {
        read: (value) => parseIsoDateParts(value),
        minYear: 1920,
        yearsAhead: 15,
        hiddenName: 'Required date',
        grid: 'grid grid-cols-2 gap-ds-2 sm:grid-cols-3',
    },
    month: {
        read: (value) => {
            const { year, month } = parseMonthYear(value);
            return year && month ? { year, month, day: '' } : null;
        },
        minYear: 1970,
        yearsAhead: 10,
        hiddenName: 'Required month and year',
        grid: 'grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-ds-2 sm:grid-cols-2',
    },
};

/**
 * Month (/ day) / year dropdowns: the date parts the driver application and the
 * company's application editor ask for. The parent gets the stored value only
 * once every part is chosen; until then the choices stay here, so they can be
 * made in any order, and a complete value walked back to incomplete clears the
 * parent. `maxToday` keeps the value from passing today.
 *
 * The `${idPrefix}-month|day|year` element ids are a frozen contract
 * (`e2e/public-application.spec.cjs` selects them), and so is `${idPrefix}-error`.
 * The selects are grouped so assistive technology hears the field name once and
 * each control's name is composed from it ("Date of Birth month"). `error`
 * marks the selects invalid and says why under them. `autoComplete="bday"`
 * gives `bday-month`, `bday-day` and `bday-year`, for the applicant's own date
 * of birth only.
 */
export default function DateSelectField({
    precision,
    label,
    idPrefix,
    name,
    value,
    onChange,
    required = false,
    helpText,
    minYear,
    maxYear,
    maxToday = false,
    autoComplete,
    error,
}) {
    const spec = PRECISION[precision];
    const withDay = precision === 'day';
    const rawId = useId().replace(/:/g, '');
    const groupLabelId = `${idPrefix}-group-label-${rawId}`;
    const helpTextId = `${idPrefix}-help-${rawId}`;
    const errorId = error ? `${idPrefix}-error` : undefined;
    const describedBy = [helpText ? helpTextId : null, errorId].filter(Boolean).join(' ') || undefined;

    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const td = today.getDate();
    const capIso = `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;

    const firstYear = minYear ?? spec.minYear;
    const lastYear = maxYear ?? (maxToday ? ty : ty + spec.yearsAhead);

    const [p, setParts] = useState(() => spec.read(value) || emptyParts());
    const prevValueRef = useRef(value);

    useEffect(() => {
        const parsed = spec.read(value);
        if (parsed) {
            setParts(parsed);
        } else if (!value && spec.read(prevValueRef.current)) {
            // The parent dropped a complete value (reset / clear): clear the UI.
            setParts(emptyParts());
        }
        prevValueRef.current = value;
    }, [value, spec]);

    const yearOptions = useMemo(() => {
        const ys = [];
        for (let y = lastYear; y >= firstYear; y--) ys.push(y);
        return ys;
    }, [lastYear, firstYear]);

    const maxMonthThisYear = maxToday ? tm : 12;

    const clampDay = (y, m, d) => {
        if (!y || !m || !d) return d;
        let next = Math.min(d, daysInMonth(y, m));
        if (maxToday && y === ty && m === tm) next = Math.min(next, td);
        return next;
    };

    const tryEmit = (next) => {
        const { year: y, month: m, day: d } = next;
        if (!y && !m && !d) {
            setParts(emptyParts());
            onChange(name, '');
            return;
        }
        if (!y || !m || (withDay && !d)) {
            setParts(next);
            // Keep the parent '' while a value is built from scratch; a complete
            // value walked back to incomplete clears it.
            if (spec.read(value)) onChange(name, '');
            return;
        }
        if (!withDay) {
            setParts({ year: y, month: m, day: '' });
            onChange(name, formatMonthYearIso(y, m));
            return;
        }
        let iso = buildIsoDate(y, m, d);
        if (maxToday && iso > capIso) iso = capIso;
        setParts(parseIsoDateParts(iso));
        onChange(name, iso);
    };

    const onYearChange = (e) => {
        const y = e.target.value ? Number(e.target.value) : '';
        if (!y) {
            tryEmit(emptyParts());
            return;
        }
        let m = p.month;
        let d = p.day;
        if (maxToday && y === ty && m && m > maxMonthThisYear) m = maxMonthThisYear;
        if (m && d) d = clampDay(y, m, d);
        tryEmit({ year: y, month: m || '', day: d || '' });
    };

    const onMonthChange = (e) => {
        const m = e.target.value ? Number(e.target.value) : '';
        if (!m) {
            tryEmit({ ...p, month: '', day: '' });
            return;
        }
        const y = p.year;
        if (!y) {
            // The day stays: without a year it cannot be checked against the
            // month, and the year's arrival clamps it (`onYearChange`).
            setParts({ ...p, month: m });
            return;
        }
        let mm = m;
        if (maxToday && y === ty && mm > maxMonthThisYear) mm = maxMonthThisYear;
        let d = p.day;
        if (d) d = clampDay(y, mm, d);
        tryEmit({ year: y, month: mm, day: d || '' });
    };

    const onDayChange = (e) => {
        const d = e.target.value ? Number(e.target.value) : '';
        if (!d) {
            tryEmit({ ...p, day: '' });
            return;
        }
        if (!p.year || !p.month) {
            setParts({ ...p, day: d });
            return;
        }
        tryEmit({ year: p.year, month: p.month, day: clampDay(p.year, p.month, d) });
    };

    const monthCount = maxToday && p.year === ty ? maxMonthThisYear : 12;
    let dayCount = 31;
    if (p.year && p.month) {
        dayCount = daysInMonth(p.year, p.month);
        if (maxToday && p.year === ty && p.month === tm) dayCount = Math.min(dayCount, td);
    }

    const partName = (part) => (label ? `${label} ${part}` : part);
    const partProps = (part, onPartChange, partValue) => ({
        id: `${idPrefix}-${part}`,
        autoComplete: autoComplete ? `${autoComplete}-${part}` : undefined,
        value: partValue === '' ? '' : String(partValue),
        onChange: onPartChange,
        required,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': errorId,
    });

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
                required && <span id={groupLabelId} className="ds-visually-hidden">{spec.hiddenName}</span>
            )}
            {helpText && <FieldMessage id={helpTextId} tone="help" className="mb-ds-1">{helpText}</FieldMessage>}
            <div
                role="group"
                aria-labelledby={label || required ? groupLabelId : undefined}
                aria-describedby={describedBy}
                className={spec.grid}
            >
                <div className="min-w-0">
                    <label className="ds-visually-hidden" htmlFor={`${idPrefix}-month`}>{partName('month')}</label>
                    <Select {...partProps('month', onMonthChange, p.month)}>
                        <option value="">Month</option>
                        {MONTH_NAMES.slice(0, monthCount).map((nm, i) => (
                            <option key={nm} value={i + 1}>
                                {nm}
                            </option>
                        ))}
                    </Select>
                </div>
                {withDay && (
                    <div className="min-w-0">
                        <label className="ds-visually-hidden" htmlFor={`${idPrefix}-day`}>{partName('day')}</label>
                        <Select {...partProps('day', onDayChange, p.day)}>
                            <option value="">Day</option>
                            {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>
                                    {d}
                                </option>
                            ))}
                        </Select>
                    </div>
                )}
                <div className={withDay ? 'col-span-2 min-w-0 sm:col-span-1' : 'min-w-0'}>
                    <label className="ds-visually-hidden" htmlFor={`${idPrefix}-year`}>{partName('year')}</label>
                    <Select {...partProps('year', onYearChange, p.year)}>
                        <option value="">Year</option>
                        {yearOptions.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            {error && <FieldMessage id={errorId} tone="error">{error}</FieldMessage>}
        </div>
    );
}
