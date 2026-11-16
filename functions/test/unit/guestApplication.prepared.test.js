/**
 * An application a recruiter prepared belongs to them once the driver submits
 * it: it is assigned to them in the write that files it, unless someone is
 * already assigned, and they are told in the bell, once. Who prepared it is
 * read from the draft on the server, never from what the browser sent, and
 * only a current member of the team is assigned or told. None of it can cost
 * the driver an application they signed.
 * Every name, id and contact detail is artificial.
 */
const { createFirestoreMock } = require('../helpers/firestoreMock');

jest.mock('firebase-functions/v1', () => {
    class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.code = code;
            this.details = details;
        }
    }
    const https = { HttpsError, onCall: (fn) => fn };
    return { https, runWith: () => ({ https }) };
});

jest.mock('firebase-admin/firestore', () => ({
    FieldValue: { serverTimestamp: () => ({ __srv: true }) },
}));

const mock = createFirestoreMock({}, { filters: true });
jest.mock('../../firebaseAdmin', () => ({
    admin: mock.admin,
    db: mock.db,
    storage: { bucket: () => ({ file: () => ({}) }) },
}));
jest.mock('../../shared/companyTenant', () => ({
    assertCompanyAcceptingIntake: async () => ({
        companyName: 'Artificial Freight',
        applicationConfig: {
            cdlUpload: { hidden: false, required: false },
            medCardUpload: { hidden: false, required: false },
        },
    }),
}));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: async () => true }));
// The frozen record and its PDF have their own suites.
jest.mock('../../shared/writeSubmissionSnapshot', () => ({
    writeSubmissionSnapshot: async () => ({ snapshotId: 'snap-1', sequence: 1, deduplicated: false }),
}));
jest.mock('../../shared/preserveApplicationPdf', () => ({ preserveApplicationPdf: async () => null }));

// The real writer, unless a test makes it fail.
let mockNotificationFailure = null;
jest.mock('../../shared/createNotification', () => {
    const actual = jest.requireActual('../../shared/createNotification');
    return {
        createNotification: (...args) => (mockNotificationFailure
            ? Promise.reject(mockNotificationFailure)
            : actual.createNotification(...args)),
    };
});

const { submitGuestApplication } = require('../../guestApplication');
const { generateApplicantKey, generateApplicationId } = require('../../shared/buildApplicationDoc');

const EMAIL = 'ann.adams@example.test';
const PHONE = '5550104477';
const { applicantKey } = generateApplicantKey('co1', EMAIL, PHONE);
const APP_ID = generateApplicationId(applicantKey);
const APP_PATH = `companies/co1/applications/${APP_ID}`;
const DRAFT_PATH = `companies/co1/application_drafts/${APP_ID}`;

const payload = (formData = {}) => ({
    companyId: 'co1',
    email: EMAIL,
    phone: PHONE,
    signature: 'data:image/png;base64,AAA',
    formData: { firstName: 'Ann', lastName: 'Adams', ssn: '123-45-6789', 'has-violations': 'no', 'has-accidents': 'no', ...formData },
});
const ctx = { rawRequest: { ip: '203.0.113.1' } };

const preparedDraft = (extra = {}) => ({
    origin: 'company',
    status: 'driver_in_progress',
    preparedBy: { uid: 'rec-1', name: 'Oleg (token name)', at: 'prep-time' },
    formData: {},
    ...extra,
});
const onTheTeam = (uid, name) => ({
    [`memberships/m-${uid}`]: { userId: uid, companyId: 'co1', role: 'company_recruiter' },
    [`users/${uid}`]: { name },
});

const application = () => mock.docs.get(APP_PATH);
const notifications = () => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith('companies/co1/notifications/'))
    .map(([path, data]) => ({ id: path.split('/').pop(), ...data }));

let errors;
beforeEach(() => {
    mockNotificationFailure = null;
    errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('submitting an application a recruiter prepared', () => {
    it('assigns it to the recruiter who prepared it and tells them, once', async () => {
        mock.reset({ [DRAFT_PATH]: preparedDraft(), ...onTheTeam('rec-1', 'Oleg Recruiter') });

        const res = await submitGuestApplication(payload(), ctx);
        // A retry finds the draft gone and the application already filed.
        await submitGuestApplication(payload(), ctx);

        expect(res).toMatchObject({ success: true, applicationId: APP_ID });
        expect(res).not.toHaveProperty('assigned');
        expect(application()).toMatchObject({ assignedTo: 'rec-1', assignedToName: 'Oleg Recruiter' });
        expect(mock.docs.has(DRAFT_PATH)).toBe(false);
        expect(notifications()).toEqual([{
            id: `prepared_submitted_${APP_ID}`,
            type: 'prepared_application_submitted',
            title: 'Prepared application submitted',
            message: 'Ann Adams submitted the application you prepared; it is assigned to you',
            recipientId: 'rec-1',
            relatedType: 'application',
            relatedId: APP_ID,
            read: false,
            createdAt: expect.anything(),
        }]);
    });

    it('keeps the recruiter already assigned, and still tells the preparer', async () => {
        mock.reset({
            [DRAFT_PATH]: preparedDraft(),
            [APP_PATH]: { status: 'Contacted', assignedTo: 'rec-2', assignedToName: 'Rita Recruiter' },
            ...onTheTeam('rec-1', 'Oleg Recruiter'),
            ...onTheTeam('rec-2', 'Rita Recruiter'),
        });

        await submitGuestApplication(payload(), ctx);

        expect(application()).toMatchObject({ assignedTo: 'rec-2', assignedToName: 'Rita Recruiter', status: 'Contacted' });
        expect(notifications()).toEqual([expect.objectContaining({
            recipientId: 'rec-1',
            message: 'Ann Adams submitted the application you prepared',
        })]);
    });

    it('assigns nobody and tells nobody when the preparer has left the team', async () => {
        mock.reset({ [DRAFT_PATH]: preparedDraft(), 'users/rec-1': { name: 'Oleg Recruiter' } });

        await expect(submitGuestApplication(payload(), ctx)).resolves.toMatchObject({ success: true });

        expect(application().assignedTo).toBeUndefined();
        expect(notifications()).toEqual([]);
    });

    it('takes the preparer from the draft alone, never from the browser', async () => {
        mock.reset({ ...onTheTeam('rec-1', 'Oleg Recruiter') });

        await submitGuestApplication(payload({
            preparedBy: { uid: 'rec-1', name: 'Oleg' }, assignedTo: 'rec-1', assignedToName: 'Oleg', origin: 'company',
        }), ctx);

        expect(application().assignedTo).toBeUndefined();
        expect(notifications()).toEqual([]);
    });

    it('does nothing of the kind for a draft the driver started', async () => {
        mock.reset({ [DRAFT_PATH]: preparedDraft({ origin: undefined }), ...onTheTeam('rec-1', 'Oleg Recruiter') });

        await submitGuestApplication(payload(), ctx);

        expect(application().assignedTo).toBeUndefined();
        expect(notifications()).toEqual([]);
    });

    it('files the application unassigned when the team cannot be read', async () => {
        mock.reset({ [DRAFT_PATH]: preparedDraft(), ...onTheTeam('rec-1', 'Oleg Recruiter') });
        const realCollection = mock.db.collection;
        mock.db.collection = (name) => {
            if (name === 'memberships') throw Object.assign(new Error('unavailable'), { code: 14 });
            return realCollection(name);
        };
        try {
            await expect(submitGuestApplication(payload(), ctx)).resolves.toMatchObject({ success: true });
        } finally {
            mock.db.collection = realCollection;
        }

        expect(application()).toMatchObject({ firstName: 'Ann' });
        expect(application().assignedTo).toBeUndefined();
        expect(notifications()).toEqual([]);
    });

    it('still files and assigns the application when the notification cannot be written', async () => {
        mock.reset({ [DRAFT_PATH]: preparedDraft(), ...onTheTeam('rec-1', 'Oleg Recruiter') });
        mockNotificationFailure = Object.assign(new Error('unavailable'), { code: 14 });

        await expect(submitGuestApplication(payload(), ctx)).resolves.toMatchObject({ success: true });

        expect(application()).toMatchObject({ assignedTo: 'rec-1' });
        expect(errors).toHaveBeenCalledWith(expect.stringContaining(APP_ID), 'unavailable');
    });
});
