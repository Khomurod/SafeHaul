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
  Newspaper,
} from "lucide-react";
import { SectionNavigation } from '@/design-system/components';
import { SUPER_ADMIN_NAV_ITEMS } from '../config/views';

const ICONS = {
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
      group.items.push({ id: item.id, label: item.label, icon: ICONS[item.icon] });
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
