// The one "this link does not work" screen the public pages share. Artificial
// company names only.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkProblemScreen } from './LinkProblemScreen';
import { LINK_PROBLEM, linkProblemFromError } from './linkProblem';

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

    it('says once who to contact when a link could not be checked for a reason no one named', () => {
        const problem = linkProblemFromError(
            Object.assign(new Error('internal'), { code: 'functions/internal' }),
            'This document could not be opened.',
        );
        render(<LinkProblemScreen {...problem} companyName="Acme Freight" onRetry={vi.fn()} />);
        expect(screen.getByRole('alert')).toHaveTextContent(
            'This document could not be opened. Please try again. If it keeps happening, contact Acme Freight.',
        );
        expect(screen.queryByText(/contact support/)).not.toBeInTheDocument();
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

describe('LinkProblemScreen: Ask for a new link', () => {
    const onRequestNewLink = vi.fn(async () => ({ ok: true }));
    const ASK = 'Ask Acme Freight for a new link';
    const refusal = (code) => Object.assign(new Error(code), { code: `functions/${code}` });

    beforeEach(() => {
        // Queues *Once values: reset, and the default put back.
        vi.resetAllMocks();
        onRequestNewLink.mockImplementation(async () => ({ ok: true }));
    });

    it.each([LINK_PROBLEM.EXPIRED, LINK_PROBLEM.REPLACED, LINK_PROBLEM.UNOPENABLE])(
        'is offered when %s, beside the advice the screen already gives',
        (reason) => {
            render(<LinkProblemScreen reason={reason} companyName="Acme Freight" onRequestNewLink={onRequestNewLink} />);
            expect(screen.getByRole('button', { name: ASK })).toBeEnabled();
            const advice = ALL.find(([r]) => r === reason)[3];
            expect(screen.getByText(advice)).toBeInTheDocument();
        },
    );

    it.each([LINK_PROBLEM.USED, LINK_PROBLEM.NOT_FOUND, LINK_PROBLEM.UNAVAILABLE])(
        'is not offered when %s, where a new link would not help',
        (reason) => {
            render(<LinkProblemScreen reason={reason} companyName="Acme Freight" onRequestNewLink={onRequestNewLink} />);
            expect(screen.queryByRole('button', { name: /for a new link/ })).not.toBeInTheDocument();
        },
    );

    it('is not offered when the page passes no way to ask', () => {
        render(<LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} companyName="Acme Freight" />);
        expect(screen.queryByRole('button', { name: /for a new link/ })).not.toBeInTheDocument();
    });

    it('is busy while asking, then says the company was asked, in place of the button, and takes the focus', async () => {
        let answer;
        onRequestNewLink.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
        render(<LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} companyName="Acme Freight" onRequestNewLink={onRequestNewLink} />);

        fireEvent.click(screen.getByRole('button', { name: ASK }));
        const button = screen.getByRole('button', { name: ASK });
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(button).toBeDisabled();
        fireEvent.click(button);
        expect(onRequestNewLink).toHaveBeenCalledTimes(1);

        await act(async () => answer({ ok: true }));
        const done = await screen.findByText('Done. Acme Freight has been asked to send you a new link.');
        // The focus moves in an effect, after the notice renders.
        await waitFor(() => expect(done.closest('[role="status"].ds-notice')).toHaveFocus());
        expect(screen.queryByRole('button', { name: ASK })).not.toBeInTheDocument();
    });

    it('never says the company was told when the server refused too many requests, and offers the button again', async () => {
        // Someone else on the same network may have used the requests up: nobody was told.
        onRequestNewLink.mockRejectedValueOnce(refusal('resource-exhausted'));
        render(<LinkProblemScreen reason={LINK_PROBLEM.REPLACED} companyName="Acme Freight" onRequestNewLink={onRequestNewLink} />);

        fireEvent.click(screen.getByRole('button', { name: ASK }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Too many requests came from this network. Please try again later, or contact Acme Freight.',
        );
        expect(screen.queryByText(/has been (asked|told)/)).not.toBeInTheDocument();
        const again = screen.getByRole('button', { name: ASK });
        await waitFor(() => expect(again).toHaveFocus());

        fireEvent.click(again);
        expect(await screen.findByText('Done. Acme Freight has been asked to send you a new link.')).toBeInTheDocument();
    });

    it('says at once when the request could not be sent, and offers the button again', async () => {
        onRequestNewLink.mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch')));
        render(<LinkProblemScreen reason={LINK_PROBLEM.UNOPENABLE} companyName="Acme Freight" onRequestNewLink={onRequestNewLink} />);

        fireEvent.click(screen.getByRole('button', { name: ASK }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'That request could not be sent. Please contact Acme Freight.',
        );
        const again = screen.getByRole('button', { name: ASK });
        await waitFor(() => expect(again).toHaveFocus());

        fireEvent.click(again);
        expect(await screen.findByText('Done. Acme Freight has been asked to send you a new link.')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(onRequestNewLink).toHaveBeenCalledTimes(2);
    });

    it('asks "the sender" when the page does not know the company', async () => {
        onRequestNewLink.mockRejectedValueOnce(new Error('offline'));
        render(<LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} onRequestNewLink={onRequestNewLink} />);

        fireEvent.click(screen.getByRole('button', { name: 'Ask the sender for a new link' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Please contact the sender.');
        fireEvent.click(screen.getByRole('button', { name: 'Ask the sender for a new link' }));
        expect(await screen.findByText('Done. The sender has been asked to send you a new link.')).toBeInTheDocument();
    });

    it('has no accessibility violations with the button and with each outcome', async () => {
        onRequestNewLink
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(refusal('resource-exhausted'));
        const { container } = render(
            <LinkProblemScreen reason={LINK_PROBLEM.EXPIRED} companyName="Acme Freight" onRequestNewLink={onRequestNewLink} />,
        );
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: ASK }));
        await screen.findByRole('alert');
        expect((await axe(container)).violations).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: ASK }));
        const card = screen.getByRole('main');
        await within(card).findByText(/Too many requests came from this network/);
        expect((await axe(container)).violations).toEqual([]);
    });
});
