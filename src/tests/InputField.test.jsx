// C2 coverage: InputField wires WCAG 2.1 AA error/required semantics.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InputField from '../shared/components/form/InputField';

describe('InputField accessibility (C2)', () => {
  it('exposes aria-required and links a role="alert" error message when invalid', () => {
    render(
      <InputField
        id="email"
        name="email"
        label="Email"
        required
        value=""
        onChange={() => {}}
        error="Email is required"
      />,
    );
    const input = screen.getByLabelText(/Email/i);
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email is required');
    // describedby must point at the rendered alert.
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('renders no alert and no aria-invalid when there is no error', () => {
    render(<InputField id="name" name="name" label="Name" value="" onChange={() => {}} />);
    expect(screen.queryByRole('alert')).toBeNull();
    const input = screen.getByLabelText(/Name/i);
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });

  it('fires onBlur with (name, value) when provided', () => {
    const onBlur = vi.fn();
    render(<InputField id="city" name="city" label="City" value="Dallas" onChange={() => {}} onBlur={onBlur} />);
    fireEvent.blur(screen.getByLabelText(/City/i));
    expect(onBlur).toHaveBeenCalledWith('city', 'Dallas');
  });
});
