import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import InputField from '../components/form/InputField';
import { useFieldValidation } from './useFieldValidation';
import { email } from '../utils/fieldValidators';

// Minimal harness mirroring how a wizard step wires the hook to InputField.
function EmailField() {
    const validators = React.useMemo(() => ({ email: email('Email') }), []);
    const { errors, handleBlur, revalidate } = useFieldValidation(validators);
    const [value, setValue] = React.useState('');
    return (
        <InputField
            label="Email"
            id="email"
            name="email"
            value={value}
            error={errors.email}
            onChange={(name, v) => { setValue(v); revalidate(name, v, { email: v }); }}
            onBlur={(name, v) => handleBlur(name, v, { email: v })}
        />
    );
}

afterEach(cleanup);

describe('C5 on-blur validation wired through InputField', () => {
    it('shows no error before blur, an accessible error on blur, and clears it once fixed', () => {
        render(<EmailField />);
        const input = screen.getByLabelText(/email/i);

        // Typing an invalid value before blur: stay quiet.
        fireEvent.change(input, { target: { value: 'bad' } });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(input).not.toHaveAttribute('aria-invalid');

        // Blur: error appears, programmatically associated.
        fireEvent.blur(input);
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/valid email/i);
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(input).toHaveAttribute('aria-describedby', alert.id);

        // Revalidate-on-change-once-touched: fixing it clears the error live.
        fireEvent.change(input, { target: { value: 'a@b.co' } });
        expect(screen.queryByRole('alert')).toBeNull();
        expect(input).not.toHaveAttribute('aria-invalid');
    });
});
