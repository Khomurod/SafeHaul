// The one "this link does not work" screen the public pages share. Artificial
// company names only.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { LinkProblemScreen } from './LinkProblemScreen';
import { LINK_PROBLEM } from './linkProblem';

const ALL = [
    [LINK_PROBLEM.EXPIRED, 'This link has expired', /stop working after a while/, /ask Acme Freight for a new link/],
    [LINK_PROBLEM.REPLACED, 'This link was replaced by a newer one', /newer link was sent/, /Open the newest message from Acme Freight/],
    [LINK_PROBLEM.USED, 'This link has already been used', /nothing more to do/, /contact Acme Freight/],
    [LINK_PROBLEM.NOT_FOUND, 'This link is not valid', /may be incomplete/, /ask Acme Freight for a new one/],
    [LINK_PROBLEM.UNOPENABLE, 'This link could not be opened', /expired, or a newer link/, /Open the newest message from Acme Freight/],
    [LINK_PROBLEM.UNAVAILABLE, 'We could not check this link', /Check your internet connection/, /contact Acme Freight/],
];

describe('LinkProblemScreen', () => {
    it.each(ALL)('says what happened and what to do when %s, naming the company', (reason, title, happened, todo) => {
        render(<LinkProblemScreen reason={reason} companyName="Acme Freight" />);
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
        expect(screen.getByRole('main')).toHaveAccessibleName(title);
        expect(screen.getByText(happened)).toHaveTextContent(todo);
    });

    it('asks "the sender" when the page does not know the company', () => {
        render(<LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} />);
        expect(screen.getByText(/ask the sender for a new link/)).toBeInTheDocument();
    });

    it('moves focus to its heading, because it replaces what was on the page', () => {
        render(<LinkProblemScreen reason={LINK_PROBLEM.REPLACED} />);
        expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    });

    it('announces a link it could not check at once, and the others politely', () => {
        const view = render(<LinkProblemScreen reason={LINK_PROBLEM.UNAVAILABLE} onRetry={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent('We could not check this link');
        view.unmount();

        render(<LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} />);
        expect(screen.getByRole('status')).toHaveTextContent('This link has expired');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('offers Try again only when the page passes a retry', () => {
        const onRetry = vi.fn();
        const view = render(<LinkProblemScreen reason={LINK_PROBLEM.UNAVAILABLE} onRetry={onRetry} />);
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledTimes(1);
        view.unmount();

        render(<LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} />);
        expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    });

    it("uses the page's words for what happened, and drops the advice when told to", () => {
        render(
            <LinkProblemScreen
                reason={LINK_PROBLEM.UNOPENABLE}
                companyName="Acme Freight"
                detail="Acme Freight removed this unfinished application."
                advice={null}
                actions={<button type="button">Continue to the application</button>}
            />,
        );
        const description = screen.getByText(/removed this unfinished application/);
        expect(description).toHaveTextContent(/^Acme Freight removed this unfinished application\.$/);
        expect(screen.getByRole('button', { name: 'Continue to the application' })).toBeInTheDocument();
    });

    it('wraps an unbroken server sentence rather than overflowing', () => {
        render(<LinkProblemScreen reason={LINK_PROBLEM.UNAVAILABLE} detail={'x'.repeat(200)} />);
        expect(screen.getByRole('alert').innerHTML).toContain('overflow-wrap:anywhere');
    });

    it.each(ALL)('has no accessibility violations when %s', async (reason) => {
        const { container } = render(
            <LinkProblemScreen reason={reason} companyName="Acme Freight" onRetry={vi.fn()} />,
        );
        expect((await axe(container)).violations).toEqual([]);
    });

    it('uses no legacy palette classes, raw hex or unsupported small text', () => {
        for (const [reason] of ALL) {
            const { container, unmount } = render(<LinkProblemScreen reason={reason} onRetry={vi.fn()} />);
            expect(container.innerHTML).not.toMatch(/(bg|text|border)-(gray|blue|green|red|amber|yellow|slate)-\d{2,3}/);
            expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
            expect(container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
            unmount();
        }
    });
});
