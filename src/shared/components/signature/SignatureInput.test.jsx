import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SignatureInput } from './SignatureInput';
import { typedSignatureValue } from './typedSignature';

vi.mock('./SignaturePad', () => ({
    SIGNATURE_CANVAS_HEIGHT: 150,
    SignaturePad: ({ onSignatureChange, instructions }) => (
        <div>
            <p>{instructions}</p>
            <button type="button" onClick={() => onSignatureChange('data:image/png;base64,DRAWN')}>Mock sign</button>
            <button type="button" onClick={() => onSignatureChange(null)}>Mock clear</button>
        </div>
    ),
}));

function renderInput(props = {}) {
    const onSignatureChange = vi.fn();
    render(
        <div>
            <span id="sig-label">Electronic Signature</span>
            <SignatureInput labelId="sig-label" drawInstructions="Draw below." onSignatureChange={onSignatureChange} {...props} />
        </div>,
    );
    return { onSignatureChange };
}

describe('typedSignatureValue', () => {
    it('stores a typed name with the TEXT_SIGNATURE prefix, whitespace collapsed', () => {
        expect(typedSignatureValue('  Alex   Employer ')).toBe('TEXT_SIGNATURE:Alex Employer');
    });
    it('is null below two characters and capped at 120', () => {
        expect(typedSignatureValue('A')).toBeNull();
        expect(typedSignatureValue('')).toBeNull();
        expect(typedSignatureValue(null)).toBeNull();
        expect(typedSignatureValue('x'.repeat(200))).toBe(`TEXT_SIGNATURE:${'x'.repeat(120)}`);
    });
});

describe('SignatureInput', () => {
    it('offers Draw and Type under the signature label, with Draw pressed by default', () => {
        renderInput();
        const group = screen.getByRole('group', { name: 'Electronic Signature' });
        expect(group).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Draw', pressed: true })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Type', pressed: false })).toBeInTheDocument();
        expect(screen.getByText('Draw below.')).toBeInTheDocument();
    });

    it('wraps a drawn PNG with its method, and a cleared pad as null', () => {
        const { onSignatureChange } = renderInput();
        fireEvent.click(screen.getByRole('button', { name: 'Mock sign' }));
        expect(onSignatureChange).toHaveBeenLastCalledWith({ data: 'data:image/png;base64,DRAWN', method: 'drawn' });
        fireEvent.click(screen.getByRole('button', { name: 'Mock clear' }));
        expect(onSignatureChange).toHaveBeenLastCalledWith(null);
    });

    it('signs by typing a name — a keyboard-only path — and records the method', () => {
        const { onSignatureChange } = renderInput();
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        expect(onSignatureChange).toHaveBeenLastCalledWith(null);
        const input = screen.getByRole('textbox', { name: /Type your full name to sign/ });
        expect(input).toHaveAccessibleDescription(expect.stringContaining('legally binding'));

        fireEvent.change(input, { target: { value: 'A' } });
        expect(onSignatureChange).toHaveBeenLastCalledWith(null);
        fireEvent.change(input, { target: { value: 'Alex Employer' } });
        expect(onSignatureChange).toHaveBeenLastCalledWith({ data: 'TEXT_SIGNATURE:Alex Employer', method: 'typed' });
        expect(screen.getByTestId('typed-signature-preview')).toHaveTextContent('Alex Employer');
    });

    it('drops the typed mark when the respondent switches back to drawing', () => {
        const { onSignatureChange } = renderInput();
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        fireEvent.change(screen.getByRole('textbox', { name: /Type your full name to sign/ }), { target: { value: 'Alex Employer' } });
        fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
        expect(onSignatureChange).toHaveBeenLastCalledWith(null);
        expect(screen.getByText('Draw below.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        expect(screen.getByRole('textbox', { name: /Type your full name to sign/ })).toHaveValue('');
    });

    it('shows the validation error against whichever surface is active', () => {
        renderInput({ error: 'Please provide your electronic signature' });
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        expect(screen.getByRole('textbox', { name: /Type your full name to sign/ })).toHaveAccessibleDescription(
            expect.stringContaining('Please provide your electronic signature'),
        );
    });
});
