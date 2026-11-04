/**
 * A document sent from a template starts with the template's company signature
 * and may carry its own image instead, without touching the template. It is
 * never sent while a company signature has no image. All names and paths are
 * artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
}));

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

const TEMPLATE_IMAGE = 'secure_documents/co-1/originals/company-signatures/template.png';
const OWN_IMAGE = 'secure_documents/co-1/originals/company-signatures/own.png';
const MISSING = 'Upload the company signature image before sending. A company signature on this document has no image yet.';

const template = (companySignaturePath) => ({
    id: 'template-1',
    title: 'Offer Letter',
    storagePath: 'secure_documents/co-1/templates/offer.pdf',
    fields: [
        { id: 'sig-1', type: 'signature', label: 'Signature', xPosition: 10, yPosition: 80, width: 30, height: 5, pageNumber: 1, required: true },
        {
            id: 'cs-1', type: 'company_signature', label: 'Company Signature', xPosition: 60, yPosition: 80, width: 25, height: 8,
            pageNumber: 1, required: false, readOnly: true, prefillPolicy: 'locked', bindingKey: '', prefillGroupKey: '',
            defaultValue: '', fontSize: 'Auto', companySignaturePath,
        },
    ],
});

function open(selectedTemplate) {
    const toasts = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() };
    const { result } = renderHook(() => useTemplateSendFlow({
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight Co' },
        isE2EEdocMock: false,
        navigate: vi.fn(),
        setActiveTab: vi.fn(),
        ...toasts,
    }));
    act(() => result.current.handleUseTemplate(selectedTemplate));
    act(() => {
        result.current.setManualName('Dana Driver');
        result.current.setManualEmail('dana@example.test');
    });
    return { ...toasts, result };
}

const sentCompanySignature = () => mocks.batchSet.mock.calls[0][1].fields.find((field) => field.type === 'company_signature');

beforeEach(() => {
    vi.resetAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
});

describe('useTemplateSendFlow with a company signature', () => {
    it('sends the template image when the document has none of its own', async () => {
        const { result, showError } = open(template(TEMPLATE_IMAGE));
        expect(result.current.companySignature.fields).toEqual([
            expect.objectContaining({ id: 'cs-1', companySignaturePath: TEMPLATE_IMAGE }),
        ]);

        await act(() => result.current.executeTemplateSend());

        expect(showError).not.toHaveBeenCalled();
        expect(sentCompanySignature()).toMatchObject({ companySignaturePath: TEMPLATE_IMAGE, readOnly: true, prefillPolicy: 'locked' });
    });

    it('sends this document its own image and leaves the template as it was', async () => {
        const selected = template(TEMPLATE_IMAGE);
        const { result } = open(selected);

        act(() => result.current.companySignature.replace('cs-1', OWN_IMAGE));
        expect(result.current.companySignature.fields[0].companySignaturePath).toBe(OWN_IMAGE);
        await act(() => result.current.executeTemplateSend());

        expect(sentCompanySignature().companySignaturePath).toBe(OWN_IMAGE);
        expect(selected.fields[1].companySignaturePath).toBe(TEMPLATE_IMAGE);
    });

    it('is refused while the company signature has no image, and nothing is written', async () => {
        const { result, showError } = open(template(''));

        await act(() => result.current.executeTemplateSend());

        expect(showError).toHaveBeenCalledWith(MISSING);
        expect(mocks.batchSet).not.toHaveBeenCalled();
        expect(result.current.showDriverPicker).toBe(true);
    });

    it('sends once this document has its own image', async () => {
        const { result, showError } = open(template(''));

        act(() => result.current.companySignature.replace('cs-1', OWN_IMAGE));
        await act(() => result.current.executeTemplateSend());

        expect(showError).not.toHaveBeenCalled();
        expect(sentCompanySignature().companySignaturePath).toBe(OWN_IMAGE);
    });

    it('forgets the last document\'s image when another template is opened', () => {
        const { result } = open(template(''));
        act(() => result.current.companySignature.replace('cs-1', OWN_IMAGE));

        act(() => result.current.handleUseTemplate(template('')));

        expect(result.current.companySignature.fields[0].companySignaturePath).toBe('');
    });
});
