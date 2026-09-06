import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubmissionRecordNotice } from './SubmissionRecordNotice';
import { presentSubmission } from '@features/applications/services/submissionPresenter';

/** Drives the component through the real presenter, so the two cannot drift. */
function frozen(overrides = {}) {
    return presentSubmission({
        schemaVersion: 1,
        frozen: true,
        submittedAt: '2026-03-04T10:00:00.000Z',
        company: { name: 'Blue Line Freight' },
        sections: [],
        customAnswers: [],
        agreements: [],
        provenance: { source: 'submission', notes: [] },
        ...overrides,
    });
}

describe('SubmissionRecordNotice', () => {
    it('renders nothing before a record is known', () => {
        const { container } = render(<SubmissionRecordNotice record={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('confirms a preserved original and names the submission date', () => {
        render(<SubmissionRecordNotice record={frozen()} />);
        expect(screen.getByText('Preserved original submission')).toBeInTheDocument();
        expect(screen.getByText(/frozen/i)).toHaveTextContent('March 4, 2026');
    });

    it('warns honestly when no record was preserved', () => {
        render(<SubmissionRecordNotice record={presentSubmission(null)} />);
        expect(screen.getByText('No preserved submission record')).toBeInTheDocument();
        expect(screen.getByText(/may not match exactly/i)).toBeInTheDocument();
        // It must never imply the historical record is the frozen original.
        expect(screen.queryByText(/Preserved original submission/)).not.toBeInTheDocument();
    });

    it('marks a reconstructed record and lists what could not be recovered', () => {
        const record = frozen({
            provenance: { source: 'reconstructed', notes: ['Individual agreement acceptance was not recorded.'] },
        });
        render(<SubmissionRecordNotice record={record} />);

        expect(screen.getByText('Reconstructed record')).toBeInTheDocument();
        expect(screen.getByText('Individual agreement acceptance was not recorded.')).toBeInTheDocument();
        expect(screen.queryByText(/Preserved original submission/)).not.toBeInTheDocument();
    });

    it('is announced to assistive technology', () => {
        render(<SubmissionRecordNotice record={frozen()} />);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });

    /*
     * The same question, asked of the current spelling.
     *
     * Until 2026-09-06 this file hand-built its block and carried its own tone
     * map, so the check was "is `ds-status-warning` in the wrapper's class
     * list". It renders a `Notice` now: the tone is an attribute and the colours
     * live in `Notice.css`, so the class assertion is `data-tone`. The half that
     * matters is unchanged — no raw palette colour, in any spelling.
     */
    it('states its tone through the design system, never a raw palette colour', () => {
        const { container } = render(<SubmissionRecordNotice record={presentSubmission(null)} />);
        const block = container.firstChild;
        expect(block).toHaveAttribute('data-tone', 'warning');
        expect(block.className).toMatch(/ds-notice/);
        // Guards the design-system rule: no arbitrary Tailwind palette colours.
        expect(block.className).not.toMatch(/bg-(amber|red|blue|green|slate)-\d/);
    });

    it('survives a record whose date is unusable rather than inventing one', () => {
        render(<SubmissionRecordNotice record={frozen({ submittedAt: 'not-a-date' })} />);
        expect(screen.getByText(/not-a-date/)).toBeInTheDocument();
    });
});
