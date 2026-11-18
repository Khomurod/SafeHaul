/**
 * The dossier's Summary cards open on an older or hand-edited record too. A
 * list stored as a word ("None") or a map, an empty row inside a list, and a
 * signature that is not text are left out of the summary instead of replacing
 * the whole page with "temporarily unavailable". All values are artificial.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConsentCard, ExperienceTimeline, SafetyCard } from './applicationTabCards';

afterEach(cleanup);

describe('the Safety card with lists in an unusual shape', () => {
    it('reads a word where the violations list belongs as no rows', () => {
        render(<SafetyCard appData={{ violations: 'None', accidents: { first: { details: 'x' } } }} />);
        expect(screen.queryByText(/^Violations \(/)).toBeNull();
        expect(screen.queryByText(/^Accidents \(/)).toBeNull();
    });

    it('skips an empty row and keeps the real ones', () => {
        render(<SafetyCard appData={{ violations: [null, { charge: 'Speeding (artificial)', date: '2025-03-01' }] }} />);
        expect(screen.getByText('Violations (1)')).toBeInTheDocument();
        expect(screen.getByText('Speeding (artificial)')).toBeInTheDocument();
    });

    it('still counts a row stored as plain text, so the record never reads as clean', () => {
        render(<SafetyCard appData={{ violations: ['Speeding'] }} />);
        expect(screen.getByText('Violations (1)')).toBeInTheDocument();
        expect(screen.queryByText(/clean record/i)).toBeNull();
    });
});

describe('the Employment History with a list in an unusual shape', () => {
    it('skips an empty row and keeps the real employers', () => {
        render(<ExperienceTimeline appData={{ employers: [null, { companyName: 'Acme Freight (artificial)' }] }} />);
        expect(screen.getByText('Acme Freight (artificial)')).toBeInTheDocument();
    });

    it('shows nothing for a map where the list belongs', () => {
        const { container } = render(<ExperienceTimeline appData={{ employers: { a: { companyName: 'X' } } }} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('the Consent card with a signature that is not text', () => {
    it('opens and draws no signature image', () => {
        render(<ConsentCard appData={{ signature: { image: 'data:image/png;base64,AAAA', type: 'drawn' } }} />);
        expect(screen.queryByRole('img', { name: 'Driver Signature' })).toBeNull();
    });
});
