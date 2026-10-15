// The owner panel's screen is in the address. All ids below are artificial.
import { describe, expect, it } from 'vitest';
import { SUPER_ADMIN_VIEWS, superAdminPathFor, superAdminViewFromPath } from './views';

describe('the owner panel address', () => {
    it('names the dashboard by the panel alone, and every other screen by its view', () => {
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.DASHBOARD)).toBe('/super-admin');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANIES)).toBe('/super-admin/companies');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.ENVIRONMENT)).toBe('/super-admin/environment-integrations');
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
        for (const subPath of [undefined, '', 'nowhere', 'integration-setup', 'companies/extra', 'integrations/co-7/more']) {
            expect(superAdminViewFromPath(subPath), String(subPath)).toEqual({ view: SUPER_ADMIN_VIEWS.DASHBOARD, companyId: null });
        }
        expect(superAdminPathFor('nowhere')).toBe('/super-admin');
        expect(superAdminPathFor(SUPER_ADMIN_VIEWS.INTEGRATION_SETUP)).toBe('/super-admin/integrations');
    });
});
