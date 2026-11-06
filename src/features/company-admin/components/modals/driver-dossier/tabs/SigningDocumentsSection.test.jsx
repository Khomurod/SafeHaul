/**
 * The dossier's signing documents (Documents tab): each document's title, state
 * and dates; Send to driver on a required form nobody sent, and Remind on one sent
 * by email or text, with what the server answered beside it; a signed copy
 * opened through `getSignedDocumentUrl`; where E-Docs is offered, Details (E-Docs'
 * own dialog and actions) and Send a document (its own suite:
 * `DossierSendDocument.test.jsx`). The data hook is replaced by rows built with
 * the real rules; the callables and the void transaction are fakes, so nothing is
 * sent. All names, ids and dates are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { recordDocumentRows } from '@features/company-admin/utils/recordSigningDocuments';
import { formatTimestamp } from '@features/company-admin/utils/documentsWorkspace';

const fx = vi.hoisted(() => ({
    data: null, calls: [], answers: {}, profile: null, claims: {}, toasts: [], stored: {}, updates: [], sendProps: null,
}));

vi.mock('@lib/firebase', () => ({
    functions: { __functions: true },
    db: {},
    auth: { currentUser: { uid: 'uid-ann', displayName: 'Ann Recruiter', email: 'ann@example.test' } },
}));
vi.mock('firebase/functions', () => ({
    getFunctions: () => ({ __functions: true }),
    httpsCallable: (_functions, name) => async (payload) => {
        fx.calls.push([name, payload]);
        return fx.answers[name](payload);
    },
}));
// Void's transaction, over the stored request.
vi.mock('firebase/firestore', () => ({
    doc: (_db, ...path) => ({ path: path.join('/') }),
    serverTimestamp: () => 'server-time',
    runTransaction: async (_db, work) => work({
        get: async (ref) => ({ exists: () => Boolean(fx.stored[ref.path]), data: () => fx.stored[ref.path] }),
        update: (ref, data) => fx.updates.push([ref.path, data]),
    }),
}));
vi.mock('@features/company-admin/hooks/useRecordSigningRequests', () => ({
    useRecordSigningRequests: () => fx.data,
}));
vi.mock('@/context/DataContext', () => ({
    useData: () => ({ currentCompanyProfile: fx.profile, currentUserClaims: fx.claims }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({
        showSuccess: (text) => fx.toasts.push(['success', text]),
        showError: (text) => fx.toasts.push(['error', text]),
    }),
}));
vi.mock('./DossierSendDocument', () => ({
    DossierSendDocument: (props) => {
        fx.sendProps = props;
        return <button type="button">Send a document</button>;
    },
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

const DRIVER = { firstName: 'Dana', lastName: 'Driver', email: 'dana@example.test', phone: '5550100' };
const renderSection = (collectionName = 'applications', recordId = 'app-1', record = DRIVER) => render(
    <SigningDocumentsSection companyId="co-1" recordId={recordId} collectionName={collectionName} record={record} />,
);
const rowOf = (title) => screen.getByRole('heading', { name: title, level: 4 }).closest('li');

beforeEach(() => {
    fx.calls = [];
    fx.answers = {};
    fx.profile = { id: 'co-1', companyName: 'Artificial Freight Co', features: { eDocs: true } };
    fx.claims = { roles: { 'co-1': 'recruiter' } };
    fx.toasts = [];
    fx.stored = {};
    fx.updates = [];
    fx.sendProps = null;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('what the section lists', () => {
    it('shows each document\'s title, state and dates, a required form nobody started first', () => {
        withRows();
        renderSection();

        // The tab's label is its one heading: the section repeats it in none.
        expect(screen.queryByRole('heading', { name: /Signing documents|Documents to sign/ })).toBeNull();
        const items = within(screen.getByRole('list')).getAllByRole('listitem');
        expect(items.map((item) => within(item).getByRole('heading', { level: 4 }).textContent))
            .toEqual(['W-9', 'Handbook', 'Offer Letter']);

        expect(rowOf('W-9')).toHaveTextContent('Not started');
        expect(rowOf('W-9')).toHaveTextContent('Required after applying; not sent yet');
        expect(rowOf('Handbook')).toHaveTextContent('Link expired');
        expect(rowOf('Handbook')).toHaveTextContent(`Created ${formatTimestamp(at(-9))}`);
        expect(rowOf('Handbook')).toHaveTextContent(`Link expired ${formatTimestamp(at(-2))}`);
        expect(rowOf('Offer Letter')).toHaveTextContent('Signed');
        expect(rowOf('Offer Letter')).toHaveTextContent(`Signed ${formatTimestamp(at(-19))}`);
    });

    it('says a document still with its signer was not delivered, with the reason, and keeps Remind', () => {
        withRows({ requests: [{
            id: 'r-lease', templateId: 'tpl-lease', title: 'Lease', status: 'sent', sendEmail: true,
            recipientEmail: 'dana@example.test', emailStatus: 'failed', emailError: 'Mailbox unavailable (artificial)',
            createdAt: at(-2), expiresAt: at(5),
        }] });
        renderSection();

        const row = rowOf('Lease');
        expect(within(row).getByText('Not delivered').closest('.ds-badge')).toHaveAttribute('data-tone', 'danger');
        expect(row).toHaveTextContent('Email not delivered: Mailbox unavailable (artificial)');
        expect(row).not.toHaveTextContent('Awaiting signature');
        expect(within(row).getByRole('button', { name: 'Remind — Lease' })).toBeInTheDocument();
    });

    it('says what a signed or voided document is, without its old failed send', () => {
        withRows({ requests: [
            { id: 'r-void', templateId: 'tpl-a', title: 'Lease', status: 'voided', emailStatus: 'failed', emailError: 'SMTP 550 (artificial)', createdAt: at(-3) },
            { ...REQUESTS[1], smsStatus: 'failed', smsError: 'Line unavailable (artificial)' },
        ] });
        renderSection();

        expect(rowOf('Lease')).toHaveTextContent('Voided');
        expect(rowOf('Offer Letter')).toHaveTextContent('Signed');
        expect(screen.queryByText('Not delivered')).toBeNull();
        expect(screen.queryByText(/not delivered/)).toBeNull();
    });

    it('notes a text skipped for an opted-out number without calling it a failure', () => {
        withRows({ requests: [{
            id: 'r-lease', templateId: 'tpl-lease', title: 'Lease', status: 'sent', sendEmail: true, sendSms: true,
            recipientEmail: 'dana@example.test', emailStatus: 'sent', smsStatus: 'skipped',
            smsNote: 'Not texted: this number opted out of texts.', createdAt: at(-2), expiresAt: at(5),
        }] });
        renderSection();

        const row = rowOf('Lease');
        expect(row).toHaveTextContent('Awaiting signature');
        const note = within(row).getByText('Not texted: this number opted out of texts.');
        expect(note.className).not.toMatch(/danger/);
        expect(within(row).queryByText('Not delivered')).toBeNull();
    });

    it('notes the skipped text beside a failed email too: neither reached the signer', () => {
        withRows({ requests: [{
            id: 'r-lease', templateId: 'tpl-lease', title: 'Lease', status: 'sent', sendEmail: true, sendSms: true,
            recipientEmail: 'dana@example.test', emailStatus: 'failed', emailError: 'Mailbox unavailable (artificial)',
            smsStatus: 'skipped', smsNote: 'Not texted: this number opted out of texts.', createdAt: at(-2), expiresAt: at(5),
        }] });
        renderSection();

        const row = rowOf('Lease');
        expect(within(row).getByText('Not delivered')).toBeInTheDocument();
        expect(row).toHaveTextContent('Email not delivered: Mailbox unavailable (artificial)');
        expect(within(row).getByText('Not texted: this number opted out of texts.').className).not.toMatch(/danger/);
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
        rerender(<SigningDocumentsSection companyId="co-1" recordId="app-1" collectionName="applications" record={DRIVER} />);
        expect(screen.getByRole('status')).toHaveTextContent('Loading signing documents…');

        fx.data = { ...fx.data, isLoading: false, error: 'Could not load this driver\'s signing documents.' };
        rerender(<SigningDocumentsSection companyId="co-1" recordId="app-1" collectionName="applications" record={DRIVER} />);
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
        rerender(<SigningDocumentsSection companyId="co-1" recordId="app-1" collectionName="applications" record={DRIVER} />);

        expect(rowOf('W-9')).toHaveTextContent('Awaiting signature');
        expect(within(rowOf('W-9')).getByRole('status')).toHaveTextContent('Sent to the driver by email.');
        expect(within(rowOf('W-9')).queryByRole('button', { name: /Send to driver/ })).toBeNull();
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

describe('Remind', () => {
    const LEASE = {
        id: 'r-lease', templateId: 'tpl-lease', title: 'Lease', status: 'sent', sendEmail: true, recipientEmail: 'dana@example.test',
        createdAt: at(-8), expiresAt: at(-1),
    };
    const SENT_FORM = {
        id: 'postapp_app-1_tpl-w9', templateId: 'tpl-w9', title: 'W-9', status: 'sent', sendEmail: true, recipientEmail: 'dana@example.test',
        createdAt: at(-3), expiresAt: at(4),
    };

    it('is offered on a document sent by email or text, its link expired or not, named after it, and on nothing else', () => {
        withRows({ requests: [...REQUESTS, LEASE, SENT_FORM] });
        renderSection();

        expect(screen.getAllByRole('button', { name: /^Remind/ }).map((b) => b.textContent))
            .toEqual(['Remind — W-9', 'Remind — Lease']);
        // The thank-you page's form nobody sent keeps Send to driver; a signed one has neither.
        expect(within(rowOf('Handbook')).queryByRole('button', { name: /Remind/ })).toBeNull();
        expect(within(rowOf('Offer Letter')).queryByRole('button', { name: /Remind/ })).toBeNull();
        expect(within(rowOf('Lease')).queryByRole('button', { name: /Send to driver/ })).toBeNull();
    });

    it('asks the server to remind that document, and says how it went beside it', async () => {
        withRows({ requests: [...REQUESTS, LEASE] });
        fx.answers.remindSigner = () => ({ data: { success: true, requestId: 'r-lease', channels: { email: true, sms: false } } });
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Remind — Lease' }));

        await waitFor(() => expect(within(rowOf('Lease')).getByRole('status'))
            .toHaveTextContent('Reminder sent by email. The link works for seven more days.'));
        expect(fx.calls).toEqual([['remindSigner', { companyId: 'co-1', requestId: 'r-lease' }]]);
    });

    it('shows the server\'s reason beside the document when nothing was sent', async () => {
        withRows({ requests: [...REQUESTS, LEASE] });
        fx.answers.remindSigner = () => {
            throw Object.assign(new Error('A reminder was sent less than ten minutes ago. You can send another in 8 minutes.'), {
                code: 'functions/failed-precondition',
            });
        };
        vi.spyOn(console, 'error').mockImplementation(() => {});
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Remind — Lease' }));

        await waitFor(() => expect(within(rowOf('Lease')).getByRole('status'))
            .toHaveTextContent('You can send another in 8 minutes.'));
    });

    it('is offered on a lead\'s document too', () => {
        withRows({ forms: [], applicationId: null, requests: [LEASE] });
        renderSection('leads', 'lead-1');
        expect(screen.getByRole('button', { name: 'Remind — Lease' })).toBeInTheDocument();
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

describe('Details', () => {
    const LEASE = {
        id: 'r-lease', templateId: 'tpl-lease', title: 'Lease', status: 'sent', sendEmail: true,
        recipientName: 'Dana Driver', recipientEmail: 'dana@example.test', deliveryMethod: 'email',
        createdAt: at(-2), expiresAt: at(5),
    };
    const SEAL_FAILED = {
        id: 'r-seal', templateId: 'tpl-seal', title: 'Drug Policy', status: 'error_sealing',
        recipientName: 'Dana Driver', errorLog: 'Seal failed (artificial)', createdAt: at(-3), signedAt: at(-1),
    };
    const detailsOf = (title) => screen.getByRole('dialog', { name: title });

    it('is offered on every sent document, named after it, and not on a form nobody sent', () => {
        withRows({ requests: [...REQUESTS, LEASE] });
        renderSection();

        expect(screen.getAllByRole('button', { name: /^Details/ }).map((b) => b.textContent))
            .toEqual(['Details — Lease', 'Details — Handbook', 'Details — Offer Letter']);
        expect(within(rowOf('W-9')).queryByRole('button', { name: /Details/ })).toBeNull();
    });

    it("opens E-Docs' details dialog for the document, and Remind there asks the server for that document", async () => {
        withRows({ requests: [LEASE] });
        fx.answers.remindSigner = () => ({ data: { success: true, requestId: 'r-lease', channels: { email: true, sms: false } } });
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Details — Lease' }));
        const dialog = detailsOf('Lease');
        expect(dialog).toHaveTextContent('dana@example.test');
        expect(within(dialog).getByRole('button', { name: /Void/ })).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Remind' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lease' })).toBeNull());
        expect(fx.calls).toEqual([['remindSigner', { companyId: 'co-1', requestId: 'r-lease' }]]);
    });

    it('offers Retry seal on a document whose seal failed, and seals that document again', async () => {
        withRows({ requests: [SEAL_FAILED] });
        fx.answers.retrySealDocument = () => ({ data: { success: true } });
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Details — Drug Policy' }));
        expect(detailsOf('Drug Policy')).toHaveTextContent('Seal failed (artificial)');
        fireEvent.click(within(detailsOf('Drug Policy')).getByRole('button', { name: 'Retry seal' }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Drug Policy' })).toBeNull());
        expect(fx.calls).toEqual([['retrySealDocument', { companyId: 'co-1', requestId: 'r-seal' }]]);
        expect(fx.toasts).toEqual([['success', 'Sealing again. The status here changes when it finishes.']]);
    });

    it('voids only after asking, by the same transaction as E-Docs, recording who voided it', async () => {
        withRows({ requests: [LEASE] });
        fx.stored['companies/co-1/signing_requests/r-lease'] = { status: 'sent' };
        renderSection();

        fireEvent.click(screen.getByRole('button', { name: 'Details — Lease' }));
        fireEvent.click(within(detailsOf('Lease')).getByRole('button', { name: /Void/ }));
        expect(fx.updates).toEqual([]);
        fireEvent.click(within(screen.getByRole('dialog', { name: 'Void "Lease"?' })).getByRole('button', { name: 'Void document' }));

        await waitFor(() => expect(fx.toasts).toEqual([['success', 'Document voided successfully.']]));
        expect(fx.updates).toEqual([['companies/co-1/signing_requests/r-lease', {
            status: 'voided', voidedAt: 'server-time', voidedBy: 'uid-ann', voidedByName: 'Ann Recruiter',
        }]]);
    });
});

describe('Send a document', () => {
    it('is offered with E-Docs, for this driver as the wizard lists one', () => {
        withRows({ forms: [], applicationId: null });
        renderSection('leads', 'lead-1');

        expect(screen.getByRole('button', { name: 'Send a document' })).toBeInTheDocument();
        expect(fx.sendProps.company).toBe(fx.profile);
        expect(fx.sendProps.record).toEqual({ ...DRIVER, id: 'lead-1', collectionName: 'leads' });
    });

    it('is not offered while the record is not loaded', () => {
        withRows();
        renderSection('applications', 'app-1', null);
        expect(screen.queryByRole('button', { name: 'Send a document' })).toBeNull();
    });
});

describe('where E-Docs is not offered', () => {
    it.each([
        ['E-Docs is off for the company', () => { fx.profile = { ...fx.profile, features: { eDocs: false } }; }],
        ['the dossier is for another company than the one worked in', () => { fx.profile = { ...fx.profile, id: 'co-2' }; }],
        ['no company is worked in', () => { fx.profile = null; }],
    ])('offers neither Details nor Send a document when %s', (_when, arrange) => {
        arrange();
        withRows();
        renderSection();

        expect(screen.queryByRole('button', { name: /^Details/ })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send a document' })).toBeNull();
        // The tab's own actions stay.
        expect(screen.getByRole('button', { name: 'Send to driver — W-9' })).toBeInTheDocument();
    });
});

describe('accessibility', () => {
    it('has no axe violations with every kind of row and a message shown', async () => {
        withRows({ requests: [...REQUESTS, {
            id: 'r-lease', templateId: 'tpl-lease', title: 'Lease', status: 'sent', sendEmail: true,
            recipientEmail: 'dana@example.test', createdAt: at(-8), expiresAt: at(-1),
        }] });
        vi.spyOn(window, 'open').mockReturnValue(null);
        const { container } = renderSection();
        fireEvent.click(screen.getByRole('button', { name: /Open signed copy of Offer Letter/ }));

        expect((await axe(container)).violations).toEqual([]);
    });
});
