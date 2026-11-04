/**
 * The dossier's signing documents (Documents tab): each document's title, state
 * and dates; Send to driver on a required form nobody sent, with what the server
 * answered beside it; a signed copy opened through `getSignedDocumentUrl`. The
 * data hook is replaced by rows built with the real rules; the callables are
 * fakes. All names, ids and dates are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { recordDocumentRows } from '@features/company-admin/utils/recordSigningDocuments';
import { formatTimestamp } from '@features/company-admin/utils/documentsWorkspace';

const fx = vi.hoisted(() => ({ data: null, calls: [], answers: {} }));

vi.mock('@lib/firebase', () => ({ functions: { __functions: true }, db: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => async (payload) => {
        fx.calls.push([name, payload]);
        return fx.answers[name](payload);
    },
}));
vi.mock('@features/company-admin/hooks/useRecordSigningRequests', () => ({
    useRecordSigningRequests: () => fx.data,
}));

import { SigningDocumentsSection } from './SigningDocumentsSection';

const NOW = Date.now();
const at = (days) => ({ toMillis: () => NOW + days * 24 * 60 * 60 * 1000 });
const FORMS = [{ templateId: 'tpl-w9', title: 'W-9', enabled: true, required: true, order: 0 }];
const REQUESTS = [
    {
        id: 'postapp_app-1_tpl-hb', templateId: 'tpl-hb', title: 'Handbook', status: 'sent',
        sendEmail: false, sendSms: false, createdAt: at(-9), expiresAt: at(-2),
    },
    {
        id: 'r-offer', templateId: 'tpl-offer', title: 'Offer Letter', status: 'signed',
        createdAt: at(-20), signedAt: at(-19), signedPdfUrl: 'secure_documents/co-1/completed/r-offer_signed.pdf',
    },
];
const FORMS_WITH_HANDBOOK = [...FORMS, { templateId: 'tpl-hb', title: 'Handbook', enabled: true, required: true, order: 1 }];

function withRows({ requests = REQUESTS, forms = FORMS_WITH_HANDBOOK, applicationId = 'app-1', ...state } = {}) {
    fx.data = {
        rows: recordDocumentRows({ requests, forms, applicationId, now: NOW }),
        isLoading: false,
        error: null,
        formsError: null,
        ...state,
    };
}

const renderSection = (collectionName = 'applications', recordId = 'app-1') => render(
    <SigningDocumentsSection companyId="co-1" recordId={recordId} collectionName={collectionName} />,
);
const rowOf = (title) => screen.getByRole('heading', { name: title, level: 5 }).closest('li');

beforeEach(() => {
    fx.calls = [];
    fx.answers = {};
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('what the section lists', () => {
    it('shows each document\'s title, state and dates, a required form nobody started first', () => {
        withRows();
        renderSection();

        expect(screen.getByRole('heading', { name: 'Signing documents', level: 4 })).toBeInTheDocument();
        const items = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(items.map((item) => within(item).getByRole('heading', { level: 5 }).textContent))
            .toEqual(['W-9', 'Handbook', 'Offer Letter']);

        expect(rowOf('W-9')).toHaveTextContent('Not started');
        expect(rowOf('W-9')).toHaveTextContent('Required after applying; not sent yet');
        expect(rowOf('Handbook')).toHaveTextContent('Link expired');
        expect(rowOf('Handbook')).toHaveTextContent(`Created ${formatTimestamp(at(-9))}`);
        expect(rowOf('Handbook')).toHaveTextContent(`Link expired ${formatTimestamp(at(-2))}`);
        expect(rowOf('Offer Letter')).toHaveTextContent('Signed');
        expect(rowOf('Offer Letter')).toHaveTextContent(`Signed ${formatTimestamp(at(-19))}`);
    });

    it('offers Send to driver on the forms nobody sent, named after each form, and on nothing else', () => {
        withRows();
        renderSection();

        expect(screen.getAllByRole('button', { name: /^Send to driver/ }).map((b) => b.textContent))
            .toEqual(['Send to driver — W-9', 'Send to driver — Handbook']);
        expect(within(rowOf('Offer Letter')).queryByRole('button', { name: /Send to driver/ })).toBeNull();
    });

    it('offers no Send to driver for a lead', () => {
        withRows({ forms: [], applicationId: null, requests: [{ ...REQUESTS[0], id: 'r-lead' }] });
        renderSection('leads', 'lead-1');
        expect(screen.queryByRole('button', { name: /Send to driver/ })).toBeNull();
    });

    it('says when there is nothing yet, while it loads, and when it cannot load', () => {
        withRows({ requests: [], forms: [] });
        const { rerender } = renderSection();
        expect(screen.getByRole('status')).toHaveTextContent('No signing documents for this driver yet.');

        fx.data = { ...fx.data, isLoading: true };
        rerender(<SigningDocumentsSection companyId="co-1" recordId="app-1" collectionName="applications" />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading signing documents…');

        fx.data = { ...fx.data, isLoading: false, error: 'Could not load this driver\'s signing documents.' };
        rerender(<SigningDocumentsSection companyId="co-1" recordId="app-1" collectionName="applications" />);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not load this driver\'s signing documents.');
    });

    it('still lists the documents when the company\'s forms could not be read, and says so', () => {
        withRows({ forms: [], formsError: 'Could not load the company\'s post-application forms.' });
        renderSection();
        expect(screen.getByText('Could not load the company\'s post-application forms.')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
    });
});

describe('Send to driver', () => {
    it('asks the server to send that form of this application, and says how it went', async () => {
        withRows();
        fx.answers.sendPostApplicationDocument = () => ({
            data: { success: true, requestId: 'postapp_app-1_tpl-w9', outcome: 'sent', channels: { email: true, sms: true } },
        });
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Send to driver — W-9' }));

        await waitFor(() => expect(within(rowOf('W-9')).getByRole('status'))
            .toHaveTextContent('Sent to the driver by email and text message.'));
        expect(fx.calls).toEqual([['sendPostApplicationDocument', {
            companyId: 'co-1',
            applicationId: 'app-1',
            templateId: 'tpl-w9',
            appBaseUrl: window.location.origin,
        }]]);
    });

    it('keeps the message beside the form once the live list shows it sent, without the button', async () => {
        withRows();
        fx.answers.sendPostApplicationDocument = () => ({
            data: { success: true, requestId: 'postapp_app-1_tpl-w9', outcome: 'sent', channels: { email: true, sms: false } },
        });
        const { rerender } = renderSection();
        fireEvent.click(screen.getByRole('button', { name: 'Send to driver — W-9' }));
        await waitFor(() => expect(within(rowOf('W-9')).getByRole('status')).toHaveTextContent('Sent to the driver by email.'));

        withRows({
            requests: [...REQUESTS, {
                id: 'postapp_app-1_tpl-w9', templateId: 'tpl-w9', title: 'W-9', status: 'sent',
                sendEmail: true, sendSms: false, createdAt: at(0), expiresAt: at(7),
            }],
        });
        rerender(<SigningDocumentsSection companyId="co-1" recordId="app-1" collectionName="applications" />);

        expect(rowOf('W-9')).toHaveTextContent('Awaiting signature');
        expect(within(rowOf('W-9')).getByRole('status')).toHaveTextContent('Sent to the driver by email.');
        expect(within(rowOf('W-9')).queryByRole('button')).toBeNull();
    });

    it('shows the server\'s reason beside the form when nothing could be sent', async () => {
        withRows();
        fx.answers.sendPostApplicationDocument = () => {
            throw Object.assign(new Error('Not sent: this application has no email address we can use, and the driver did not answer Yes to text messages.'), {
                code: 'functions/failed-precondition',
            });
        };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Send to driver — Handbook' }));

        await waitFor(() => expect(within(rowOf('Handbook')).getByRole('status'))
            .toHaveTextContent('Not sent: this application has no email address we can use'));
        expect(within(rowOf('W-9')).getByRole('status')).toBeEmptyDOMElement();
    });
});

describe('a signed copy', () => {
    it('opens in a tab opened by the press, at a link signed for its stored file', async () => {
        withRows();
        const tab = { opener: 'page', location: { href: '' }, close: vi.fn() };
        vi.spyOn(window, 'open').mockReturnValue(tab);
        fx.answers.getSignedDocumentUrl = () => ({ data: { success: true, url: 'https://storage.example.test/signed.pdf' } });
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Open signed copy of Offer Letter (opens in a new tab)' }));

        expect(window.open).toHaveBeenCalledWith('', '_blank');
        await waitFor(() => expect(tab.location.href).toBe('https://storage.example.test/signed.pdf'));
        expect(tab.opener).toBeNull();
        expect(fx.calls).toEqual([['getSignedDocumentUrl', { storagePath: 'secure_documents/co-1/completed/r-offer_signed.pdf' }]]);
    });

    it('says so when the browser blocks the tab', () => {
        withRows();
        vi.spyOn(window, 'open').mockReturnValue(null);
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: /Open signed copy of Offer Letter/ }));

        expect(within(rowOf('Offer Letter')).getByRole('status')).toHaveTextContent('Your browser blocked the new tab.');
        expect(fx.calls).toEqual([]);
    });
});

describe('accessibility', () => {
    it('has no axe violations with every kind of row and a message shown', async () => {
        withRows();
        vi.spyOn(window, 'open').mockReturnValue(null);
        const { container } = renderSection();
        fireEvent.click(screen.getByRole('button', { name: /Open signed copy of Offer Letter/ }));

        expect((await axe(container)).violations).toEqual([]);
    });
});
