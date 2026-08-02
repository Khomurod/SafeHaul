import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
    parseIsoDateParts,
    buildIsoDate,
    daysInMonth,
} from '@shared/utils/dateFormHelpers';
import { FieldMessage, Select } from '@/design-system/components';

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const emptyTriplet = () => ({ year: '', month: '', day: '' });

/**
 * Month / Day / Year dropdowns — stores YYYY-MM-DD in parent when complete.
 * Keeps partial selections locally so users can fill in any order.
 *
 * Presentation is migrated to the approved `Select`/`FieldMessage` primitives and
 * `--ds-*` tokens; every piece of date logic below (partial-selection handling,
 * day clamping, the `maxToday` cap, and exactly when the parent is emitted) is
 * unchanged, and the `${idPrefix}-month|day|year` element ids are a frozen
 * contract — `e2e/public-application.spec.cjs` selects them directly.
 *
 * The three selects are grouped so assistive technology hears the field name
 * once, and each control's own name is composed from it ("Date of Birth month")
 * instead of a bare "Month".
 */
export default function DateTripletField({
    label,
    idPrefix,
    name,
    value,
    onChange,
    required = false,
    helpText,
    minYear = 1920,
    maxYear,
    maxToday = false,
}) {
    const rawId = useId().replace(/:/g, '');
    const groupLabelId = `${idPrefix}-group-label-${rawId}`;
    const helpTextId = `${idPrefix}-help-${rawId}`;

    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;
    const td = today.getDate();
    const capIso = `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`;

    const computedMaxYear = maxYear ?? (maxToday ? ty : ty + 15);

    const parsedFromProp = parseIsoDateParts(value);

    const [inner, setInner] = useState(() =>
        parsedFromProp ? { year: parsedFromProp.year, month: parsedFromProp.month, day: parsedFromProp.day } : emptyTriplet()
    );

    const prevValueRef = useRef(value);

    useEffect(() => {
        const parsed = parseIsoDateParts(value);
        if (parsed) {
            setInner({ year: parsed.year, month: parsed.month, day: parsed.day });
        } else if (!value && parseIsoDateParts(prevValueRef.current)) {
            // Parent dropped a complete ISO (reset / clear) — clear UI.
            setInner(emptyTriplet());
        }
        prevValueRef.current = value;
    }, [value]);

    const p = inner;

    const yearOptions = useMemo(() => {
        const ys = [];
        for (let y = computedMaxYear; y >= minYear; y--) ys.push(y);
        return ys;
    }, [computedMaxYear, minYear]);

    const maxMonthThisYear = maxToday ? tm : 12;

    const clampDay = (y, m, d) => {
        if (!y || !m || !d) return d;
        let dim = daysInMonth(y, m);
        let next = Math.min(d, dim);
        if (maxToday && y === ty && m === tm) next = Math.min(next, td);
        return next;
    };

    const tryEmit = (next) => {
        const { year: y, month: m, day: d } = next;
        const allEmpty = !y && !m && !d;
        if (allEmpty) {
            setInner(emptyTriplet());
            onChange(name, '');
            return;
        }
        if (!y || !m || !d) {
            setInner(next);
            // Keep parent '' while user builds a date from scratch (value was already '').
            // If we had a complete ISO and user walks back to incomplete, clear parent.
            if (parseIsoDateParts(value)) onChange(name, '');
            return;
        }
        let iso = buildIsoDate(y, m, d);
        if (maxToday && iso > capIso) iso = capIso;
        const clamped = parseIsoDateParts(iso);
        setInner({ year: clamped.year, month: clamped.month, day: clamped.day });
        onChange(name, iso);
    };

    const onYearChange = (e) => {
        const y = e.target.value ? Number(e.target.value) : '';
        if (!y) {
            tryEmit(emptyTriplet());
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
            setInner({ ...p, month: m, day: '' });
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
        const y = p.year;
        const m = p.month;
        if (!y || !m) {
            setInner({ ...p, day: d });
            return;
        }
        tryEmit({ year: y, month: m, day: clampDay(y, m, d) });
    };

    const monthSelectMax =
        maxToday && p.year === ty ? maxMonthThisYear : 12;

    let dayCount = 31;
    if (p.year && p.month) {
        dayCount = daysInMonth(p.year, p.month);
        if (maxToday && p.year === ty && p.month === tm) dayCount = Math.min(dayCount, td);
    }

    const partName = (part) => (label ? `${label} ${part}` : part);

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
                aria-describedby={helpText ? helpTextId : undefined}
                className="grid grid-cols-3 gap-ds-2"
            >
                <div>
                    <label className="ds-visually-hidden" htmlFor={`${idPrefix}-month`}>{partName('month')}</label>
                    <Select
                        id={`${idPrefix}-month`}
                        value={p.month === '' ? '' : String(p.month)}
                        onChange={onMonthChange}
                        required={required}
                    >
                        <option value="">Month</option>
                        {MONTH_NAMES.map((nm, i) => {
                            const mv = i + 1;
                            if (p.year === ty && maxToday && mv > monthSelectMax) return null;
                            return (
                                <option key={mv} value={mv}>
                                    {nm}
                                </option>
                            );
                        })}
                    </Select>
                </div>
                <div>
                    <label className="ds-visually-hidden" htmlFor={`${idPrefix}-day`}>{partName('day')}</label>
                    <Select
                        id={`${idPrefix}-day`}
                        value={p.day === '' ? '' : String(p.day)}
                        onChange={onDayChange}
                        required={required}
                    >
                        <option value="">Day</option>
                        {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={d}>
                                {d}
                            </option>
                        ))}
                    </Select>
                </div>
                <div>
                    <label className="ds-visually-hidden" htmlFor={`${idPrefix}-year`}>{partName('year')}</label>
                    <Select
                        id={`${idPrefix}-year`}
                        value={p.year === '' ? '' : String(p.year)}
                        onChange={onYearChange}
                        required={required}
                    >
                        <option value="">Year</option>
                        {yearOptions.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
        </div>
    );
}
