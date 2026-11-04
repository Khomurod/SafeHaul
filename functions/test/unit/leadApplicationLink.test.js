/**
 * A lead who applies is linked to the application (`shared/leadApplicationLink.js`).
 *
 * The match, by the owner's rule: the same email on both sides (trimmed and
 * lowercased, never a placeholder), else the same phone when exactly one lead
 * has it. At most one lead; nothing is merged and the lead's status stays. An
 * unassigned application goes to the lead's recruiter while they are on the
 * team, and that recruiter is told once.
 *
 * Every person, address, number and company below is artificial.
 */
const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock({}, { filters: true });
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const { linkApplicantLead, unlinkDeletedRecord } = require('../../shared/leadApplicationLink');

const CO = 'co1';
const APP = 'app1';
const APP_PATH = `companies/${CO}/applications/${APP}`;
const leadPath = (id) => `companies/${CO}/leads/${id}`;
const doc = (path) => mock.docs.get(path);
const notifications = () => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith(`companies/${CO}/notifications/`))
    .map(([path, data]) => ({ id: path.split('/').pop(), ...data }));

const APPLICATION = {
    firstName: 'Alice',
    lastName: 'Driver',
    email: 'alice.driver@example.com',
    emailNormalized: 'alice.driver@example.com',
    phone: '(555) 010-1000',
    phoneNormalized: '5550101000',
};

const TEAM = {
    'memberships/m1': { userId: 'rec-1', companyId: CO, role: 'recruiter' },
    'users/rec-1': { name: 'Riley Recruiter' },
};

function seed(records = {}, application = APPLICATION) {
    mock.reset({ [`companies/${CO}`]: { companyName: 'Artificial Freight' }, [APP_PATH]: application, ...TEAM, ...records });
}

const link = (application = APPLICATION) => linkApplicantLead({ companyId: CO, applicationId: APP, application });

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('which lead an application is linked to', () => {
    it('the lead with the same email, however it was typed, and leaves its status alone', async () => {
        seed({
            [leadPath('L1')]: {
                email: ' Alice.Driver@Example.com ', emailNormalized: 'alice.driver@example.com',
                status: 'Contact Attempt 2', assignedTo: '',
            },
        });

        await expect(link()).resolves.toMatchObject({ leadId: 'L1', by: 'email' });

        expect(doc(leadPath('L1'))).toEqual(expect.objectContaining({
            applicationId: APP, appliedAt: '__server_timestamp__', status: 'Contact Attempt 2',
        }));
        expect(doc(APP_PATH).fromLeadId).toBe('L1');
        expect(doc(`${leadPath('L1')}/activity_logs/applied_${APP}`)).toEqual({
            action: 'Applied',
            details: 'Submitted an application, found by the same email.',
            type: 'system',
            companyId: CO,
            applicationId: APP,
            timestamp: '__server_timestamp__',
        });
    });

    it('an older lead typed in lower case, before it had the lowercased copy', async () => {
        seed({ [leadPath('L1')]: { email: 'alice.driver@example.com' } });

        await expect(link()).resolves.toMatchObject({ leadId: 'L1', by: 'email' });
    });

    it('the only lead with the phone when no lead has the email', async () => {
        seed({ [leadPath('L2')]: { email: 'someone.else@example.com', normalizedPhone: '5550101000' } });

        await expect(link()).resolves.toMatchObject({ leadId: 'L2', by: 'phone' });
        expect(doc(APP_PATH).fromLeadId).toBe('L2');
    });

    it('no lead by phone when two leads share the number', async () => {
        seed({
            [leadPath('L2')]: { normalizedPhone: '5550101000' },
            [leadPath('L3')]: { normalizedPhone: '5550101000' },
        });

        await expect(link()).resolves.toBeNull();
        expect(doc(APP_PATH).fromLeadId).toBeUndefined();
        expect(doc(leadPath('L2')).applicationId).toBeUndefined();
    });

    it('the email match over a phone match, and only one lead when two have the email', async () => {
        seed({
            [leadPath('Lb')]: { email: 'alice.driver@example.com' },
            [leadPath('La')]: { emailNormalized: 'alice.driver@example.com', email: 'Alice.Driver@example.com' },
            [leadPath('Lphone')]: { normalizedPhone: '5550101000' },
        });

        await expect(link()).resolves.toMatchObject({ leadId: 'La' });
        expect(doc(leadPath('Lb')).applicationId).toBeUndefined();
        expect(doc(leadPath('Lphone')).applicationId).toBeUndefined();
    });

    it('never by a placeholder email, on either side', async () => {
        const placeholder = 'placeholder_ab12@placeholder.safehaulapp.com';
        const phoneOnly = { ...APPLICATION, email: placeholder, emailNormalized: placeholder, phoneNormalized: '' };
        seed({
            [leadPath('L1')]: { email: placeholder, emailNormalized: placeholder, isEmailPlaceholder: true },
        }, phoneOnly);

        await expect(link(phoneOnly)).resolves.toBeNull();
        expect(doc(leadPath('L1')).applicationId).toBeUndefined();
    });

    it("never another company's lead", async () => {
        seed({ 'companies/co2/leads/L9': { email: 'alice.driver@example.com', normalizedPhone: '5550101000' } });

        await expect(link()).resolves.toBeNull();
        expect(doc('companies/co2/leads/L9').applicationId).toBeUndefined();
    });

    it('not a lead whose email has since changed, though its old lowercased copy still matches', async () => {
        seed({ [leadPath('L1')]: { email: 'new.address@example.com', emailNormalized: 'alice.driver@example.com' } });

        await expect(link()).resolves.toBeNull();
    });

    it('moves the link of a lead that applied before to the newest application', async () => {
        seed({ [leadPath('L1')]: { email: 'alice.driver@example.com', applicationId: 'older-app' } });

        await link();

        expect(doc(leadPath('L1')).applicationId).toBe(APP);
    });
});

describe("the lead's recruiter", () => {
    const ASSIGNED_LEAD = { [leadPath('L1')]: { email: 'alice.driver@example.com', assignedTo: 'rec-1', assignedToName: 'Riley' } };

    it('takes an unassigned application and is told once, with the application to open', async () => {
        seed(ASSIGNED_LEAD);

        await expect(link()).resolves.toMatchObject({ assigned: true, recruiterId: 'rec-1' });

        expect(doc(APP_PATH)).toEqual(expect.objectContaining({
            fromLeadId: 'L1', assignedTo: 'rec-1', assignedToName: 'Riley Recruiter',
        }));
        expect(notifications()).toEqual([expect.objectContaining({
            id: `lead_applied_${APP}`,
            type: 'lead_applied',
            title: 'Your lead applied',
            message: 'Alice Driver submitted an application; it is assigned to you',
            recipientId: 'rec-1',
            relatedType: 'application',
            relatedId: APP,
            read: false,
        })]);
    });

    it('is told, without taking it, when the application already has a recruiter', async () => {
        seed(ASSIGNED_LEAD, { ...APPLICATION, assignedTo: 'rec-2', assignedToName: 'Robin' });

        await expect(link()).resolves.toMatchObject({ assigned: false, recruiterId: 'rec-1' });

        expect(doc(APP_PATH)).toEqual(expect.objectContaining({ assignedTo: 'rec-2', assignedToName: 'Robin', fromLeadId: 'L1' }));
        expect(notifications()).toEqual([expect.objectContaining({
            recipientId: 'rec-1', message: 'Alice Driver submitted an application',
        })]);
    });

    it('neither takes it nor is told once off the team', async () => {
        seed(ASSIGNED_LEAD);
        mock.docs.delete('memberships/m1');

        await expect(link()).resolves.toMatchObject({ assigned: false, recruiterId: null });

        expect(doc(APP_PATH).assignedTo).toBeUndefined();
        expect(doc(APP_PATH).fromLeadId).toBe('L1');
        expect(notifications()).toEqual([]);
    });

    it('cannot stop the link when the team cannot be read: nobody is assigned or told', async () => {
        seed(ASSIGNED_LEAD);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const collection = mock.db.collection;
        jest.spyOn(mock.db, 'collection').mockImplementation((name) => {
            if (name === 'memberships') throw new Error('memberships unavailable');
            return collection(name);
        });

        await expect(link()).resolves.toMatchObject({ leadId: 'L1', assigned: false, recruiterId: null });

        expect(doc(APP_PATH).fromLeadId).toBe('L1');
        expect(doc(APP_PATH).assignedTo).toBeUndefined();
        expect(notifications()).toEqual([]);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Could not check'), 'memberships unavailable');
    });
});

describe('a repeated delivery', () => {
    it('changes nothing and tells nobody again', async () => {
        seed({ [leadPath('L1')]: { email: 'alice.driver@example.com', assignedTo: 'rec-1' } });
        await link();
        const before = JSON.stringify([...mock.docs.entries()]);

        await expect(link()).resolves.toBeNull();

        expect(JSON.stringify([...mock.docs.entries()])).toBe(before);
        expect(notifications()).toHaveLength(1);
    });
});

describe('deleting one end of the link', () => {
    it('an application: its lead no longer reads as applied', async () => {
        seed({ [leadPath('L1')]: { email: 'alice.driver@example.com', status: 'New Lead' } });
        await link();
        const application = doc(APP_PATH);
        mock.docs.delete(APP_PATH);

        await unlinkDeletedRecord({ companyId: CO, collectionName: 'applications', recordId: APP, data: application });

        expect(doc(leadPath('L1'))).toEqual({ email: 'alice.driver@example.com', status: 'New Lead' });
    });

    it('a lead: its application no longer names it', async () => {
        seed({ [leadPath('L1')]: { email: 'alice.driver@example.com' } });
        await link();
        const lead = doc(leadPath('L1'));
        mock.docs.delete(leadPath('L1'));

        await unlinkDeletedRecord({ companyId: CO, collectionName: 'leads', recordId: 'L1', data: lead });

        expect(doc(APP_PATH).fromLeadId).toBeUndefined();
    });

    it('leaves a link that has moved on to another record', async () => {
        seed({ [leadPath('L1')]: { email: 'alice.driver@example.com', applicationId: 'newer-app' } });

        await unlinkDeletedRecord({ companyId: CO, collectionName: 'applications', recordId: APP, data: { fromLeadId: 'L1' } });

        expect(doc(leadPath('L1')).applicationId).toBe('newer-app');
    });

    it("never reads an application's own applicationId as a link", async () => {
        seed({});

        await unlinkDeletedRecord({ companyId: CO, collectionName: 'applications', recordId: APP, data: { applicationId: APP } });
        await unlinkDeletedRecord({ companyId: CO, collectionName: 'leads', recordId: 'L1', data: {} });

        expect(doc(APP_PATH)).toEqual(APPLICATION);
    });
});
