// Focused coverage for the public signing room's full-page status screens.
// The strings the signing E2E specs and the @a11y journey assert are pinned. All
// fixtures are artificial; no real recipient or document data appears.
//
// `window.close` is stubbed in every test and must never be called: a browser
// refuses to close a tab opened from an email or a text, so a button that tries
// is a button that does nothing. Each screen that ends the visit says so instead.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    SigningLoadingScreen,
    SigningVoidedScreen,
    SigningSuccessScreen,
    SigningAlreadySignedScreen,
    SigningDeclinedScreen,
    EsignConsentScreen,
} from './StatusScreens';

let closeSpy;

beforeEach(() => {
    closeSpy = vi.fn();
    vi.stubGlobal('close', closeSpy);
});

afterEach(() => {
    expect(closeSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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

describe('SigningVoidedScreen', () => {
    it('keeps the exact voided wording and says the tab can be closed', () => {
        render(<SigningVoidedScreen />);
        expect(screen.getByRole('heading', { level: 1, name: 'Document Voided' })).toBeInTheDocument();
        expect(screen.getByText(/voided by the sender and is no longer accessible/)).toHaveTextContent(/You can close this tab\.$/);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

    it('says the tab can be closed, with no button that cannot close it', () => {
        render(<SigningSuccessScreen recipientName="Pat Example" />);
        expect(screen.getByText(/securely sealed/)).toHaveTextContent(/You can close this tab\.$/);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers the return to the required documents when a return path exists', () => {
        const onReturnToDocuments = vi.fn();
        render(<SigningSuccessScreen recipientName="Pat Example" onReturnToDocuments={onReturnToDocuments} />);

        const buttons = screen.getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Return to Required Documents');
        expect(buttons[0]).toHaveAttribute('data-variant', 'primary');
        expect(screen.queryByText(/close this tab/)).not.toBeInTheDocument();

        fireEvent.click(buttons[0]);
        expect(onReturnToDocuments).toHaveBeenCalledTimes(1);
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

describe('SigningAlreadySignedScreen', () => {
    it('says the document is signed, when, and that there is nothing more to do', () => {
        render(<SigningAlreadySignedScreen signedAt="2026-11-02T15:00:00.000Z" />);
        expect(screen.getByRole('heading', { level: 1, name: 'This document is already signed' })).toBeInTheDocument();
        const said = screen.getByText(/nothing more to do/);
        expect(said).toHaveTextContent(/It was signed on November 2, 2026\./);
        expect(said).toHaveTextContent(/You can close this tab\.$/);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('leaves the date out when the page does not know it', () => {
        render(<SigningAlreadySignedScreen />);
        expect(screen.getByText(/nothing more to do/)).toHaveTextContent('There is nothing more to do here. You can close this tab.');
    });

    it('takes a driver back to the required documents', () => {
        const onReturnToDocuments = vi.fn();
        render(<SigningAlreadySignedScreen onReturnToDocuments={onReturnToDocuments} />);
        fireEvent.click(screen.getByRole('button', { name: 'Return to Required Documents' }));
        expect(onReturnToDocuments).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<SigningAlreadySignedScreen signedAt="2026-11-02T15:00:00.000Z" />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('SigningDeclinedScreen', () => {
    it('says nothing was signed, how to sign on paper, and that the tab can be closed', () => {
        render(<SigningDeclinedScreen onGoBack={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1, name: 'You did not agree to sign electronically' })).toHaveFocus();
        expect(screen.getByText(/Nothing was signed/)).toHaveTextContent(
            'Nothing was signed. To sign on paper instead, contact the sender. You can close this tab.',
        );
    });

    it('goes back to the consent for a press made by mistake', () => {
        const onGoBack = vi.fn();
        render(<SigningDeclinedScreen onGoBack={onGoBack} />);
        fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
        expect(onGoBack).toHaveBeenCalledTimes(1);
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<SigningDeclinedScreen onGoBack={vi.fn()} />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('EsignConsentScreen', () => {
    it('keeps the exact consent heading and the frozen agree label', () => {
        render(<EsignConsentScreen title="Artificial Offer Letter" onAgree={vi.fn()} onDecline={vi.fn()} />);
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

    it('agrees and declines through its callbacks, never by closing the window', () => {
        const onAgree = vi.fn();
        const onDecline = vi.fn();
        render(<EsignConsentScreen title="Artificial Form" onAgree={onAgree} onDecline={onDecline} />);

        fireEvent.click(screen.getByRole('button', { name: /I Agree - Proceed to Sign/ }));
        expect(onAgree).toHaveBeenCalledTimes(1);
        expect(onDecline).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
        expect(onDecline).toHaveBeenCalledTimes(1);
    });

    it('uses approved Buttons with the agree action as primary', () => {
        render(<EsignConsentScreen title="Artificial Form" onAgree={vi.fn()} onDecline={vi.fn()} />);
        const agree = screen.getByRole('button', { name: /I Agree - Proceed to Sign/ });
        expect(agree).toHaveClass('ds-button');
        expect(agree).toHaveAttribute('data-variant', 'primary');
        expect(screen.getByRole('button', { name: 'Decline' })).toHaveClass('ds-button');
    });

    it('has no accessibility violations', async () => {
        const { container } = render(<EsignConsentScreen title="Artificial Form" onAgree={vi.fn()} onDecline={vi.fn()} />);
        expect((await axe(container)).violations).toEqual([]);
    });
});

describe('StatusScreens — presentation', () => {
    const SCREENS = () => [
        <SigningVoidedScreen key="v" />,
        <SigningSuccessScreen key="s" recipientName="Pat Example" onReturnToDocuments={vi.fn()} />,
        <SigningAlreadySignedScreen key="a" signedAt="2026-11-02T15:00:00.000Z" />,
        <SigningDeclinedScreen key="d" onGoBack={vi.fn()} />,
        <EsignConsentScreen key="c" title="Artificial Form" onAgree={vi.fn()} onDecline={vi.fn()} />,
    ];

    it('uses no legacy palette classes, raw hex or unsupported small text', () => {
        for (const element of [<SigningLoadingScreen key="l" />, ...SCREENS()]) {
            const { container, unmount } = render(element);
            expect(container.innerHTML).not.toMatch(/(bg|text|border)-(gray|blue|green|red|amber|yellow)-\d{2,3}/);
            expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
            expect(container.innerHTML).not.toMatch(/text-\[(9|10|11)px\]/);
            unmount();
        }
    });

    it('gives every screen a single level-one heading', () => {
        for (const element of SCREENS()) {
            const view = render(element);
            expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
            view.unmount();
        }
    });
});
