import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeatureLockedModal } from './FeatureLockedModal';

afterEach(cleanup);

describe('Modal adoption (C4)', () => {
    it('FeatureLockedModal closes on Escape and via the close button', () => {
        const onClose = vi.fn();
        render(<FeatureLockedModal onClose={onClose} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        // Two affordances are labelled "Close" (the X and the footer button).
        fireEvent.click(screen.getAllByRole('button', { name: /close/i })[0]);
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});
