/**
 * The bell reaches the person a record's change is for (audit item 15):
 *  - a status change on an assigned application tells its assignee only; on an
 *    unassigned one (or one whose assignee left the team) it tells the team;
 *  - assigning an application or a lead tells the new owner only;
 *  - nobody is told about their own action. The browser stamps who acted
 *    (`statusChangedBy`/`statusChangedAt`, `assignmentChangedBy`/
 *    `assignmentChangedAt`); a stamp counts only when its time changed in the
 *    same write, so one left by an earlier change names nobody.
 *
 * Every notification holds names and stages only: the whole team can read
 * every company notification, so `recipientId` only hides it in the bell.
 * All names and ids below are artificial.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));
jest.mock('../../emailService', () => ({ sendDynamicEmail: jest.fn() }));

const { onApplicationStatusChanged, onApplicationAssigned, onLeadAssigned } = require('../../notificationTriggers');

/** A Firestore Timestamp as the Admin SDK hands it to a trigger. */
const at = (seconds) => ({ seconds, nanoseconds: 0, toMillis: () => seconds * 1000 });
const TEAM = [
    { userId: 'rec-ann', name: 'Ann Baker', role: 'recruiter' },
    { userId: 'rec-lee', name: 'Lee Chen', role: 'recruiter' },
    { userId: 'admin-rita', name: 'Rita Admin', role: 'company_admin' },
];
const APPLICANT = {
    firstName: 'Ivan', lastName: 'Petrov', email: 'ivan@example.test', phone: '5550001111', ssn: '000-00-0000',
};
const LEAD = { fullName: 'Olga Smirnova', email: 'olga@example.test', phone: '5550002222' };

const change = (params, before, after, id = 'evt-1') => ({
    id,
    params: { companyId: 'co1', ...params },
    data: { before: { data: () => before }, after: { data: () => after } },
});
const statusChange = (before, after, id) => onApplicationStatusChanged(change({ appId: 'app1' }, before, after, id));
const appAssignment = (before, after, id) => onApplicationAssigned(change({ appId: 'app1' }, before, after, id));
const leadAssignment = (before, after, id) => onLeadAssigned(change({ leadId: 'lead1' }, before, after, id));

/** The company's notifications, each without its server time. */
const notifications = () => [...mock.docs]
    .filter(([path]) => path.startsWith('companies/co1/notifications/'))
    .map(([, { createdAt, ...rest }]) => {
        expect(createdAt).toEqual(expect.any(Date));
        return rest;
    });

beforeEach(() => {
    mock.reset({ 'companies/co1': { companyName: 'Artificial Freight', teamMembers: TEAM } });
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a status change', () => {
    const before = { ...APPLICANT, status: 'New Application', assignedTo: 'rec-ann', assignedToName: 'Ann Baker' };

    it('tells only the assignee, naming the applicant and the stages and nothing else', async () => {
        await statusChange(before, {
            ...before, status: 'Interested', statusChangedBy: 'admin-rita', statusChangedAt: at(20),
        });

        expect(notifications()).toEqual([{
            type: 'status_change',
            title: 'Status Updated',
            message: 'Ivan Petrov moved from "New Application" to "Interested"',
            relatedId: 'app1',
            relatedType: 'application',
            oldStatus: 'New Application',
            newStatus: 'Interested',
            recipientId: 'rec-ann',
            actorId: 'admin-rita',
            read: false,
        }]);
    });

    it('tells nobody when the assignee changed it themselves', async () => {
        await statusChange(before, {
            ...before, status: 'Interested', statusChangedBy: 'rec-ann', statusChangedAt: at(20),
        });

        expect(notifications()).toEqual([]);
    });

    it('tells the team on an unassigned application, and the bell hides it from who changed it', async () => {
        const unassigned = { ...APPLICANT, status: 'New Application', assignedTo: '', assignedToName: '' };
        await statusChange(unassigned, {
            ...unassigned, status: 'Interested', statusChangedBy: 'rec-lee', statusChangedAt: at(20),
        });

        const [notice] = notifications();
        expect(notice).not.toHaveProperty('recipientId');
        expect(notice).toMatchObject({ type: 'status_change', actorId: 'rec-lee' });
    });

    it('takes a stamp left by an earlier change for nobody, so the assignee is told', async () => {
        // The assignee moved it last time; a screen that stamps nothing (or the
        // server) moves it now and leaves their stamp behind.
        const stamped = { ...before, status: 'Interested', statusChangedBy: 'rec-ann', statusChangedAt: at(20) };
        await statusChange(stamped, { ...stamped, status: 'Declined' });

        const [notice] = notifications();
        expect(notice).toMatchObject({ recipientId: 'rec-ann', newStatus: 'Declined' });
        expect(notice).not.toHaveProperty('actorId');
    });

    it('tells the team when the assignee is no longer on it', async () => {
        const orphan = { ...before, assignedTo: 'rec-gone', assignedToName: 'Former Recruiter' };
        await statusChange(orphan, {
            ...orphan, status: 'Interested', statusChangedBy: 'admin-rita', statusChangedAt: at(20),
        });

        const [notice] = notifications();
        expect(notice).not.toHaveProperty('recipientId');
        expect(notice).toMatchObject({ actorId: 'admin-rita' });
    });

    it('tells the assignee when the company has no team list to check against', async () => {
        mock.reset({ 'companies/co1': { companyName: 'Artificial Freight' } });
        await statusChange(before, { ...before, status: 'Interested' });

        expect(notifications()).toMatchObject([{ recipientId: 'rec-ann' }]);
    });

    it('adds one notification however often the same change is delivered', async () => {
        const after = { ...before, status: 'Interested', statusChangedBy: 'admin-rita', statusChangedAt: at(20) };
        await statusChange(before, after, 'evt-7');
        await statusChange(before, after, 'evt-7');

        expect(notifications()).toHaveLength(1);
    });

    it('writes nothing when the status did not change', async () => {
        await statusChange(before, { ...before, assignedTo: 'rec-lee' });

        expect(notifications()).toEqual([]);
    });
});

describe('assigning an application', () => {
    const before = { ...APPLICANT, status: 'New Application', assignedTo: '', assignedToName: '' };

    it('tells the new owner only, naming the applicant and nothing else', async () => {
        await appAssignment(before, {
            ...before,
            assignedTo: 'rec-lee',
            assignedToName: 'Lee Chen',
            assignmentChangedBy: 'admin-rita',
            assignmentChangedAt: at(30),
        });

        expect(notifications()).toEqual([{
            type: 'application_assigned',
            title: 'Application Assigned',
            message: 'Ivan Petrov was assigned to you',
            relatedId: 'app1',
            relatedType: 'application',
            recipientId: 'rec-lee',
            assignedTo: 'rec-lee',
            assignedToName: 'Lee Chen',
            actorId: 'admin-rita',
            read: false,
        }]);
    });

    it('tells nobody when the owner assigned it to themselves', async () => {
        await appAssignment(before, {
            ...before, assignedTo: 'rec-lee', assignedToName: 'Lee Chen',
            assignmentChangedBy: 'rec-lee', assignmentChangedAt: at(30),
        });

        expect(notifications()).toEqual([]);
    });

    it('tells the owner of an assignment nobody stamped, such as a recruiter link on submission', async () => {
        await appAssignment(before, { ...before, assignedTo: 'rec-ann', assignedToName: 'Ann Baker' });

        const [notice] = notifications();
        expect(notice).toMatchObject({ recipientId: 'rec-ann', type: 'application_assigned' });
        expect(notice).not.toHaveProperty('actorId');
    });

    it('takes an assignment stamp left by an earlier change for nobody', async () => {
        const stamped = {
            ...before, assignedTo: 'rec-ann', assignedToName: 'Ann Baker',
            assignmentChangedBy: 'rec-lee', assignmentChangedAt: at(30),
        };
        await appAssignment(stamped, { ...stamped, assignedTo: 'rec-lee', assignedToName: 'Lee Chen' });

        expect(notifications()).toMatchObject([{ recipientId: 'rec-lee' }]);
    });

    it('writes nothing on unassigning, or when the owner stays', async () => {
        const owned = { ...before, assignedTo: 'rec-ann', assignedToName: 'Ann Baker' };
        await appAssignment(owned, {
            ...owned, assignedTo: '', assignedToName: '', assignmentChangedBy: 'admin-rita', assignmentChangedAt: at(30),
        });
        await appAssignment(owned, { ...owned, status: 'Interested' });

        expect(notifications()).toEqual([]);
    });

    it('adds one notification however often the same assignment is delivered', async () => {
        const after = { ...before, assignedTo: 'rec-ann', assignedToName: 'Ann Baker' };
        await appAssignment(before, after, 'evt-9');
        await appAssignment(before, after, 'evt-9');

        expect(notifications()).toHaveLength(1);
    });
});

describe('assigning a lead', () => {
    const before = { ...LEAD, status: 'New Lead', assignedTo: '', assignedToName: '' };

    it('tells the new owner only, no longer the whole team', async () => {
        await leadAssignment(before, {
            ...before, assignedTo: 'rec-ann', assignedToName: 'Ann Baker',
            assignmentChangedBy: 'admin-rita', assignmentChangedAt: at(40),
        });

        expect(notifications()).toEqual([{
            type: 'lead_assigned',
            title: 'Lead Assigned',
            message: 'Olga Smirnova was assigned to you',
            relatedId: 'lead1',
            relatedType: 'lead',
            recipientId: 'rec-ann',
            assignedTo: 'rec-ann',
            assignedToName: 'Ann Baker',
            actorId: 'admin-rita',
            read: false,
        }]);
    });

    it('tells nobody when the owner took the lead themselves', async () => {
        await leadAssignment(before, {
            ...before, assignedTo: 'rec-ann', assignedToName: 'Ann Baker',
            assignmentChangedBy: 'rec-ann', assignmentChangedAt: at(40),
        });

        expect(notifications()).toEqual([]);
    });

    it('still tells the owner when the screen that assigned it stamps nothing', async () => {
        await leadAssignment(before, { ...before, assignedTo: 'rec-lee' });

        expect(notifications()).toMatchObject([{ recipientId: 'rec-lee', assignedToName: '' }]);
    });
});
