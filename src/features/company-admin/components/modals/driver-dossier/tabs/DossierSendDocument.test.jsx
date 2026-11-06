/**
 * Send a document from the dossier: the recruiter chooses one of the company's
 * templates, and E-Docs' own send wizard and write take over with this driver
 * already the recipient — name, email and phone filled in, the document linked
 * to the record (`sourceApplicationId` / `sourceLeadId`) and filled from its
 * listed fields only. The real flow (`useTemplateSendFlow`, `SendTemplateWizard`,
 * `createSigningRequest`) runs; the Firestore batch is a fake, so nothing is sent.
 * All names, ids and addresses are artificial.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const fx = vi.hoisted(() => ({ writes: [], commits: 0, toasts: [], templates: [], templatesLoading: false }));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'uid-ann', displayName: 'Ann Recruiter', email: 'ann@example.test' } },
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    doc: (parent, ...segments) => ({ id: segments.length ? segments[segments.length - 1] : 'request-1', parent }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({
        set: (ref, data) => fx.writes.push(data),
        commit: async () => { fx.commits += 1; },
    }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));
// The wizard's own list of applicants and leads; this driver is picked already.
vi.mock('@features/company-admin/hooks/pickerRecords', () => ({
    findPickerRecords: async () => [],
    matchPickerRecords: () => [],
}));
vi.mock('@features/company-admin/hooks/useCompanyTemplates', () => ({
    useCompanyTemplates: () => ({ templates: fx.templates, templatesLoading: fx.templatesLoading }),
}));
vi.mock('@shared/components/feedback', () => ({
    useToast: () => ({
        showSuccess: (text) => fx.toasts.push(['success', text]),
        showError: (text) => fx.toasts.push(['error', text]),
        showWarning: (text) => fx.toasts.push(['warning', text]),
    }),
}));

import { DossierSendDocument } from './DossierSendDocument';

const text = (id, bindingKey) => ({
    id, type: 'text', label: id, bindingKey, defaultValue: '', prefillPolicy: 'locked',
    pageNumber: 1, xPosition: 10, yPosition: 10, width: 20, height: 4,
});
const OFFER = {
    id: 'tpl-offer',
    title: 'Offer Letter',
    storagePath: 'secure_documents/co-1/templates/offer.pdf',
    fields: [text('name', 'full_name'), text('city', 'city'), text('ssn', 'ssn')],
};
const HANDBOOK = { id: 'tpl-hb', title: 'Driver Handbook', storagePath: 'secure_documents/co-1/templates/hb.pdf', fields: [] };
const COMPANY = { id: 'co-1', companyName: 'Artificial Freight Co', features: { eDocs: true } };
const APPLICANT = {
    id: 'app-1',
    collectionName: 'applications',
    firstName: 'Jane',
    lastName: 'Driver',
    email: 'jane.driver@example.test',
    phone: '555-0100',
    city: 'Testville',
    ssn: '123-45-6789',
};

const renderButton = (record = APPLICANT) => render(
    <MemoryRouter>
        <DossierSendDocument company={COMPANY} record={record} />
    </MemoryRouter>,
);
const chooser = () => screen.getByRole('dialog', { name: 'Send a document' });
const wizard = () => screen.getByRole('dialog', { name: 'Send Document' });

function chooseTemplate(title) {
    fireEvent.click(screen.getByRole('button', { name: 'Send a document' }));
    fireEvent.click(within(chooser()).getByRole('button', { name: new RegExp(title) }));
}

beforeEach(() => {
    fx.writes = [];
    fx.commits = 0;
    fx.toasts = [];
    fx.templates = [OFFER, HANDBOOK];
    fx.templatesLoading = false;
});

afterEach(cleanup);

describe('choosing the template', () => {
    it("lists the company's templates for this driver, and finds one by its title", () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Send a document' }));

        expect(chooser()).toHaveTextContent('Choose the template to send to Jane Driver.');
        expect(within(chooser()).getByRole('button', { name: /Offer Letter/ })).toBeInTheDocument();
        expect(within(chooser()).getByRole('button', { name: /Driver Handbook/ })).toBeInTheDocument();

        fireEvent.change(within(chooser()).getByLabelText('Search templates'), { target: { value: 'hand' } });
        expect(within(chooser()).queryByRole('button', { name: /Offer Letter/ })).toBeNull();
        expect(within(chooser()).getByRole('button', { name: /Driver Handbook/ })).toBeInTheDocument();
    });

    it('says when the company has no templates, and where they are made', () => {
        fx.templates = [];
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Send a document' }));
        expect(within(chooser()).getByRole('status')).toHaveTextContent('No templates saved yet. Templates are made in E-Docs.');
    });

    it('sends nothing when it is closed', () => {
        renderButton();
        fireEvent.click(screen.getByRole('button', { name: 'Send a document' }));
        fireEvent.click(within(chooser()).getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(fx.writes).toEqual([]);
    });
});

describe("E-Docs' send wizard, with this driver as the recipient", () => {
    it('opens on the recipient step with the driver filled in and picked', () => {
        renderButton();
        chooseTemplate('Offer Letter');

        expect(screen.queryByRole('dialog', { name: 'Send a document' })).toBeNull();
        expect(wizard()).toHaveTextContent('Sending: Offer Letter');
        expect(within(wizard()).getByLabelText(/Recipient name/)).toHaveValue('Jane Driver');
        expect(within(wizard()).getByLabelText('Email address')).toHaveValue('jane.driver@example.test');
        expect(within(wizard()).getByLabelText('Phone number')).toHaveValue('555-0100');
    });

    it("sends by E-Docs' write, linked to the application and filled from its listed fields only", async () => {
        renderButton();
        chooseTemplate('Offer Letter');
        fireEvent.click(within(wizard()).getByRole('button', { name: 'Continue' }));
        fireEvent.click(within(wizard()).getByRole('button', { name: 'Continue' }));
        expect(wizard()).toHaveTextContent('Jane Driver (applicant)');

        fireEvent.click(within(wizard()).getByRole('button', { name: /Send Document/ }));

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Send Document' })).toBeNull());
        expect(fx.commits).toBe(1);
        const [request] = fx.writes;
        expect(request).toMatchObject({
            title: 'Offer Letter',
            templateId: 'tpl-offer',
            companyId: 'co-1',
            recipientName: 'Jane Driver',
            recipientEmail: 'jane.driver@example.test',
            sourceApplicationId: 'app-1',
        });
        expect(request.fields.find((field) => field.id === 'city').defaultValue).toBe('Testville');
        expect(JSON.stringify(request)).not.toMatch(/123-45-6789/);
        expect(fx.toasts).toEqual([['success', 'Document created! Email delivery in progress...']]);
    });

    it("links a lead's document to the lead", async () => {
        renderButton({ id: 'lead-1', collectionName: 'leads', firstName: 'Dana', lastName: 'Alvarez', email: 'dana@example.test', phone: '555-0101' });
        chooseTemplate('Driver Handbook');
        fireEvent.click(within(wizard()).getByRole('button', { name: 'Continue' }));
        fireEvent.click(within(wizard()).getByRole('button', { name: 'Continue' }));
        fireEvent.click(within(wizard()).getByRole('button', { name: /Send Document/ }));

        await waitFor(() => expect(fx.commits).toBe(1));
        expect(fx.writes[0]).toMatchObject({ sourceLeadId: 'lead-1', recipientName: 'Dana Alvarez' });
        expect(fx.writes[0]).not.toHaveProperty('sourceApplicationId');
    });
});
