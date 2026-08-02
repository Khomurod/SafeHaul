import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';
import { getStatusIcon } from './statusIcon';

afterEach(cleanup);

describe('StatusBadge (C3 icon + text)', () => {
    it('renders both an icon and the status text in pill variant', () => {
        const { container, getByText } = render(<StatusBadge status="Rejected" />);
        expect(getByText('Rejected')).toBeInTheDocument();
        const icon = container.querySelector('svg');
        expect(icon).toBeTruthy();
        // Icon is decorative; the text carries the accessible meaning.
        expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders an icon shape in dot variant (not just a colour dot)', () => {
        const { container, getByText } = render(<StatusBadge status="New" variant="dot" />);
        expect(getByText('New')).toBeInTheDocument();
        expect(container.querySelector('svg')).toBeTruthy();
    });

    it('maps distinct statuses to distinct icon shapes', () => {
        // Sanity: opposite outcomes should not share an icon component.
        expect(getStatusIcon('Rejected')).not.toBe(getStatusIcon('Approved'));
        expect(getStatusIcon('New')).not.toBe(getStatusIcon('Rejected'));
    });

    it('falls back to a default icon for unknown statuses', () => {
        const { container } = render(<StatusBadge status="Totally Unknown" />);
        expect(container.querySelector('svg')).toBeTruthy();
    });
});
