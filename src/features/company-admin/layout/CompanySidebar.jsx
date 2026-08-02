import React, { useCallback, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Button, IconButton } from '@/design-system/components';
import {
  LayoutDashboard,
  Users,
  Building2,
  User,
  Search,
  FileText,
  Megaphone,
  Upload,
  PlusCircle,
  Settings,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GitBranch,
  X,
} from 'lucide-react';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import {
  COMPANY_ROUTE_MANIFEST,
  COMPANY_NAV_GROUPS,
  COMPANY_NAV_LAYOUT,
} from '@app/routes/companyRouteManifest';

const ICON_MAP = Object.freeze({
  LayoutDashboard,
  Users,
  Building2,
  User,
  Search,
  FileText,
  Megaphone,
  Upload,
  PlusCircle,
  Settings,
  GitBranch,
});

function stripEdgeDividers(entries) {
  const cleaned = [];
  for (const entry of entries) {
    if (entry.type === 'divider' && cleaned.length === 0) continue;
    if (entry.type === 'divider' && cleaned[cleaned.length - 1]?.type === 'divider') continue;
    cleaned.push(entry);
  }
  while (cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'divider') {
    cleaned.pop();
  }
  return cleaned;
}

export const CompanySidebar = ({
  isExpanded,
  onExpandedChange,
  onNavigate,
}) => {
  const [expandedGroups, setExpandedGroups] = useState({
    applications: true
  });

  const { currentCompanyProfile, currentUserClaims } = useData();
  const location = useLocation();
  const navigate = useNavigate();
  const routeLookup = useMemo(
    () => new Map(COMPANY_ROUTE_MANIFEST.map((route) => [route.id, route])),
    [],
  );
  const featureFlags = useMemo(
    () => currentCompanyProfile?.features || {},
    [currentCompanyProfile?.features],
  );

  const toggleSidebar = () => onExpandedChange(!isExpanded);

  const toggleGroup = (group) => {
    if (!isExpanded) {
      onExpandedChange(true);
      setExpandedGroups(prev => ({ ...prev, [group]: true }));
    } else {
      setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
    }
  };

  const companyId = currentCompanyProfile?.id;
  // UI-006: same admin check the route guard uses (isCompanyAdminForRoute) so the
  // menu and direct-URL access can never disagree.
  const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);

  const isRouteVisible = useCallback((route) => {
    const nav = route?.nav;
    if (!nav) return false;
    if (nav.adminOnly && !isCompanyAdmin) return false;
    if (nav.featureFlag && featureFlags[nav.featureFlag] === false) return false;
    return true;
  }, [featureFlags, isCompanyAdmin]);

  const toMenuItem = useCallback((route) => ({
    id: route.id,
    label: route.nav.label,
    icon: ICON_MAP[route.nav.icon] || FileText,
    path: `/company/${route.path}`,
  }), []);

  const menuEntries = useMemo(() => {
    const entries = [];
    for (const block of COMPANY_NAV_LAYOUT) {
      if (block.type === 'divider') {
        entries.push({ type: 'divider' });
        continue;
      }

      if (block.type === 'route') {
        const route = routeLookup.get(block.routeId);
        if (route && isRouteVisible(route)) {
          entries.push({ type: 'item', item: toMenuItem(route) });
        }
        continue;
      }

      if (block.type === 'section') {
        const routes = COMPANY_ROUTE_MANIFEST
          .filter((route) => route.nav?.kind === 'item' && route.nav.section === block.section)
          .filter((route) => isRouteVisible(route))
          .map(toMenuItem);
        for (const item of routes) entries.push({ type: 'item', item });
        continue;
      }

      if (block.type === 'group') {
        const group = COMPANY_NAV_GROUPS[block.group];
        if (!group) continue;
        const children = COMPANY_ROUTE_MANIFEST
          .filter((route) => route.nav?.kind === 'group-item' && route.nav.group === block.group)
          .filter((route) => isRouteVisible(route))
          .map(toMenuItem);
        if (children.length > 0) {
          entries.push({ type: 'group', group, children });
        }
      }
    }
    return stripEdgeDividers(entries);
  }, [isRouteVisible, routeLookup, toMenuItem]);

  const NavItem = ({ item, isChild = false }) => {
    return (
      <NavLink
        to={item.path}
        onClick={onNavigate}
        className={({ isActive }) => `
          min-h-10 flex items-center gap-3 px-3 py-2 rounded-ds-md transition-colors duration-200 group relative
          ${isActive
            ? 'bg-ds-status-info-bg text-ds-status-info-fg border-l-2 border-ds-action-primary'
            : 'text-ds-content-secondary hover:text-ds-content hover:bg-ds-surface-subtle border-l-2 border-transparent'}
          ${isChild ? 'pl-9 text-sm' : ''}
          ${!isExpanded && !isChild ? 'justify-center' : ''}
        `}
      >
        {({ isActive }) => (
          <>
            <item.icon
              size={20}
              aria-hidden="true"
              className={isActive
                ? 'text-ds-action-primary'
                : 'text-ds-content-muted group-hover:text-ds-content'}
            />

            {isExpanded && (
              <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                {item.label}
              </span>
            )}

            {!isExpanded && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-ds-surface text-ds-content text-ds-xs rounded-ds-md opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none z-50 whitespace-nowrap border border-ds-border-subtle shadow-ds-lg">
                {item.label}
              </div>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <div className="h-full bg-ds-surface flex flex-col" data-testid="company-sidebar">
      {/* Top Header */}
      <div className="min-h-16 flex items-center px-4 border-b border-ds-border-subtle">
        <div className="flex items-center gap-3 w-full overflow-hidden">
          <div className="flex-shrink-0 w-8 h-8 bg-ds-action-primary rounded-ds-md flex items-center justify-center text-ds-content-inverse font-bold" aria-hidden="true">
            {(currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'C').charAt(0)}
          </div>

          {isExpanded && (
            <div className="flex flex-col min-w-0">
              <span className="text-ds-content font-medium truncate">
                {currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'Company'}
              </span>
              {isCompanyAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    navigate('/company/settings');
                    onNavigate?.();
                  }}
                  className="text-ds-xs text-ds-content-link hover:underline text-left truncate focus-visible:outline-none focus-visible:shadow-ds-focus rounded-ds-sm"
                >
                  Company Settings
                </button>
              ) : (
                <span className="text-ds-xs text-ds-content-muted truncate">Team Member</span>
              )}
            </div>
          )}
        </div>
        <IconButton
          label="Close navigation"
          variant="ghost"
          className="md:hidden"
          onClick={onNavigate}
        >
          <X size={20} aria-hidden="true" />
        </IconButton>
      </div>

      {/* Navigation */}
      <nav
        className="flex-1 py-4 overflow-y-auto overflow-x-hidden space-y-1 custom-scrollbar"
        aria-label="Company sections"
      >
        {menuEntries.map((entry, idx) => {
          if (entry.type === 'divider') {
            return <div key={`divider-${idx}`} className="my-2 border-t border-ds-border-subtle" aria-hidden="true" />;
          }

          if (entry.type === 'group') {
            const group = entry.group;
            const isGroupActive = expandedGroups[group.id];
            const hasActiveChild = entry.children.some(child => location.pathname === child.path);
            const GroupIcon = ICON_MAP[group.icon] || Users;

            return (
              <div key={group.id} className="mb-2">
                <Button
                  variant="ghost"
                  fullWidth
                  justify="start"
                  onClick={() => toggleGroup(group.id)}
                  className={`
                            rounded-none px-3
                            ${!isExpanded ? 'justify-center' : ''}
                            ${hasActiveChild ? 'text-ds-status-info-fg' : ''}
                        `}
                  aria-expanded={isExpanded ? isGroupActive : false}
                >
                  <GroupIcon
                    size={20}
                    aria-hidden="true"
                    className={hasActiveChild ? 'text-ds-action-primary' : 'text-ds-content-muted'}
                  />
                  {isExpanded && (
                    <>
                      <span className="flex-1 text-left font-medium text-sm">{group.label}</span>
                      <ChevronRight
                        size={16}
                        aria-hidden="true"
                        className={isGroupActive ? 'rotate-90 transition-transform' : 'transition-transform'}
                      />
                    </>
                  )}
                </Button>

                {/* Children */}
                {isExpanded && isGroupActive && (
                  <div className="mt-1 space-y-0.5">
                    {entry.children.map((child) => (
                      <NavItem key={child.id} item={child} isChild={true} />
                    ))}
                  </div>
                )}
              </div>
            )
          }

          return <NavItem key={entry.item.id} item={entry.item} />;
        })}
      </nav>

      {/* Footer / Toggle */}
      <div className="p-3 border-t border-ds-border-subtle hidden md:flex justify-center">
        <IconButton
          label={isExpanded ? 'Collapse navigation' : 'Expand navigation'}
          variant="ghost"
          onClick={toggleSidebar}
        >
          {isExpanded
            ? <ChevronsLeft size={20} aria-hidden="true" />
            : <ChevronsRight size={20} aria-hidden="true" />}
        </IconButton>
      </div>
    </div>
  );
};
