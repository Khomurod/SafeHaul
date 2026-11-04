/**
 * A document sent from a template to an applicant or lead the recruiter picked
 * is linked to that record (`sourceApplicationId` or `sourceLeadId`), which
 * files its sealed copy in the record's DQ file, and fills the record's listed
 * fields only: never its SSN or signature. A recipient typed in, or a name
 * changed after picking, links nothing. Date Signed still waits for the signer.
 * All names, addresses and ids are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ batchSet: vi.fn(), batchCommit: vi.fn() }));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    query: (ref) => ref,
    orderBy: () => ({}),
    limit: () => ({}),
    getDocs: async () => ({ docs: [] }),
    doc: (parent, ...segments) => ({ id: segments.length ? segments[segments.length - 1] : 'request-1', parent }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: mocks.batchSet, commit: mocks.batchCommit }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { useTemplateSendFlow } from './useTemplateSendFlow';

const text = (id, bindingKey, extra = {}) => ({
    id, type: 'text', label: id, bindingKey, defaultValue: '', prefillPolicy: 'locked',
    pageNumber: 1, xPosition: 10, yPosition: 10, width: 20, height: 4, ...extra,
});
const TEMPLATE = {
    id: 'template-1',
    title: 'Offer Letter',
    storagePath: 'secure_documents/co-1/templates/offer.pdf',
    fields: [
        text('name', 'full_name'),
        text('city', 'city'),
        text('cdl', 'cdl_number'),
        text('dob', 'dob'),
        text('mail', 'email'),
        text('ssn', 'ssn', { prefillPolicy: 'editable' }),
        text('secret', '', { defaultValue: 'SSN {{ssn}} / {{signature}}', prefillPolicy: 'editable' }),
        text('signedOn', 'current_date'),
    ],
};
const APPLICANT = {
    id: 'app-1',
    collectionName: 'applications',
    firstName: 'Jane',
    lastName: 'Driver',
    email: 'jane.driver@example.test',
    phone: '555-0100',
    city: 'Testville',
    dob: '1990-02-03',
    cdlNumber: 'D1234567',
    ssn: '123-45-6789',
    signature: 'TEXT_SIGNATURE:Jane Driver',
};
const LEAD = { id: 'lead-1', collectionName: 'leads', firstName: 'Dana', lastName: 'Alvarez', phone: '555-0101', city: 'Leadville' };

function open() {
    const toasts = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() };
    const { result } = renderHook(() => useTemplateSendFlow({
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight Co' },
        isE2EEdocMock: false,
        navigate: vi.fn(),
        setActiveTab: vi.fn(),
        ...toasts,
    }));
    act(() => result.current.handleUseTemplate(TEMPLATE));
    return { ...toasts, result };
}

const written = () => mocks.batchSet.mock.calls[0][1];
const valueOf = (id) => written().fields.find((field) => field.id === id).defaultValue;

beforeEach(() => {
    vi.resetAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
});

describe('a template sent to a picked applicant', () => {
    it('links the application and fills its listed fields', async () => {
        const { result, showError } = open();
        act(() => result.current.handleQuickSelect(APPLICANT));

        expect(result.current.manualName).toBe('Jane Driver');
        expect(result.current.manualEmail).toBe('jane.driver@example.test');
        expect(result.current.manualPhone).toBe('555-0100');
        expect(result.current.linkedRecord).toMatchObject({ collectionName: 'applications', id: 'app-1', name: 'Jane Driver' });

        await act(() => result.current.executeTemplateSend());

        expect(showError).not.toHaveBeenCalled();
        expect(written()).toMatchObject({ sourceApplicationId: 'app-1', recipientName: 'Jane Driver' });
        expect(written()).not.toHaveProperty('sourceLeadId');
        expect(valueOf('name')).toBe('Jane Driver');
        expect(valueOf('city')).toBe('Testville');
        expect(valueOf('cdl')).toBe('D1234567');
        expect(valueOf('dob')).toBe('1990-02-03');
        expect(written().fieldValues).toMatchObject({ city: 'Testville', cdl: 'D1234567' });
    });

    it('never puts its SSN or signature on the document', async () => {
        const { result } = open();
        act(() => result.current.handleQuickSelect(APPLICANT));
        await act(() => result.current.executeTemplateSend());

        expect(valueOf('ssn')).toBe('');
        expect(valueOf('secret')).toBe('SSN  / ');
        expect(JSON.stringify(written())).not.toMatch(/123-45-6789|TEXT_SIGNATURE/);
    });

    it('fills the email the recruiter corrected, and keeps the link', async () => {
        const { result } = open();
        act(() => result.current.handleQuickSelect(APPLICANT));
        act(() => result.current.setManualEmail('jane.new@example.test'));
        await act(() => result.current.executeTemplateSend());

        expect(written()).toMatchObject({ sourceApplicationId: 'app-1', recipientEmail: 'jane.new@example.test' });
        expect(valueOf('mail')).toBe('jane.new@example.test');
    });

    it('still leaves Date Signed for the signer to stamp', async () => {
        const { result } = open();
        act(() => result.current.handleQuickSelect(APPLICANT));
        await act(() => result.current.executeTemplateSend());

        expect(valueOf('signedOn')).toBe('{{current_date}}');
        expect(written().fieldValues).not.toHaveProperty('signedOn');
    });
});

describe('a template sent to a picked lead', () => {
    it('links the lead by its own field', async () => {
        const { result } = open();
        act(() => result.current.handleQuickSelect(LEAD));
        act(() => result.current.setManualEmail('dana@example.test'));
        await act(() => result.current.executeTemplateSend());

        expect(written()).toMatchObject({ sourceLeadId: 'lead-1', recipientName: 'Dana Alvarez' });
        expect(written()).not.toHaveProperty('sourceApplicationId');
        expect(valueOf('city')).toBe('Leadville');
    });
});

describe('a template sent to no record', () => {
    it('links nothing when the recipient is typed in', async () => {
        const { result } = open();
        act(() => {
            result.current.setManualName('Typed Person');
            result.current.setManualEmail('typed@example.test');
        });
        expect(result.current.linkedRecord).toBeNull();
        await act(() => result.current.executeTemplateSend());

        expect(written()).not.toHaveProperty('sourceApplicationId');
        expect(written()).not.toHaveProperty('sourceLeadId');
        expect(valueOf('city')).toBe('');
    });

    it('links nothing, and fills nothing of the record, once the name is someone else', async () => {
        const { result } = open();
        act(() => result.current.handleQuickSelect(APPLICANT));
        act(() => result.current.setManualName('John Other'));
        expect(result.current.linkedRecord).toBeNull();
        await act(() => result.current.executeTemplateSend());

        expect(written()).not.toHaveProperty('sourceApplicationId');
        expect(valueOf('name')).toBe('John Other');
        expect(valueOf('city')).toBe('');
    });

    it('forgets the record when another template is opened', () => {
        const { result } = open();
        act(() => result.current.handleQuickSelect(APPLICANT));
        act(() => result.current.handleUseTemplate(TEMPLATE));
        act(() => result.current.setManualName('Jane Driver'));

        expect(result.current.linkedRecord).toBeNull();
    });
});
