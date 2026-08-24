import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge, getStatusTone } from './StatusBadge';
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

    it('reads an unrecognised status as neutral, not as new', () => {
        // Neutral is the honest answer. Defaulting an unknown status to `info`
        // would render it identically to a genuinely new record and quietly
        // claim something the data does not say.
        const { container } = render(<StatusBadge status="Totally Unknown" />);
        expect(container.querySelector('.ds-badge')).toHaveAttribute('data-tone', 'neutral');
        expect(screen.getByText('Totally Unknown')).toBeInTheDocument();
    });

    /**
     * Matching is fuzzy because the product carries two kinds of status string:
     * canonical labels ("Offer Sent") and the free-form ones a recruiter list
     * uses ("New Application", "Terminated"). An exact-key map handled the first
     * and silently defaulted the second, which is how the candidate list ended
     * up calling "Hired" purple while the dossier called it green.
     */
    it.each([
        ['New Application', 'info'],
        ['Terminated', 'danger'],
        ['Declined', 'danger'],
        ['Hired', 'success'],
        ['Attempted Contact', 'accent'],
        ['Archived', 'neutral'],
    ])('resolves the free-form status %s to %s', (status, tone) => {
        expect(getStatusTone(status)).toBe(tone);
    });

    it('prefers the negative outcome when a status contains both', () => {
        // Order is load-bearing: "declined" is tested before "new", so a status
        // like this reads as declined rather than as a fresh record.
        expect(getStatusTone('New — declined')).toBe('danger');
    });

    it('gives the same status the same tone wherever it is rendered', () => {
        // The defect this component exists to prevent: two screens disagreeing
        // about what colour a status is.
        expect(getStatusTone('Hired')).toBe(getStatusTone('hired'));
        expect(getStatusTone('Approved')).toBe(getStatusTone('Hired'));
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
