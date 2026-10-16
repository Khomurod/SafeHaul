/**
 * What sending a signing request writes, from both places that send one: the
 * template wizard (`useTemplateSendFlow`) and the envelope editor
 * (`saveEnvelope`). For every delivery either offers, each document is pinned
 * with its path and every field and value, in the order written, with the link
 * handed to the clipboard and every message the sender sees. So is the delivery
 * a correction records. The clock and the tokens are fixed, so every value is
 * exact. All names, numbers and addresses are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({
    db: { name: 'test-db' },
    writes: [],
    tokens: 0,
    copied: [],
    clipboardRefuses: false,
    before: null,
}));

vi.mock('@lib/firebase', () => ({
    db: fx.db,
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
    ref: (_storage, path) => ({ path }),
    uploadBytes: async (fileRef, file) => {
        fx.writes.push(['uploadBytes', fileRef.path, file.name]);
    },
    getDownloadURL: async () => 'https://storage.example.test/offer.pdf',
}));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...segments) => ({ path: segments.join('/') }),
    // A new document is `request-1`; a named one keeps its path.
    doc: (parent, ...segments) => {
        const names = segments.length ? segments : ['request-1'];
        return { id: names[names.length - 1], path: [parent.path, ...names].filter(Boolean).join('/') };
    },
    writeBatch: (database) => {
        fx.writes.push(['writeBatch', database]);
        return {
            set: (ref, data) => {
                fx.writes.push(['set', ref.path, data]);
            },
            commit: async () => {
                fx.writes.push(['commit']);
            },
        };
    },
    setDoc: async (ref, data) => {
        fx.writes.push(['setDoc', ref.path, data]);
    },
    addDoc: async (ref, data) => {
        fx.writes.push(['addDoc', ref.path, data]);
        return { id: 'added-1' };
    },
    updateDoc: async (ref, data) => {
        fx.writes.push(['updateDoc', ref.path, data]);
    },
    getDoc: async () => ({ exists: () => fx.before !== null, data: () => fx.before }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
}));
vi.mock('uuid', () => ({
    v4: () => {
        fx.tokens += 1;
        return `token-${fx.tokens}`;
    },
}));
// The wizard's lead picker opens with it; here it finds nobody.
vi.mock('@features/company-admin/hooks/pickerLeads', () => ({
    findPickerLeads: async () => [],
    matchPickerLeads: () => [],
}));

import { useTemplateSendFlow } from '@features/company-admin/hooks/useTemplateSendFlow';
import { saveEnvelope } from './envelopePersistence';
import { SAVE_STATES } from './editorSaveState';

const NOW = Date.UTC(2026, 9, 16, 15, 0, 0);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const ORIGIN = window.location.origin;
const REQUEST_PATH = 'companies/co-1/signing_requests/request-1';
const LINK = `${ORIGIN}/sign/co-1/request-1?token=token-1`;
const LINK_NOT_COPIED = 'Document created, but the browser blocked copying its link. Copy it from Sent Documents.';

/**
 * Every delivery both senders offer: the contact it needs, what the request
 * records for it, the text handed to the clipboard and what the sender is told.
 */
const SENDS = [
    {
        label: 'email',
        deliveryMethod: 'email',
        email: 'dana@example.test',
        phone: '',
        written: { recipientEmail: 'dana@example.test', recipientPhone: null, sendEmail: true, sendSms: false, deliveryMethod: 'email' },
        clipboard: [],
        told: { success: [['Document created! Email delivery in progress...']], warning: [], error: [] },
    },
    {
        label: 'SMS',
        deliveryMethod: 'sms',
        email: '',
        phone: '+15555550100',
        written: { recipientEmail: null, recipientPhone: '+15555550100', sendEmail: false, sendSms: true, deliveryMethod: 'sms' },
        clipboard: [],
        told: { success: [['Document created! SMS delivery in progress...']], warning: [], error: [] },
    },
    {
        label: 'email and SMS',
        deliveryMethod: 'both',
        email: 'dana@example.test',
        phone: '+15555550100',
        written: { recipientEmail: 'dana@example.test', recipientPhone: '+15555550100', sendEmail: true, sendSms: true, deliveryMethod: 'both' },
        clipboard: [],
        told: { success: [['Document created! Email + SMS delivery in progress...']], warning: [], error: [] },
    },
    {
        label: 'Copy Link',
        deliveryMethod: 'copy',
        email: '',
        phone: '',
        written: { recipientEmail: null, recipientPhone: null, sendEmail: false, sendSms: false, deliveryMethod: 'copy' },
        clipboard: [LINK],
        told: { success: [['Signing link copied to clipboard!']], warning: [], error: [] },
    },
    {
        label: 'Copy Link, the browser refusing the clipboard',
        deliveryMethod: 'copy',
        clipboardRefuses: true,
        email: '',
        phone: '',
        written: { recipientEmail: null, recipientPhone: null, sendEmail: false, sendSms: false, deliveryMethod: 'copy' },
        clipboard: [LINK],
        told: { success: [], warning: [[LINK_NOT_COPIED]], error: [] },
    },
];
const BOTH = SENDS[2];

/** One batch: the request, then the token its link carries. */
const newRequestWrites = (request) => [
    ['writeBatch', fx.db],
    ['set', REQUEST_PATH, request],
    ['set', `${REQUEST_PATH}/secrets/token`, { accessToken: 'token-1' }],
    ['commit'],
];

const TEMPLATE = {
    id: 'template-1',
    title: 'Offer Letter',
    storagePath: 'secure_documents/co-1/templates/offer.pdf',
    fields: [
        { id: 'sig-1', type: 'signature', label: 'Signature', pageNumber: 1, x: 10, y: 80, width: 30, height: 5, required: true },
        { id: 'name-1', type: 'text', label: 'Driver name', pageNumber: 1, x: 10, y: 20, width: 30, height: 5, required: true, prefillPolicy: 'locked', bindingKey: 'full_name' },
    ],
};

/** The request the wizard writes for `TEMPLATE`, with what the delivery records. */
const templateRequest = (written) => ({
    companyId: 'co-1',
    recipientName: 'Dana Driver',
    title: 'Offer Letter',
    status: 'sent',
    createdAt: 'SERVER_TIMESTAMP',
    expiresAt: { ms: NOW + WEEK_MS },
    storagePath: 'secure_documents/co-1/templates/offer.pdf',
    senderId: 'user-1',
    senderName: 'Rita Recruiter',
    appBaseUrl: ORIGIN,
    fields: [
        { ...TEMPLATE.fields[0], defaultValue: '', readOnly: false, prefillPolicy: 'editable' },
        { ...TEMPLATE.fields[1], defaultValue: 'Dana Driver', readOnly: true, prefillPolicy: 'locked' },
    ],
    templateId: 'template-1',
    fieldValues: { 'name-1': 'Dana Driver' },
    ...written,
});

const EDITOR_FIELDS = [
    { id: 'sig-1', type: 'signature', label: 'Signature', page: 1, x: 10, y: 80, width: 30, height: 5, required: true },
    { id: 'name-1', type: 'text', label: 'Driver name', page: 1, x: 10, y: 20, width: 30, height: 5, required: true, prefillPolicy: 'locked', bindingKey: 'full_name' },
];
const STORED_EDITOR_FIELDS = [
    {
        id: 'sig-1', type: 'signature', label: 'Signature', pageNumber: 1, xPosition: 10, yPosition: 80, width: 30, height: 5,
        required: true, defaultValue: '', readOnly: false, prefillPolicy: 'editable', bindingKey: '', prefillGroupKey: '', fontSize: 'Auto',
    },
    {
        id: 'name-1', type: 'text', label: 'Driver name', pageNumber: 1, xPosition: 10, yPosition: 20, width: 30, height: 5,
        required: true, defaultValue: 'Dana Driver', readOnly: true, prefillPolicy: 'locked', bindingKey: 'full_name', prefillGroupKey: '', fontSize: 'Auto',
    },
];
const UPLOAD_PATH = `secure_documents/co-1/originals/${NOW}_offer.pdf`;

/** The request the editor writes for `EDITOR_FIELDS`, with what the delivery records. */
const editorRequest = (written) => ({
    companyId: 'co-1',
    title: 'Offer Letter',
    fields: STORED_EDITOR_FIELDS,
    updatedAt: 'SERVER_TIMESTAMP',
    storagePath: UPLOAD_PATH,
    recipientName: 'Dana Driver',
    status: 'sent',
    createdAt: 'SERVER_TIMESTAMP',
    expiresAt: { ms: NOW + WEEK_MS },
    senderId: 'user-1',
    senderName: 'Rita Recruiter',
    appBaseUrl: ORIGIN,
    ...written,
});

const toastSpies = () => ({ showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() });
const toldBy = (toasts) => ({
    success: toasts.showSuccess.mock.calls,
    warning: toasts.showWarning.mock.calls,
    error: toasts.showError.mock.calls,
});

async function sendFromWizard({ deliveryMethod, name = 'Dana Driver', email, phone }) {
    const toasts = toastSpies();
    const setActiveTab = vi.fn();
    const { result } = renderHook(() => useTemplateSendFlow({
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight Co' },
        isE2EEdocMock: false,
        navigate: vi.fn(),
        setActiveTab,
        ...toasts,
    }));
    act(() => result.current.handleUseTemplate(TEMPLATE));
    await waitFor(() => expect(result.current.driversStatus).toBe('ready'));
    act(() => {
        result.current.setManualName(name);
        result.current.setManualEmail(email);
        result.current.setManualPhone(phone);
        result.current.setDeliveryMethod(deliveryMethod);
    });
    await act(() => result.current.executeTemplateSend());
    return { told: toldBy(toasts), setActiveTab, result };
}

async function saveFromEditor({ deliveryMethod, name = 'Dana Driver', email, phone, ...editing }) {
    const toasts = toastSpies();
    const closing = { onClose: vi.fn(), setLoading: vi.fn(), setSaveState: vi.fn(), markSaved: vi.fn() };
    await saveEnvelope({
        file: new File(['%PDF-1.4'], 'offer.pdf', { type: 'application/pdf' }),
        fields: EDITOR_FIELDS,
        creatorMode: 'request',
        isEditingTemplate: false,
        isEditingRequest: false,
        recipientName: name,
        recipientEmail: email,
        recipientPhone: phone,
        deliveryMethod,
        title: 'Offer Letter',
        companyId: 'co-1',
        companyName: 'Artificial Freight Co',
        ...editing,
        ...toasts,
        ...closing,
    });
    return { told: toldBy(toasts), ...closing };
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    fx.writes = [];
    fx.tokens = 0;
    fx.copied = [];
    fx.clipboardRefuses = false;
    fx.before = null;
    vi.stubGlobal('navigator', {
        ...navigator,
        clipboard: {
            writeText: async (text) => {
                fx.copied.push(text);
                if (fx.clipboardRefuses) throw new DOMException('Document is not focused.', 'NotAllowedError');
            },
        },
    });
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('a signing request sent from the template wizard', () => {
    it.each(SENDS)('by $label', async (send) => {
        fx.clipboardRefuses = Boolean(send.clipboardRefuses);
        const { told, setActiveTab, result } = await sendFromWizard(send);

        expect(fx.writes).toStrictEqual(newRequestWrites(templateRequest(send.written)));
        expect(fx.copied).toStrictEqual(send.clipboard);
        expect(told).toStrictEqual(send.told);
        expect(setActiveTab.mock.calls).toStrictEqual([['sent']]);
        expect(result.current.showDriverPicker).toBe(false);
    });

    it('writes the recipient without the spaces typed around it', async () => {
        await sendFromWizard({ ...BOTH, name: '  Dana Driver ', email: ' dana@example.test ', phone: ' +15555550100 ' });

        expect(fx.writes).toStrictEqual(newRequestWrites(templateRequest(BOTH.written)));
    });
});

describe('a signing request sent from the envelope editor', () => {
    it.each(SENDS)('by $label', async (send) => {
        fx.clipboardRefuses = Boolean(send.clipboardRefuses);
        const { told, setSaveState, markSaved, onClose } = await saveFromEditor(send);

        expect(fx.writes).toStrictEqual([
            ['uploadBytes', UPLOAD_PATH, 'offer.pdf'],
            ...newRequestWrites(editorRequest(send.written)),
        ]);
        expect(fx.copied).toStrictEqual(send.clipboard);
        expect(told).toStrictEqual(send.told);
        expect(setSaveState.mock.calls).toStrictEqual([[SAVE_STATES.SAVING]]);
        expect([markSaved, onClose].map((fn) => fn.mock.calls.length)).toStrictEqual([1, 1]);
    });

    it('writes the recipient as it was typed, spaces included', async () => {
        await saveFromEditor({ ...BOTH, name: ' Dana Driver ', email: ' dana@example.test ', phone: ' +15555550100 ' });

        expect(fx.writes).toStrictEqual([
            ['uploadBytes', UPLOAD_PATH, 'offer.pdf'],
            ...newRequestWrites(editorRequest({
                ...BOTH.written,
                recipientName: ' Dana Driver ',
                recipientEmail: ' dana@example.test ',
                recipientPhone: ' +15555550100 ',
            })),
        ]);
    });
});

describe('a correction of a sent request in the envelope editor', () => {
    // The link went by email to the address the correction keeps.
    const SENT = {
        status: 'sent',
        recipientName: 'Dana Driver',
        recipientEmail: 'dana@example.test',
        recipientPhone: '+15555550100',
        linkSentTo: { email: 'dana@example.test', phone: '' },
    };
    const CORRECTIONS = [
        { deliveryMethod: 'email', written: { sendEmail: true, sendSms: false, deliveryMethod: 'email' }, message: 'Document updated successfully!' },
        { deliveryMethod: 'sms', written: { sendEmail: false, sendSms: true, deliveryMethod: 'sms' }, message: 'Document updated. The signing link is on its way by SMS.' },
        { deliveryMethod: 'both', written: { sendEmail: true, sendSms: true, deliveryMethod: 'both' }, message: 'Document updated. The signing link is on its way by SMS.' },
        { deliveryMethod: 'copy', written: { sendEmail: false, sendSms: false, deliveryMethod: 'copy' }, message: 'Document updated successfully!' },
    ];

    it.each(CORRECTIONS)('records delivery by $deliveryMethod', async ({ deliveryMethod, written, message }) => {
        fx.before = SENT;
        const { told } = await saveFromEditor({
            deliveryMethod,
            email: 'dana@example.test',
            phone: '+15555550100',
            isEditingRequest: true,
            editRequestId: 'req-1',
        });

        expect(fx.writes).toStrictEqual([
            ['updateDoc', 'companies/co-1/signing_requests/req-1', {
                companyId: 'co-1',
                title: 'Offer Letter',
                fields: STORED_EDITOR_FIELDS,
                updatedAt: 'SERVER_TIMESTAMP',
                recipientEmail: 'dana@example.test',
                recipientName: 'Dana Driver',
                recipientPhone: '+15555550100',
                ...written,
            }],
        ]);
        expect(told).toStrictEqual({ success: [[message]], warning: [], error: [] });
    });
});
