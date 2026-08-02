import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { parseMonthYear, formatMonthYearIso } from '@shared/utils/dateFormHelpers';
import { FieldMessage, Select } from '@/design-system/components';

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const empty = () => ({ year: '', month: '' });

/**
 * Month + year dropdowns; value stored as YYYY-MM.
 *
 * Presentation is migrated to the approved `Select` / `FieldMessage` primitives
 * and `--ds-*` tokens, matching the sibling `DateTripletField`. Every piece of
 * date logic below — partial-selection handling, the `maxToday` month cap, and
 * exactly when the parent is emitted — is unchanged, and the
 * `${idPrefix}-month|year` element ids are a frozen contract.
 *
 * The two selects are grouped so assistive technology hears the field name once
 * and each control's own name is composed from it ("Gap Start (month / year)
 * month") instead of a bare "Month" — the same defect `DateTripletField` fixed.
 */
export default function MonthYearField({
    label,
    idPrefix,
    name,
    value,
    onChange,
    required = false,
    helpText,
    minYear = 1970,
    maxYear,
    maxToday = false,
}) {
    const rawId = useId().replace(/:/g, '');
    const groupLabelId = `${idPrefix}-group-label-${rawId}`;
    const helpTextId = `${idPrefix}-help-${rawId}`;

    const today = new Date();
    const ty = today.getFullYear();
    const tm = today.getMonth() + 1;

    const computedMaxYear = maxYear ?? (maxToday ? ty : ty + 10);

    const parsedFromProp = parseMonthYear(value);

    const [inner, setInner] = useState(() =>
        parsedFromProp.year && parsedFromProp.month
            ? { year: parsedFromProp.year, month: parsedFromProp.month }
            : empty()
    );

    const prevValueRef = useRef(value);

    useEffect(() => {
        const parsed = parseMonthYear(value);
        const prevParsed = parseMonthYear(prevValueRef.current);
        if (parsed.year && parsed.month) {
            setInner({ year: parsed.year, month: parsed.month });
        } else if (!value && prevParsed.year && prevParsed.month) {
            setInner(empty());
        }
        prevValueRef.current = value;
    }, [value]);

    const p = inner;

    const yearOptions = useMemo(() => {
        const ys = [];
        for (let y = computedMaxYear; y >= minYear; y--) ys.push(y);
        return ys;
    }, [computedMaxYear, minYear]);

    const maxMonthForYear = maxToday && p.year === ty ? tm : 12;

    const tryEmit = (next) => {
        const { year: y, month: m } = next;
        const allEmpty = !y && !m;
        if (allEmpty) {
            setInner(empty());
            onChange(name, '');
            return;
        }
        if (!y || !m) {
            setInner(next);
            const hadComplete = (() => {
                const pv = parseMonthYear(value);
                return Boolean(pv.year && pv.month);
            })();
            if (hadComplete) onChange(name, '');
            return;
        }
        let mm = m;
        if (maxToday && y === ty && mm > maxMonthForYear) mm = maxMonthForYear;
        const iso = formatMonthYearIso(y, mm);
        setInner({ year: y, month: mm });
        onChange(name, iso);
    };

    const onYearChange = (e) => {
        const y = e.target.value ? Number(e.target.value) : '';
        if (!y) {
            tryEmit(empty());
            return;
        }
        let m = p.month;
        if (maxToday && y === ty && m && m > maxMonthForYear) m = maxMonthForYear;
        tryEmit({ year: y, month: m || '' });
    };

    const onMonthChange = (e) => {
        const m = e.target.value ? Number(e.target.value) : '';
        if (!m) {
            tryEmit({ ...p, month: '' });
            return;
        }
        const y = p.year;
        if (!y) {
            setInner({ ...p, month: m });
            return;
        }
        tryEmit({ year: y, month: m });
    };

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
                required && <span id={groupLabelId} className="ds-visually-hidden">Required month and year</span>
            )}
            {helpText && <FieldMessage id={helpTextId} tone="help" className="mb-ds-1">{helpText}</FieldMessage>}
            <div
                role="group"
                aria-labelledby={label || required ? groupLabelId : undefined}
                aria-describedby={helpText ? helpTextId : undefined}
                className="grid grid-cols-2 gap-ds-2"
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
                            if (p.year === ty && maxToday && mv > maxMonthForYear) return null;
                            return (
                                <option key={mv} value={mv}>
                                    {nm}
                                </option>
                            );
                        })}
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
