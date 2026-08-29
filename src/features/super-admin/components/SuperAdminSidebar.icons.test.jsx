/**
 * Every navigation entry must name an icon the sidebar can actually render.
 *
 * ## Why this exists
 *
 * `SUPER_ADMIN_NAV_ITEMS` carries icon names as strings and `SuperAdminSidebar`
 * resolves them through an explicit `ICONS` map. A name the map does not have
 * used to resolve to `undefined`, and `undefined` does not throw — it renders
 * nothing, the row collapses to zero width, and the label wraps **one character
 * per line**, adding a hundred-odd pixels of broken navigation.
 *
 * That happened on 2026-08-29: a new entry named `Inbox`, which was not
 * imported. Nothing failed. The unit suites passed, lint passed, the build
 * passed; only the visual-regression gate caught it, and only because a full-page
 * screenshot got taller. **A defect that is invisible to every check but a pixel
 * diff is one worth a cheap direct test**, which is this file.
 */
import { describe, expect, it } from 'vitest';

import { SUPER_ADMIN_NAV_ITEMS } from '../config/views';
import { NAV_ICONS } from './SuperAdminSidebar';

describe('super-admin navigation icons', () => {
    it('resolves an icon for every configured entry', () => {
        const unresolved = SUPER_ADMIN_NAV_ITEMS
            .filter((item) => !NAV_ICONS[item.icon])
            .map((item) => `${item.id} names "${item.icon}"`);
        expect(unresolved).toEqual([]);
    });

    it('every entry names an icon at all', () => {
        const missing = SUPER_ADMIN_NAV_ITEMS.filter((item) => !item.icon).map((item) => item.id);
        expect(missing).toEqual([]);
    });

    it('maps only to real components, not to stray truthy values', () => {
        // `ICONS[name]` being truthy is not enough — a string would pass the
        // check above and still fail to render as a component.
        for (const [name, Icon] of Object.entries(NAV_ICONS)) {
            expect(typeof Icon === 'function' || typeof Icon === 'object', `${name} is not a component`).toBe(true);
        }
    });
});
