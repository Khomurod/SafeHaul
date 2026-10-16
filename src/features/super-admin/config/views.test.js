// The owner panel's screen is in the address. All ids below are artificial.
import { describe, expect, it } from 'vitest';
import {
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
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.INTEGRATION_SETUP, 'co-7')).toBe('/super-admin/integrations/co-7');
    });

    it('reads back every screen it names', () => {
        for (const view of Object.values(SUPER_ADMIN_VIEWS)) {
            const companyId = view === SUPER_ADMIN_VIEWS.INTEGRATION_SETUP ? 'co-7' : null;
            const path = superAdminPathFor(view, companyId);
            expect(superAdminViewFromPath(path.replace('/super-admin', '')), path).toEqual({ view, companyId });
        }
    });

    it('takes any other address for the dashboard', () => {
        for (const subPath of [undefined, '', 'nowhere', 'integration-setup', 'companies/extra', 'integrations/co-7/more', 'stats-backfill/extra']) {
            expect(superAdminViewFromPath(subPath), String(subPath)).toEqual({ view: SUPER_ADMIN_VIEWS.DASHBOARD, companyId: null });
        }
        expect(superAdminPathFor('nowhere')).toBe('/super-admin');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.INTEGRATION_SETUP)).toBe('/super-admin/integrations');
    });
});

describe('screens that were merged into another', () => {
    it('opens Maintenance from the old Stats Backfill address, and names where it moved', () => {
        expect(superAdminViewFromPath('stats-backfill')).toEqual({ view: SUPER_ADMIN_VIEWS.MAINTENANCE, companyId: null });
        expect(superAdminMovedPath('stats-backfill')).toBe('/super-admin/maintenance');
    });

    it('opens the Dashboard from the old Analytics address, and names the panel itself as where it moved', () => {
        expect(superAdminViewFromPath('analytics')).toEqual({ view: SUPER_ADMIN_VIEWS.DASHBOARD, companyId: null });
        expect(superAdminMovedPath('analytics')).toBe('/super-admin');
    });

    it('offers no Analytics in the rail: activity is on the Dashboard', () => {
        expect(SUPER_ADMIN_NAV_ITEMS.map((item) => item.label)).not.toContain('Analytics');
        expect(Object.values(SUPER_ADMIN_VIEWS)).not.toContain('analytics');
        expect(SUPER_ADMIN_NAV_ITEMS.filter((item) => item.group === 'core').map((item) => item.label)).toEqual(['Dashboard']);
    });

    it('moves nothing else', () => {
        for (const subPath of [undefined, '', 'maintenance', 'companies', 'nowhere', 'stats-backfill/extra', 'analytics/extra', 'integrations/co-7']) {
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
