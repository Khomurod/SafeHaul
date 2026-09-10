/**
 * The four cases one merged table has to keep apart.
 *
 * `Started (unfinished)` and `Start an application` became one workspace on
 * 2026-09-10, and the risk in that move is uniformity: a driver-started row
 * offered the same actions as a carrier-prepared one would hand a recruiter a
 * read they must not have. These drive the decision directly, so it is pinned
 * whatever any table later renders.
 */
import { describe, expect, it } from 'vitest';
import { describeApplicant, describeProgress, describeUnfinishedRow, startedBy } from './unfinishedRowActions';

const COMPANY = { origin: 'company', preparedBy: { name: 'Rae Recruiter' } };

describe('who started it', () => {
    it('reads the origin the server sent', () => {
        expect(startedBy({ origin: 'company' })).toBe('company');
        expect(startedBy({ origin: 'driver' })).toBe('driver');
    });

    it('treats anything else as the driver, which is what an absent origin means', () => {
        // `origin` is set only on a carrier-prepared draft — its absence has always
        // meant the driver typed it, and a draft written before the field existed
        // has none. Guessing "company" here would offer a read on somebody else's
        // application.
        expect(startedBy({})).toBe('driver');
        expect(startedBy(undefined)).toBe('driver');
        expect(startedBy({ origin: 'COMPANY' })).toBe('driver');
    });
});

describe('a driver-started application', () => {
    const row = describeUnfinishedRow({ origin: 'driver', status: 'in_progress' });

    it('cannot be opened by the carrier', () => {
        // Not a style choice: `getCompanyPreparedDraft` refuses a draft the carrier
        // did not author with a flat `not-found`, so an Open here would be a button
        // that cannot work.
        expect(row.canOpenPrepared).toBe(false);
    });

    it('is the driver’s answers, and says so plainly', () => {
        expect(row.driverOwnsAnswers).toBe(true);
        expect(row.startedByLabel).toBe('Driver');
        expect(row.statusLabel).toBe('Unfinished');
        expect(row.mintLabel).toBe('Create a continuation link');
    });

    it('never attributes it to somebody at the company', () => {
        expect(describeUnfinishedRow({ origin: 'driver', preparedBy: { name: 'Rae' } }).preparedByName).toBeNull();
        expect(describeUnfinishedRow({ origin: 'driver', lockedEmployerCount: 3 }).lockedEmployersLabel).toBeNull();
    });
});

describe('an application the carrier prepared', () => {
    it('before a link goes out, is open and offers the first link', () => {
        const row = describeUnfinishedRow({ ...COMPANY, status: 'prepared' });

        expect(row.canOpenPrepared).toBe(true);
        expect(row.driverOwnsAnswers).toBe(false);
        expect(row.statusLabel).toBe('Not sent yet');
        expect(row.mintLabel).toBe("Create the driver's link");
        expect(row.preparedByName).toBe('Rae Recruiter');
    });

    it('once sent, offers a replacement rather than pretending to re-show the first', () => {
        // The raw token comes back from the callable exactly once, so "copy the
        // link you sent" is not a thing this product can offer.
        const row = describeUnfinishedRow({ ...COMPANY, status: 'sent' });

        expect(row.statusLabel).toBe('Link sent');
        expect(row.mintLabel).toBe('Create a replacement link');
        expect(row.canOpenPrepared).toBe(true);
        expect(row.driverOwnsAnswers).toBe(false);
    });

    it('once the driver has written, is theirs — and the row still opens', () => {
        const row = describeUnfinishedRow({ ...COMPANY, status: 'driver_in_progress' });

        // The one-way door. `driverOwnsAnswers` is what the screen says about the
        // link; the answers themselves are refused by the server on every load, so
        // the carrier keeps its way back to its own record without gaining a read.
        expect(row.driverOwnsAnswers).toBe(true);
        expect(row.canOpenPrepared).toBe(true);
        expect(row.statusLabel).toBe('Driver is filling it in');
        expect(row.mintLabel).toBe('Create a continuation link');
    });

    it('counts the employers it locked, because an orphaned lock used to be invisible', () => {
        expect(describeUnfinishedRow({ ...COMPANY, lockedEmployerCount: 1 }).lockedEmployersLabel)
            .toBe('1 employer locked');
        expect(describeUnfinishedRow({ ...COMPANY, lockedEmployerCount: 4 }).lockedEmployersLabel)
            .toBe('4 employers locked');
        expect(describeUnfinishedRow({ ...COMPANY, lockedEmployerCount: 0 }).lockedEmployersLabel).toBeNull();
    });
});

describe('how far they got', () => {
    it('uses the wizard’s own words', () => {
        expect(describeProgress({ lastSemanticStep: 'license' })).toBe('License & credentials');
        expect(describeProgress({ lastSemanticStep: 'consent' })).toBe('Agreements & signature');
    });

    it('falls back to the number for a draft saved before the names existed', () => {
        expect(describeProgress({ lastStep: 2 })).toBe('Step 3');
        expect(describeProgress({})).toBe('Step 1');
        // An unknown name is not a label to print at the recruiter.
        expect(describeProgress({ lastSemanticStep: 'invented', lastStep: 4 })).toBe('Step 5');
    });
});

describe('what to call the applicant', () => {
    it('prefers their name', () => {
        const applicant = describeApplicant({ firstName: 'Dana', lastName: 'Alvarez', email: 'd@e.test' });
        expect(applicant.displayName).toBe('Dana Alvarez');
        expect(applicant.actionName).toBe('Dana Alvarez');
    });

    it('says a name was not entered, rather than showing an empty cell', () => {
        expect(describeApplicant({ email: 'd@e.test' }).displayName).toBe('Name not entered yet');
    });

    it('still gives a row action something specific to be named for', () => {
        // A table of identical "Create a continuation link" buttons tells a
        // screen-reader user nothing about which row they are on.
        expect(describeApplicant({ email: 'd@e.test' }).actionName).toBe('d@e.test');
        expect(describeApplicant({ phone: '2145550147' }).actionName).toBe('2145550147');
        expect(describeApplicant({}).actionName).toBe('this applicant');
    });
});
