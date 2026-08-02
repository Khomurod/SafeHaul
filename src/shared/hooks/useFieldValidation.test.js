import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFieldValidation } from './useFieldValidation';
import { required, email } from '../utils/fieldValidators';

const validators = {
    firstName: required('First Name'),
    email: email('Email'),
};

describe('useFieldValidation (C5)', () => {
    it('does not error before a field is touched', () => {
        const { result } = renderHook(() => useFieldValidation(validators));
        act(() => result.current.revalidate('email', 'bad', { email: 'bad' }));
        expect(result.current.errors.email).toBeUndefined();
        expect(result.current.touched.email).toBeUndefined();
    });

    it('validates and marks touched on blur', () => {
        const { result } = renderHook(() => useFieldValidation(validators));
        act(() => result.current.handleBlur('email', 'bad', { email: 'bad' }));
        expect(result.current.touched.email).toBe(true);
        expect(result.current.errors.email).toMatch(/valid email/i);
    });

    it('re-validates on change once touched, clearing the error when fixed', () => {
        const { result } = renderHook(() => useFieldValidation(validators));
        act(() => result.current.handleBlur('email', 'bad', { email: 'bad' }));
        expect(result.current.errors.email).toBeTruthy();
        act(() => result.current.revalidate('email', 'a@b.co', { email: 'a@b.co' }));
        expect(result.current.errors.email).toBeUndefined();
    });

    it('validateAll touches every field and reports the first error', () => {
        const { result } = renderHook(() => useFieldValidation(validators));
        let outcome;
        act(() => {
            outcome = result.current.validateAll({ firstName: '', email: 'bad' });
        });
        expect(outcome.isValid).toBe(false);
        expect(outcome.firstErrorField).toBe('firstName');
        expect(result.current.touched.firstName).toBe(true);
        expect(result.current.touched.email).toBe(true);
        expect(result.current.errors.firstName).toMatch(/required/i);
    });

    it('validateAll returns valid when all pass', () => {
        const { result } = renderHook(() => useFieldValidation(validators));
        let outcome;
        act(() => {
            outcome = result.current.validateAll({ firstName: 'John', email: 'a@b.co' });
        });
        expect(outcome.isValid).toBe(true);
        expect(outcome.firstErrorField).toBeNull();
    });
});
