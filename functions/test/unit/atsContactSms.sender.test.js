/**
 * The name the automated contact-attempt SMS signs with: the assignee's while
 * the record has one, else who last changed it, else "Your recruiter". An
 * unassigned record's stored name is a leftover: unassigning in the dossier
 * once stored "Unassigned" as the name.
 *
 * All names and numbers below are artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentUpdated: (opts, handler) => handler }));

const mockTemplate = { value: 'Hi {driver name}, this is {user name}.' };
jest.mock('../../firebaseAdmin', () => ({
    db: {
        collection: () => ({
            doc: () => ({
                collection: () => ({
                    doc: () => ({
                        async get() {
                            return { exists: true, data: () => ({ templateContactAttempt1: mockTemplate.value }) };
                        },
                    }),
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
    afterData: { status: 'Contact Attempt 1', firstName: 'Bob', lastName: 'Driver', phone: '(555) 123-4567', ...record },
});
const sentBody = () => mockSendSMS.mock.calls[0][1];

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockSendSMS.mockResolvedValue(undefined);
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
