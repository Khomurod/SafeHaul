import { describe, expect, it } from 'vitest';
import { mockCompanies, mockCompanyApplications } from './companiesMock';

describe('companies fixture', () => {
    it('gives applications only to the company they belong to', () => {
        const [withApps, ...others] = mockCompanies();
        expect(mockCompanyApplications(withApps.id)).toHaveLength(4);
        others.forEach((company) => expect(mockCompanyApplications(company.id)).toEqual([]));
        expect(mockCompanyApplications(undefined)).toEqual([]);
    });

    it('uses only made-up ids and 555-01xx numbers', () => {
        const apps = mockCompanyApplications('e2e-co-1');
        expect(new Set(apps.map((app) => app.id)).size).toBe(apps.length);
        apps.filter((app) => app.phone).forEach((app) => expect(app.phone).toMatch(/^\(555\) 010-01\d\d$/));
        mockCompanies().forEach((company) => expect(company.id).toMatch(/^e2e-co-/));
    });
});
