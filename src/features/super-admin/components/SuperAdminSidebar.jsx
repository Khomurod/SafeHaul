import React, { useMemo } from 'react';
import { LayoutDashboard, Building, Users, FileText, Plus, Activity, Wrench, KeyRound, Sparkles, Globe, Inbox, Newspaper, Rocket } from '@design-system/icons';
import { SectionNavigation } from '@/design-system/components';
import { SUPER_ADMIN_NAV_ITEMS, SUPER_ADMIN_VIEWS } from '../config/views';

/**
 * Exported so a test can assert every configured icon name resolves. The nav
 * config and this map are two halves of one contract, and nothing else pairs
 * them.
 */
export const NAV_ICONS = {
  LayoutDashboard,
  Building,
  Users,
  FileText,
  Plus,
  Activity,
  Wrench,
  KeyRound,
  Sparkles,
  Newspaper,
  Globe,
  Inbox,
  Rocket,
};

/**
 * Visible names for the group keys in `SUPER_ADMIN_NAV_ITEMS`.
 *
 * The config carries internal keys (`core`, `data`, ...) because it is the
 * routing contract; naming them is a presentation decision and belongs here.
 * `SectionNavigation` renders each group's label as a real heading, which
 * replaces the previous purely decorative divider — the grouping is now
 * announced rather than implied by a horizontal line.
 */
const GROUP_LABELS = {
  core: 'Overview',
  data: 'Data',
  ops: 'Operations',
  create: 'Create',
};

/**
 * Super Admin section navigation.
 *
 * Built on the approved `SectionNavigation` primitive. Presentation only —
 * `setActiveView` receives the exact `SUPER_ADMIN_VIEWS` value for each item,
 * the items, their order and their groups are `SUPER_ADMIN_NAV_ITEMS` as the
 * config lists them, and selecting an item clears the global search.
 *
 * An earlier revision of this migration hand-rolled the rail and justified it by
 * claiming `SectionNavigation` was a "flat list" contract. That was simply
 * wrong: it takes `groups`, and it already owns `aria-current`, roving
 * Arrow/Home/End focus movement, a named `<nav>` landmark, and a responsive
 * `mobileLayout`. Hand-rolling it recreated exactly the competing visual
 * primitive — feature-local active, hover, focus, spacing and radius treatments
 * — that this migration exists to remove. Reusing the primitive also fixes the
 * mobile overflow the old rail caused (`w-full sm:w-64 shrink-0` inside a flex
 * row, which demanded the full viewport and refused to shrink) and adds
 * keyboard arrow navigation the feature-local version never had.
 */
export function SuperAdminSidebar({
  activeView,
  setActiveView,
  isSearching,
  onClearSearch,
}) {
  const groups = useMemo(() => {
    const byGroup = [];
    SUPER_ADMIN_NAV_ITEMS.forEach((item) => {
      let group = byGroup.find((g) => g.id === item.group);
      if (!group) {
        group = { id: item.group, label: GROUP_LABELS[item.group] || item.group, items: [] };
        byGroup.push(group);
      }
      // An unrecognised icon name would resolve to `undefined` and render
      // nothing, which does not fail — it collapses the row to zero width and
      // breaks the label one character per line. Failing loudly here costs
      // nothing and is findable.
      const Icon = NAV_ICONS[item.icon];
      if (!Icon) throw new Error(`SuperAdminSidebar: no icon named "${item.icon}" — add it to NAV_ICONS.`);
      group.items.push({ id: item.id, label: item.label, icon: Icon });
    });
    return byGroup;
  }, []);

  const handleSelect = (viewName) => {
    setActiveView(viewName);
    if (onClearSearch) onClearSearch();
  };

  return (
    <SectionNavigation
      label="Super Admin sections"
      groups={groups}
      // While a global search is showing results, no section is the current one;
      // a company's own screen is part of Companies.
      currentId={isSearching ? null
        : activeView === SUPER_ADMIN_VIEWS.COMPANY ? SUPER_ADMIN_VIEWS.COMPANIES : activeView}
      onSelect={handleSelect}
      // `SectionNavigation` takes a fixed prop list and does not spread extras,
      // so there is no `data-testid` here — tests target the named landmark.
      className="w-full shrink-0 sm:sticky sm:top-24 sm:w-64"
    />
  );
}
