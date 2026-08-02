// Focused coverage for the public signing room's full-page status screens.
// Every user-facing string here is a frozen contract — the signing E2E specs and
// the @a11y journey assert several of them — so each is pinned. All fixtures are
// artificial; no real recipient or document data appears.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    SigningLoadingScreen,
    SigningErrorScreen,
    SigningVoidedScreen,
    SigningSuccessScreen,
    EsignConsentScreen,
} from './StatusScreens';

let closeSpy;

beforeEach(() => {
    closeSpy = vi.fn();
    vi.stubGlobal('close', closeSpy);
});

describe('SigningLoadingScreen', () => {
    it('announces itself while the document loads', () => {
        render(<SigningLoadingScreen />);
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Loading secure document...');
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<SigningLoadingScreen />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('SigningErrorScreen', () => {
    it('names the page and surfaces the reason as an alert', () => {
        render(<SigningErrorScreen error="This link has expired." />);
        expect(screen.getByRole('heading', { level: 1, name: 'Access Denied' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('This link has expired.');
    });

    it('exposes the screen as a labelled landmark', () => {
        render(<SigningErrorScreen error="Invalid token." />);
        expect(screen.getByRole('main')).toHaveAccessibleName('Access Denied');
    });

    it('wraps a long reason rather than overflowing', () => {
        render(<SigningErrorScreen error={'x'.repeat(200)} />);
        expect(screen.getByRole('alert').innerHTML).toContain('overflow-wrap:anywhere');
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<SigningErrorScreen error="Access is not permitted." />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('SigningVoidedScreen', () => {
    it('keeps the exact voided wording', () => {
        render(<SigningVoidedScreen />);
        expect(screen.getByRole('heading', { level: 1, name: 'Document Voided' })).toBeInTheDocument();
        expect(screen.getByText(/voided by the sender and is no longer accessible/)).toBeInTheDocument();
    });

    it('closes the window from an approved Button', () => {
        render(<SigningVoidedScreen />);
        const close = screen.getByRole('button', { name: 'Close Window' });
        expect(close).toHaveClass('ds-button');
        fireEvent.click(close);
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<SigningVoidedScreen />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('SigningSuccessScreen', () => {
    it('keeps the exact success heading the E2E specs assert', () => {
        render(<SigningSuccessScreen recipientName="Pat Example" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Document Signed!' })).toBeInTheDocument();
        expect(screen.getByText(/Pat Example/)).toBeInTheDocument();
        expect(screen.getByText(/securely sealed and sent to the sender/)).toBeInTheDocument();
    });

    it('offers only Close Window when there is nowhere to return to', () => {
        render(<SigningSuccessScreen recipientName="Pat Example" />);
        expect(screen.getByRole('button', { name: 'Close Window' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Return to Required Documents' })).not.toBeInTheDocument();
    });

    it('offers the return action first when a return path exists', () => {
        const onReturnToDocuments = vi.fn();
        render(<SigningSuccessScreen recipientName="Pat Example" onReturnToDocuments={onReturnToDocuments} />);

        const buttons = screen.getAllByRole('button');
        expect(buttons[0]).toHaveAccessibleName('Return to Required Documents');
        expect(buttons[0]).toHaveAttribute('data-variant', 'primary');

        fireEvent.click(buttons[0]);
        expect(onReturnToDocuments).toHaveBeenCalledTimes(1);
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it('still closes the window from the secondary action', () => {
        render(<SigningSuccessScreen recipientName="Pat Example" onReturnToDocuments={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Close Window' }));
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('respects reduced motion for its entrance animation', () => {
        const { container } = render(<SigningSuccessScreen recipientName="Pat Example" />);
        expect(container.innerHTML).toContain('motion-safe:animate-in');
        expect(container.innerHTML).not.toMatch(/(?<!motion-safe:)animate-in/);
    });

    it('has no accessibility violations in both variants', async () => {
        const plain = render(<SigningSuccessScreen recipientName="Pat Example" />);
        expect((await axe(plain.container)).violations).toEqual([]);
        plain.unmount();

        const withReturn = render(
            <SigningSuccessScreen recipientName="Pat Example" onReturnToDocuments={vi.fn()} />,
        );
        expect((await axe(withReturn.container)).violations).toEqual([]);
    });
});

describe('EsignConsentScreen', () => {
    it('keeps the exact consent heading and the frozen agree label', () => {
        render(<EsignConsentScreen title="Artificial Offer Letter" onAgree={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Electronic Signature Consent' })).toBeInTheDocument();
        // The @a11y journey and three E2E specs click this exact name.
        expect(screen.getByRole('button', { name: /I Agree - Proceed to Sign/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    });

    it('names the document being signed and falls back when absent', () => {
        const view = render(<EsignConsentScreen title="Artificial Offer Letter" onAgree={vi.fn()} />);
        expect(screen.getByText('Artificial Offer Letter')).toBeInTheDocument();
        view.unmount();

        render(<EsignConsentScreen onAgree={vi.fn()} />);
        expect(screen.getByText('a document')).toBeInTheDocument();
    });

    it('keeps every disclosure clause in a labelled region', () => {
        render(<EsignConsentScreen title="Artificial Form" onAgree={vi.fn()} />);
        const disclosure = screen.getByRole('region', { name: /Electronic Records & Signature Disclosure/ });
        expect(disclosure).toBeInTheDocument();
        for (const clause of [
            /legally binding under the ESIGN Act/,
            /receive and sign this document electronically/,
            /withdraw consent and request a paper copy/,
            /compatible web browser with JavaScript enabled/,
            /IP address and browser information are recorded/,
        ]) {
            expect(screen.getByText(clause)).toBeInTheDocument();
        }
    });

    it('agrees through the callback and declines by closing the window', () => {
        const onAgree = vi.fn();
        render(<EsignConsentScreen title="Artificial Form" onAgree={onAgree} />);

        fireEvent.click(screen.getByRole('button', { name: /I Agree - Proceed to Sign/ }));
        expect(onAgree).toHaveBeenCalledTimes(1);
        expect(closeSpy).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('uses approved Buttons with the agree action as primary', () => {
        render(<EsignConsentScreen title="Artificial Form" onAgree={vi.fn()} />);
        const agree = screen.getByRole('button', { name: /I Agree - Proceed to Sign/ });
        expect(agree).toHaveClass('ds-button');
        expect(agree).toHaveAttribute('data-variant', 'primary');
        expect(screen.getByRole('button', { name: 'Decline' })).toHaveClass('ds-button');
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<EsignConsentScreen title="Artificial Form" onAgree={vi.fn()} />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('StatusScreens — presentation', () => {
    it('uses no legacy palette classes, raw hex or unsupported small text', () => {
        const views = [
            render(<SigningLoadingScreen />),
            render(<SigningErrorScreen error="Artificial reason." />),
            render(<SigningVoidedScreen />),
            render(<SigningSuccessScreen recipientName="Pat Example" onReturnToDocuments={vi.fn()} />),
            render(<EsignConsentScreen title="Artificial Form" onAgree={vi.fn()} />),
        ];
        for (const { container } of views) {
            expect(container.innerHTML).not.toMatch(/(bg|text|border)-(gray|blue|green|red|amber|yellow)-\d{2,3}/);
            expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
            expect(container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
        }
    });

    it('gives every screen a single level-one heading', () => {
        for (const element of [
            <SigningErrorScreen key="e" error="Artificial reason." />,
            <SigningVoidedScreen key="v" />,
            <SigningSuccessScreen key="s" recipientName="Pat Example" />,
            <EsignConsentScreen key="c" title="Artificial Form" onAgree={vi.fn()} />,
        ]) {
            const view = render(element);
            expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
            view.unmount();
        }
    });
});
