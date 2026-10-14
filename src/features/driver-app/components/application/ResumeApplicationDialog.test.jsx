/**
 * The resume dialog's two stages. It stays mounted between prompts, so the
 * confirmation stage belongs to the prompt it was opened for.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ResumeApplicationDialog } from './ResumeApplicationDialog';

const props = { loading: false, error: null, onContinue: vi.fn(), onStartOver: vi.fn() };

describe('ResumeApplicationDialog', () => {
    it('opens a later prompt on the question, not on the deletion it was left at', () => {
        const first = { startedAt: null };
        const { rerender } = render(<ResumeApplicationDialog {...props} prompt={first} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start a new application' }));
        expect(screen.getByText('Start a new application?')).toBeInTheDocument();

        rerender(<ResumeApplicationDialog {...props} prompt={null} />);
        rerender(<ResumeApplicationDialog {...props} prompt={{ startedAt: null }} />);

        expect(screen.getByText('Continue your existing application?')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete it and start over' })).toBeNull();
    });

    it('goes back to the question from the confirmation', () => {
        render(<ResumeApplicationDialog {...props} prompt={{ startedAt: null }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Start a new application' }));
        fireEvent.click(screen.getByRole('button', { name: 'Keep my saved application' }));
        expect(screen.getByText('Continue your existing application?')).toBeInTheDocument();
    });
});
