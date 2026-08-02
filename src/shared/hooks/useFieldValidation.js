import { useCallback, useRef, useState } from 'react';

/**
 * On-blur + revalidate-on-change-once-touched field validation (C5).
 *
 * Industry norm for forms: validate a field when the user leaves it (blur),
 * re-validate on every change *only after* it has been touched/errored (so we
 * don't yell at someone mid-typing the first time), and summarise everything on
 * submit. This hook owns that state machine; rendering of the per-field error is
 * delegated to the a11y-aware InputField via its `error` prop.
 *
 * @param {Record<string, (value: any, allValues: object) => (string|null)>} validators
 *   Map of field name -> validator. Memoise this (e.g. useMemo) so the returned
 *   callbacks stay stable across renders.
 * @returns {{
 *   errors: Record<string,string>,
 *   touched: Record<string,boolean>,
 *   handleBlur: (name: string, value: any, allValues?: object) => void,
 *   revalidate: (name: string, value: any, allValues?: object) => void,
 *   validateField: (name: string, value: any, allValues?: object) => (string|null),
 *   validateAll: (values: object) => { isValid: boolean, errors: Record<string,string>, firstErrorField: string|null },
 *   markTouched: (name: string) => void,
 * }}
 */
export function useFieldValidation(validators = {}) {
    const [errors, setErrors] = useState({});
    const [touched, setTouched] = useState({});
    // Mirror touched in a ref for synchronous reads inside change handlers.
    const touchedRef = useRef({});

    const validateField = useCallback((name, value, allValues = {}) => {
        const fn = validators[name];
        const err = fn ? (fn(value, allValues) || null) : null;
        setErrors((prev) => {
            if (err) {
                return prev[name] === err ? prev : { ...prev, [name]: err };
            }
            if (!(name in prev)) return prev;
            const next = { ...prev };
            delete next[name];
            return next;
        });
        return err;
    }, [validators]);

    const markTouched = useCallback((name) => {
        if (touchedRef.current[name]) return;
        touchedRef.current = { ...touchedRef.current, [name]: true };
        setTouched(touchedRef.current);
    }, []);

    const handleBlur = useCallback((name, value, allValues = {}) => {
        markTouched(name);
        validateField(name, value, allValues);
    }, [markTouched, validateField]);

    // Call after a value changes; only re-validates fields the user has touched.
    const revalidate = useCallback((name, value, allValues = {}) => {
        if (touchedRef.current[name]) validateField(name, value, allValues);
    }, [validateField]);

    const validateAll = useCallback((values = {}) => {
        const names = Object.keys(validators);
        const nextErrors = {};
        const nextTouched = { ...touchedRef.current };
        for (const name of names) {
            const fn = validators[name];
            const err = fn ? (fn(values[name], values) || null) : null;
            nextTouched[name] = true;
            if (err) nextErrors[name] = err;
        }
        touchedRef.current = nextTouched;
        setTouched(nextTouched);
        setErrors(nextErrors);
        const firstErrorField = names.find((n) => nextErrors[n]) || null;
        return { isValid: Object.keys(nextErrors).length === 0, errors: nextErrors, firstErrorField };
    }, [validators]);

    return { errors, touched, handleBlur, revalidate, validateField, validateAll, markTouched };
}

export default useFieldValidation;
