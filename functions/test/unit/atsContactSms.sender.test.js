/**
 * The name the automated contact-attempt SMS signs with: the assignee's while
 * the record has one, else who last changed it, else "Your recruiter". An
 * unassigned record's stored name is a leftover: unassigning in the dossier
 * once stored "Unassigned" as the name.
 *
 * All names and numbers below are artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (opts, handler) => handler,
    onDocumentUpdated: (opts, handler) => handler,
}));

const mockTemplate = { value: 'Hi {driver name}, this is {user name}.' };
// The company's automated SMS settings hold the template; no number is on an opt-out list.
const mockMissing = { get: async () => ({ exists: false }) };
// The company's document, and its recruiters' links (`recruiter_links`: code → owner).
const mockCompany = { data: { appSlug: 'artificial-freight' } };
const mockLinks = { byCode: {} };
const mockLinkQuery = (filters) => ({
    where: (field, _op, value) => mockLinkQuery({ ...filters, [field]: value }),
    limit: () => mockLinkQuery(filters),
    async get() {
        const docs = Object.entries(mockLinks.byCode)
            .filter(([, link]) => Object.entries(filters).every(([field, value]) => link[field] === value))
            .map(([id]) => ({ id }));
        return { empty: docs.length === 0, docs };
    },
});
jest.mock('../../firebaseAdmin', () => ({
    db: {
        collection: (name) => (name === 'recruiter_links' ? mockLinkQuery({}) : {
            doc: () => (name === 'blacklist' ? mockMissing : {
                get: async () => ({ exists: true, data: () => mockCompany.data }),
                collection: (sub) => ({
                    doc: () => (sub === 'settings' ? {
                        async get() {
                            return { exists: true, data: () => ({ templateContactAttempt1: mockTemplate.value }) };
                        },
                    } : mockMissing),
                }),
            }),
        }),
    },
}));

const mockSendSMS = jest.fn();
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: async () => ({ sendSMS: (...args) => mockSendSMS(...args) }),
}));

const { sendContactAttemptSmsIfNeeded } = require('../../atsContactSms');

const attempt = (record) => sendContactAttemptSmsIfNeeded({
    companyId: 'co1',
    beforeData: { status: 'New' },
    afterData: { status: 'Contact Attempt 1', firstName: 'Bob', lastName: 'Driver', phone: '(555) 123-4567', 'sms-consent': 'yes', ...record },
    recordType: 'application',
});
const sentBody = () => mockSendSMS.mock.calls[0][1];

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockSendSMS.mockResolvedValue(undefined);
    mockTemplate.value = 'Hi {driver name}, this is {user name}.';
    mockLinks.byCode = {};
});

describe('the contact-attempt SMS signs with', () => {
    it("the assignee's name while the record has an assignee", async () => {
        await attempt({ assignedTo: 'recruiter-1', assignedToName: 'Sam Rivera', lastModifiedByName: 'Rita Admin' });

        expect(sentBody()).toBe('Hi Bob Driver, this is Sam Rivera.');
    });

    it('who last changed the record when nobody is assigned, whatever name is left over', async () => {
        await attempt({ assignedTo: '', assignedToName: 'Unassigned', lastModifiedByName: 'Rita Admin' });

        expect(sentBody()).toBe('Hi Bob Driver, this is Rita Admin.');
    });

    it('"Your recruiter" when there is neither', async () => {
        await attempt({ assignedToName: 'Unassigned' });

        expect(sentBody()).toBe('Hi Bob Driver, this is Your recruiter.');
    });
});

describe('the contact-attempt SMS application link', () => {
    beforeEach(() => {
        mockTemplate.value = 'Hi {driver name}, apply here: {application link}';
        mockLinks.byCode = {
            RIL2345: { userId: 'recruiter-1', companyId: 'co1' },
            OTH2345: { userId: 'recruiter-2', companyId: 'co2' },
        };
    });

    it("carries the assignee's recruiter link for this company", async () => {
        await attempt({ assignedTo: 'recruiter-1', assignedToName: 'Sam Rivera' });

        expect(sentBody()).toBe('Hi Bob Driver, apply here: https://app.safehaul.io/apply/artificial-freight?r=RIL2345');
    });

    it('is the plain apply link without an assignee, or for an assignee with no link here', async () => {
        await attempt({ assignedTo: '' });
        await attempt({ assignedTo: 'recruiter-2' });

        expect(mockSendSMS.mock.calls.map(([, body]) => body)).toEqual([
            'Hi Bob Driver, apply here: https://app.safehaul.io/apply/artificial-freight',
            'Hi Bob Driver, apply here: https://app.safehaul.io/apply/artificial-freight',
        ]);
    });
});
