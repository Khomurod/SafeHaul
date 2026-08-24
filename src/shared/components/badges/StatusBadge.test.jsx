import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';
import { getStatusIcon } from './statusIcon';

afterEach(cleanup);

describe('StatusBadge', () => {
    it('renders the status text and a decorative icon', () => {
        const { container } = render(<StatusBadge status="Rejected" />);
        expect(screen.getByText('Rejected')).toBeInTheDocument();
        const icon = container.querySelector('svg');
        expect(icon).toBeTruthy();
        // The text carries the meaning; the icon reinforces it.
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('uses the approved Badge rather than a second pill implementation', () => {
        const { container } = render(<StatusBadge status="Approved" />);
        expect(container.querySelector('.ds-badge')).toBeInTheDocument();
    });

    it.each([
        ['New', 'info'],
        ['In Review', 'accent'],
        ['Qualified', 'success'],
        ['Hold', 'warning'],
        ['Rejected', 'danger'],
        ['Stale', 'neutral'],
    ])('maps %s onto the %s tone', (status, tone) => {
        const { container } = render(<StatusBadge status={status} />);
        expect(container.querySelector('.ds-badge')).toHaveAttribute('data-tone', tone);
    });

    it('falls back to the new-status tone for an unrecognised status', () => {
        const { container } = render(<StatusBadge status="Totally Unknown" />);
        expect(container.querySelector('.ds-badge')).toHaveAttribute('data-tone', 'info');
        expect(screen.getByText('Totally Unknown')).toBeInTheDocument();
    });

    /**
     * Ten statuses map onto six tones, so some share one. That is only safe
     * because the icon and the label distinguish them — which is the rule
     * "status is never colour alone", asserted rather than assumed.
     */
    it('distinguishes same-toned statuses by icon', () => {
        expect(getStatusIcon('In Review')).not.toBe(getStatusIcon('Background Check'));
        expect(getStatusIcon('Qualified')).not.toBe(getStatusIcon('Offer Sent'));
    });

    it('maps opposite outcomes to different icon shapes', () => {
        expect(getStatusIcon('Rejected')).not.toBe(getStatusIcon('Approved'));
        expect(getStatusIcon('New')).not.toBe(getStatusIcon('Rejected'));
    });
});
