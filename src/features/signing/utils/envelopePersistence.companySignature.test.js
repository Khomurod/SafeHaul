/**
 * A company signature travels with every save, and a document is never sent
 * while one has no image. A template may be saved with an empty one: its image
 * can come with each document instead. All names and paths are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    updateDoc: vi.fn(),
    addDoc: vi.fn(),
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
    uploadBytes: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
    ref: (_storage, path) => ({ path }),
    uploadBytes: (...args) => mocks.uploadBytes(...args),
    getDownloadURL: async () => 'https://storage.example.test/offer.pdf',
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    doc: (parent, ...segments) => ({ id: segments.length ? segments[segments.length - 1] : 'request-1', parent }),
    addDoc: (...args) => mocks.addDoc(...args),
    getDoc: (...args) => mocks.getDoc(...args),
    updateDoc: (...args) => mocks.updateDoc(...args),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    deleteField: () => 'DELETE_FIELD',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: mocks.batchSet, commit: mocks.batchCommit }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { hydrateEnvelopeForEdit, saveEnvelope } from './envelopePersistence';

const PATH = 'secure_documents/co-1/originals/company-signatures/a1b2.png';
const SIGNATURE = { id: 'sig-1', type: 'signature', label: 'Signature', x: 10, y: 80, width: 30, height: 5, page: 1, required: true };
const companySignature = (companySignaturePath) => ({
    id: 'cs-1', type: 'company_signature', label: 'Company Signature', x: 60, y: 80, width: 25, height: 8, page: 1,
    required: false, readOnly: true, prefillPolicy: 'locked', bindingKey: '', defaultValue: '', fontSize: 'Auto',
    ...(companySignaturePath === undefined ? {} : { companySignaturePath }),
});

function save(overrides) {
    const callbacks = {
        onClose: vi.fn(),
        showError: vi.fn(),
        showSuccess: vi.fn(),
        showWarning: vi.fn(),
        setLoading: vi.fn(),
        setSaveState: vi.fn(),
        markSaved: vi.fn(),
    };
    return saveEnvelope({
        file: new File(['%PDF-1.4'], 'offer.pdf', { type: 'application/pdf' }),
        fields: [SIGNATURE, companySignature(PATH)],
        creatorMode: 'request',
        isEditingTemplate: false,
        isEditingRequest: false,
        recipientName: 'Dana Driver',
        recipientEmail: 'dana@example.test',
        recipientPhone: '',
        deliveryMethod: 'email',
        title: 'Offer Letter',
        companyId: 'co-1',
        companyName: 'Artificial Freight Co',
        ...callbacks,
        ...overrides,
    }).then(() => callbacks);
}

const MISSING = 'Upload the company signature image before sending. A company signature on this document has no image yet.';
const storedFields = (payload) => payload.fields;
const storedCompanySignature = (payload) => storedFields(payload).find((field) => field.type === 'company_signature');

beforeEach(() => {
    vi.resetAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.uploadBytes.mockResolvedValue(undefined);
    mocks.addDoc.mockResolvedValue({ id: 'template-1' });
    mocks.updateDoc.mockResolvedValue(undefined);
    mocks.getDoc.mockResolvedValue({ data: () => ({ status: 'sent', recipientEmail: 'dana@example.test', sendEmail: true }) });
});

describe('sending a document with a company signature', () => {
    it.each([['no path', undefined], ['an empty path', ''], ['a blank path', '   ']])(
        'is refused while the company signature has %s, and nothing is written',
        async (_label, path) => {
            const { showError, setLoading, markSaved } = await save({ fields: [SIGNATURE, companySignature(path)] });

            expect(showError).toHaveBeenCalledWith(MISSING);
            expect(mocks.uploadBytes).not.toHaveBeenCalled();
            expect(mocks.batchSet).not.toHaveBeenCalled();
            expect(setLoading).not.toHaveBeenCalled();
            expect(markSaved).not.toHaveBeenCalled();
        },
    );

    it('is refused as a correction too', async () => {
        const { showError } = await save({ isEditingRequest: true, editRequestId: 'req-1', fields: [SIGNATURE, companySignature('')] });

        expect(showError).toHaveBeenCalledWith(MISSING);
        expect(mocks.updateDoc).not.toHaveBeenCalled();
    });

    it('sends the image path with the fixed company signature', async () => {
        const { showError } = await save();

        expect(showError).not.toHaveBeenCalled();
        const request = mocks.batchSet.mock.calls[0][1];
        expect(storedCompanySignature(request)).toEqual({
            id: 'cs-1', type: 'company_signature', label: 'Company Signature', pageNumber: 1,
            xPosition: 60, yPosition: 80, width: 25, height: 8, required: false, readOnly: true,
            prefillPolicy: 'locked', bindingKey: '', prefillGroupKey: '', defaultValue: '', fontSize: 'Auto',
            companySignaturePath: PATH,
        });
    });

    it('keeps the image a correction replaced', async () => {
        const replaced = 'secure_documents/co-1/originals/company-signatures/c3d4.png';
        await save({ isEditingRequest: true, editRequestId: 'req-1', fields: [SIGNATURE, companySignature(replaced)] });

        expect(storedCompanySignature(mocks.updateDoc.mock.calls[0][1]).companySignaturePath).toBe(replaced);
    });
});

describe('saving a template with a company signature', () => {
    it('may leave the image for each document', async () => {
        const { showError, showSuccess } = await save({ creatorMode: 'template', fields: [SIGNATURE, companySignature(undefined)] });

        expect(showError).not.toHaveBeenCalled();
        expect(showSuccess).toHaveBeenCalledWith('Template saved successfully!');
        expect(storedCompanySignature(mocks.addDoc.mock.calls[0][1]).companySignaturePath).toBe('');
    });

    it('keeps the image an edited template carries', async () => {
        await save({
            creatorMode: 'template',
            isEditingTemplate: true,
            editTemplateId: 'template-1',
            existingStoragePath: 'secure_documents/co-1/templates/offer.pdf',
        });

        expect(storedCompanySignature(mocks.updateDoc.mock.calls[0][1]).companySignaturePath).toBe(PATH);
    });
});

describe('opening a document with a company signature for editing', () => {
    it('gives the editor the stored image', async () => {
        mocks.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => ({
                title: 'Offer',
                fields: [{
                    id: 'cs-1', type: 'company_signature', label: 'Company Signature', pageNumber: 1, xPosition: 60, yPosition: 80,
                    width: 25, height: 8, required: false, readOnly: true, prefillPolicy: 'locked', companySignaturePath: PATH,
                }],
            }),
        });
        const resetEditorHistory = vi.fn();
        const noop = () => {};
        await hydrateEnvelopeForEdit({
            companyId: 'co-1',
            editingCollection: 'signing_requests',
            editingEntityId: 'req-1',
            isEditingTemplate: false,
            showError: vi.fn(),
            resetEditorHistory,
            setHydrating: noop,
            setRecipientName: noop,
            setRecipientEmail: noop,
            setRecipientPhone: noop,
            setTitle: noop,
            setDeliveryMethod: noop,
            setCreatorMode: noop,
            setExistingStoragePath: noop,
            setNumPages: noop,
            setFile: noop,
        });

        expect(resetEditorHistory).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'cs-1', type: 'company_signature', page: 1, x: 60, y: 80, companySignaturePath: PATH }),
        ]);
    });
});
