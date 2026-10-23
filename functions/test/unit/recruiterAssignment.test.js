/**
 * `resolveRecruiterAssignment` reads nothing for a code that could not be a
 * link or a user id. The cases that read are in driverSync.applicationWrites.
 */
const { resolveRecruiterAssignment } = require('../../shared/recruiterAssignment');

describe('resolveRecruiterAssignment', () => {
    it.each([undefined, null, '', '   ', 42, 'a/b', 'x'.repeat(129)])('assigns nobody, reading nothing, for %p', async (code) => {
        const db = { collection: jest.fn() };
        await expect(resolveRecruiterAssignment(db, 'co1', code)).resolves.toBeNull();
        expect(db.collection).not.toHaveBeenCalled();
    });

    it('needs the company', async () => {
        const db = { collection: jest.fn() };
        await expect(resolveRecruiterAssignment(db, '', 'CODE1234')).resolves.toBeNull();
        expect(db.collection).not.toHaveBeenCalled();
    });
});
