/**
 * The application link a campaign's `[Application Link]` and an automated
 * text's `{application link}` become (`shared/applicationLink.js`): the
 * company's apply page with the record's recruiter's link code, so the
 * application is theirs; the plain apply page otherwise. Nothing about the
 * driver is in it.
 *
 * Every company, person and code below is artificial.
 */
const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock({}, { filters: true });

const { applicationLinks, applyUrl } = require('../../shared/applicationLink');

const COMPANY = { companyName: 'Artificial Freight', appSlug: 'artificial-freight' };

beforeEach(() => {
    mock.reset({
        'recruiter_links/RIL2345': { userId: 'rec-1', companyId: 'co1' },
        'recruiter_links/OTH2345': { userId: 'rec-1', companyId: 'co2' },
        'recruiter_links/SAM2345': { userId: 'rec-2', companyId: 'co1' },
    });
});

describe('applyUrl', () => {
    it("is the company's apply page, with the code when there is one", () => {
        expect(applyUrl(COMPANY, 'co1', 'RIL2345')).toBe('https://app.safehaul.io/apply/artificial-freight?r=RIL2345');
        expect(applyUrl(COMPANY, 'co1', null)).toBe('https://app.safehaul.io/apply/artificial-freight');
    });

    it("takes the company's own app address, and the company id when it has no slug", () => {
        expect(applyUrl({ appUrl: 'https://jobs.example.com/' }, 'co1', null)).toBe('https://jobs.example.com/apply/co1');
        expect(applyUrl({ appUrl: 'not a web address', appSlug: 'a b' }, 'co1', null)).toBe('https://app.safehaul.io/apply/a%20b');
    });
});

describe('applicationLinks', () => {
    it("gives the assignee's link for this company, the plain page for no assignee or no link", async () => {
        const linkFor = applicationLinks(mock.db, 'co1', COMPANY);

        await expect(linkFor('rec-1')).resolves.toBe('https://app.safehaul.io/apply/artificial-freight?r=RIL2345');
        await expect(linkFor('rec-2')).resolves.toBe('https://app.safehaul.io/apply/artificial-freight?r=SAM2345');
        await expect(linkFor('rec-3')).resolves.toBe('https://app.safehaul.io/apply/artificial-freight');
        await expect(linkFor('')).resolves.toBe('https://app.safehaul.io/apply/artificial-freight');
        await expect(linkFor(undefined)).resolves.toBe('https://app.safehaul.io/apply/artificial-freight');
    });

    it("never another company's link of the same recruiter", async () => {
        mock.docs.delete('recruiter_links/RIL2345');

        await expect(applicationLinks(mock.db, 'co1', COMPANY)('rec-1'))
            .resolves.toBe('https://app.safehaul.io/apply/artificial-freight');
    });

    it('looks each recruiter up once for the batch', async () => {
        const db = { collection: jest.fn((name) => mock.db.collection(name)) };
        const linkFor = applicationLinks(db, 'co1', COMPANY);

        await Promise.all([linkFor('rec-1'), linkFor('rec-1'), linkFor('rec-2')]);
        await linkFor('rec-1');

        expect(db.collection).toHaveBeenCalledTimes(2);
    });

    it('gives the plain page when the lookup fails', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const db = { collection: () => { throw new Error('unavailable'); } };

        await expect(applicationLinks(db, 'co1', COMPANY)('rec-1'))
            .resolves.toBe('https://app.safehaul.io/apply/artificial-freight');
        expect(console.warn).toHaveBeenCalled();
        console.warn.mockRestore();
    });
});
