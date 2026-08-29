import React, { useMemo } from 'react';
import {
  LayoutDashboard,
  Building,
  Users,
  FileText,
  Layers,
  Plus,
  BarChart3,
  Activity,
  MessageSquare,
  RefreshCw,
  KeyRound,
  Sparkles,
  Globe,
  Inbox,
  Newspaper,
  Rocket,
} from "lucide-react";
import { SectionNavigation } from '@/design-system/components';
import { SUPER_ADMIN_NAV_ITEMS } from '../config/views';

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
  Layers,
  Plus,
  BarChart3,
  Activity,
  MessageSquare,
  RefreshCw,
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
 * frozen routing contract; naming them is a presentation decision and belongs
 * here. `SectionNavigation` renders each group's label as a real heading, which
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
 * Migrated to the approved `SectionNavigation` primitive 2026-07-28.
 * Presentation only — `setActiveView` still receives the exact
 * `SUPER_ADMIN_VIEWS` value for each item, item order and grouping are
 * unchanged, and selecting an item still clears the global search first.
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
      // An unrecognised icon name used to resolve to `undefined` and render
      // nothing, which does not fail — it collapses the row to zero width and
      // breaks the label one character per line. Caught by the visual gate on
      // 2026-08-29 after a new entry named an icon this map did not import.
      // Failing loudly here costs nothing and is findable; the silent version
      // was neither.
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
      // While a global search is showing results, no section is the current one.
      currentId={isSearching ? null : activeView}
      onSelect={handleSelect}
      // `SectionNavigation` takes a fixed prop list and does not spread extras,
      // so there is no `data-testid` here — tests target the named landmark.
      className="w-full shrink-0 sm:sticky sm:top-24 sm:w-64"
    />
  );
}
