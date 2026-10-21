// The owner panel's screen is in the address. All ids below are artificial.
import { describe, expect, it } from 'vitest';
import {
    COMPANY_TABS,
    SUPER_ADMIN_NAV_ITEMS,
    SUPER_ADMIN_VIEWS,
    superAdminMovedPath,
    superAdminPathFor,
    superAdminViewFromPath,
} from './views';

describe('the owner panel address', () => {
    it('names the dashboard by the panel alone, and every other screen by its view', () => {
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.DASHBOARD)).toBe('/super-admin');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANIES)).toBe('/super-admin/companies');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.ENVIRONMENT)).toBe('/super-admin/environment-integrations');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.MAINTENANCE)).toBe('/super-admin/maintenance');
    });

    it("names a company's screen under the list, and a tab only when it is not the first", () => {
        expect(COMPANY_TABS).toEqual(['features', 'sms']);
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANY, 'co-7')).toBe('/super-admin/companies/co-7');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANY, 'co-7', 'features')).toBe('/super-admin/companies/co-7');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANY, 'co-7', 'sms')).toBe('/super-admin/companies/co-7/sms');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANY, 'co-7', 'nowhere')).toBe('/super-admin/companies/co-7');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANY)).toBe('/super-admin/companies');
    });

    it('reads back every screen it names', () => {
        for (const view of Object.values(SUPER_ADMIN_VIEWS)) {
            const tabs = view === SUPER_ADMIN_VIEWS.COMPANY ? COMPANY_TABS : [null];
            for (const tab of tabs) {
                const companyId = view === SUPER_ADMIN_VIEWS.COMPANY ? 'co-7' : null;
                const path = superAdminPathFor(view, companyId, tab);
                expect(superAdminViewFromPath(path.replace('/super-admin', '')), path).toEqual({ view, companyId, tab });
            }
        }
    });

    it('takes any other address for the dashboard', () => {
        const dashboard = { view: SUPER_ADMIN_VIEWS.DASHBOARD, companyId: null, tab: null };
        for (const subPath of [undefined, '', 'nowhere', 'company', 'integration-setup', 'companies/co-7/nowhere',
            'companies/co-7/sms/more', 'integrations/co-7/more', 'stats-backfill/extra', 'features/extra']) {
            expect(superAdminViewFromPath(subPath), String(subPath)).toEqual(dashboard);
        }
        expect(superAdminPathFor('nowhere')).toBe('/super-admin');
    });
});

describe('screens that were merged into another', () => {
    it('opens Maintenance from the old Stats Backfill address, and names where it moved', () => {
        expect(superAdminViewFromPath('stats-backfill')).toEqual({ view: SUPER_ADMIN_VIEWS.MAINTENANCE, companyId: null, tab: null });
        expect(superAdminMovedPath('stats-backfill')).toBe('/super-admin/maintenance');
    });

    it('opens the Dashboard from the old Analytics address, and names the panel itself as where it moved', () => {
        expect(superAdminViewFromPath('analytics')).toEqual({ view: SUPER_ADMIN_VIEWS.DASHBOARD, companyId: null, tab: null });
        expect(superAdminMovedPath('analytics')).toBe('/super-admin');
    });

    it('offers no Analytics in the rail: activity is on the Dashboard', () => {
        expect(SUPER_ADMIN_NAV_ITEMS.map((item) => item.label)).not.toContain('Analytics');
        expect(Object.values(SUPER_ADMIN_VIEWS)).not.toContain('analytics');
        expect(SUPER_ADMIN_NAV_ITEMS.filter((item) => item.group === 'core').map((item) => item.label)).toEqual(['Dashboard']);
    });

    it('opens the companies list from the old SMS Integrations address', () => {
        expect(superAdminViewFromPath('integrations')).toEqual({ view: SUPER_ADMIN_VIEWS.COMPANIES, companyId: null, tab: null });
        expect(superAdminMovedPath('integrations')).toBe('/super-admin/companies');
    });

    it('opens the features overview at its address, a view of every company\'s features', () => {
        expect(superAdminViewFromPath('features')).toEqual({ view: SUPER_ADMIN_VIEWS.FEATURES, companyId: null, tab: null });
        expect(superAdminMovedPath('features')).toBeNull();
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.FEATURES)).toBe('/super-admin/features');
        const labels = SUPER_ADMIN_NAV_ITEMS.map((item) => item.label);
        expect(labels.slice(labels.indexOf('Companies'), labels.indexOf('Companies') + 2)).toEqual(['Companies', 'Features']);
    });

    it("opens a company's SMS tab from the old address of its SMS setup", () => {
        expect(superAdminViewFromPath('integrations/co-7')).toEqual({ view: SUPER_ADMIN_VIEWS.COMPANY, companyId: 'co-7', tab: 'sms' });
        expect(superAdminMovedPath('integrations/co-7')).toBe('/super-admin/companies/co-7/sms');
    });

    it('offers no SMS Integrations in the rail: it is on a company\'s screen', () => {
        const labels = SUPER_ADMIN_NAV_ITEMS.map((item) => item.label);
        expect(labels).not.toContain('Global Features');
        expect(labels).not.toContain('SMS Integrations');
        expect(Object.values(SUPER_ADMIN_VIEWS)).not.toContain('integrations');
    });

    it('moves nothing else', () => {
        for (const subPath of [undefined, '', 'maintenance', 'companies', 'companies/co-7', 'companies/co-7/sms', 'nowhere',
            'stats-backfill/extra', 'analytics/extra', 'features/extra', 'integrations/co-7/more']) {
            expect(superAdminMovedPath(subPath), String(subPath)).toBeNull();
        }
    });

    it('offers Maintenance in the rail where Stats Backfill was, and no Stats Backfill', () => {
        const labels = SUPER_ADMIN_NAV_ITEMS.map((item) => item.label);
        expect(labels).not.toContain('Stats Backfill');
        expect(SUPER_ADMIN_NAV_ITEMS.find((item) => item.label === 'Maintenance'))
            .toMatchObject({ id: SUPER_ADMIN_VIEWS.MAINTENANCE, group: 'ops' });
        expect(labels.slice(labels.indexOf('Releases'), labels.indexOf('Releases') + 2)).toEqual(['Releases', 'Maintenance']);
    });
});
