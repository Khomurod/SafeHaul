import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Truck,
  Building2,
  User,
  Search,
  FileText,
  Upload,
  PlusCircle,
  Settings,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import { useData } from '@/context/DataContext';

const SIDEBAR_STORAGE_KEY = 'companySidebarMode';

export const CompanySidebar = () => {
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return stored ? stored === 'expanded' : true;
  });

  const [expandedGroups, setExpandedGroups] = useState({
    applications: true
  });

  const { currentCompanyProfile, logout, currentUserClaims } = useData();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, isExpanded ? 'expanded' : 'minimized');
  }, [isExpanded]);

  const toggleSidebar = () => setIsExpanded(!isExpanded);

  const toggleGroup = (group) => {
    if (!isExpanded) {
      setIsExpanded(true);
      setExpandedGroups(prev => ({ ...prev, [group]: true }));
    } else {
      setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
    }
  };

  const companyId = currentCompanyProfile?.id;
  const isCompanyAdmin = currentCompanyProfile && (
    currentUserClaims?.roles?.[companyId] === 'company_admin' ||
    currentUserClaims?.roles?.globalRole === 'super_admin'
  );

  const menuItems = [
    {
      type: 'item',
      label: 'Dashboard',
      icon: LayoutDashboard,
      path: '/company/dashboard'
    },
    {
      type: 'group',
      label: 'Driver Applications & Leads',
      id: 'applications',
      icon: Users,
      children: [
        { label: 'Applications', path: '/company/drivers/applications', icon: FileText },
        { label: 'SafeHaul Leads', path: '/company/drivers/leads/safehaul', icon: Truck },
        { label: 'Company Leads', path: '/company/drivers/leads/company', icon: Building2 },
        { label: 'My Leads', path: '/company/drivers/leads/my', icon: User },
      ]
    },
    { type: 'element', element: <div className="my-2 border-t border-gray-200" /> },
    { type: 'item', label: 'Search For Drivers', icon: Search, path: '/company/search' },
    { type: 'item', label: 'E-Docs', icon: FileText, path: '/company/e-docs' },

    // Admin Only Items
    ...(isCompanyAdmin ? [
      { type: 'item', label: 'Import Leads', icon: Upload, path: '/company/import-leads' },
      { type: 'item', label: 'Quick Add Leads', icon: PlusCircle, path: '/company/quick-add-lead' },
    ] : []),

    { type: 'element', element: <div className="my-2 border-t border-gray-200" /> },
    { type: 'item', label: 'Profile', icon: User, path: '/company/profile' },
    ...(isCompanyAdmin ? [
      { type: 'item', label: 'Settings', icon: Settings, path: '/company/settings' },
    ] : []),
  ];

  const NavItem = ({ item, isChild = false }) => {
    return (
      <NavLink
        to={item.path}
        className={({ isActive }) => `
          flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group relative
          ${isActive
            ? 'bg-blue-50 text-blue-700 border-l-2 border-blue-600'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-l-2 border-transparent'}
          ${isChild ? 'pl-9 text-sm' : ''}
          ${!isExpanded && !isChild ? 'justify-center' : ''}
        `}
      >
        {({ isActive }) => (
          <>
            <item.icon size={20} className={isActive ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-900'} />

            {isExpanded && (
              <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                {item.label}
              </span>
            )}

            {!isExpanded && (
              <div className="absolute left-full ml-2 px-2 py-1 bg-white text-gray-900 text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none z-50 whitespace-nowrap border border-gray-200 shadow-lg">
                {item.label}
              </div>
            )}
          </>
        )}
      </NavLink>
    );
  };

  return (
    <div
      className={`
        h-screen bg-white border-r border-gray-200 flex flex-col transition-all duration-300
        ${isExpanded ? 'w-64' : 'w-16'}
      `}
    >
      {/* Top Header */}
      <div className="h-16 flex items-center px-4 border-b border-gray-200">
        <div className="flex items-center gap-3 w-full overflow-hidden">
          <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
            {(currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'C').charAt(0)}
          </div>

          {isExpanded && (
            <div className="flex flex-col min-w-0">
              <span className="text-gray-900 font-medium truncate">
                {currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'Company'}
              </span>
              <button onClick={() => navigate('/company/settings')} className={`text-xs text-blue-600 hover:text-blue-700 text-left truncate ${!isCompanyAdmin ? 'hidden' : ''}`}>
                Company Settings
              </button>
              <button onClick={() => navigate('/company/dashboard')} className={`text-xs text-gray-500 hover:text-gray-700 text-left truncate ${isCompanyAdmin ? 'hidden' : ''}`}>
                {/* Placeholder for non-admins if needed, or just hide the button above */}
                Team Member
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-4 overflow-y-auto overflow-x-hidden space-y-1 custom-scrollbar">
        {menuItems.map((item, idx) => {
          if (item.type === 'element') return <React.Fragment key={idx}>{item.element}</React.Fragment>;

          if (item.type === 'group') {
            const isGroupActive = expandedGroups[item.id];
            const hasActiveChild = item.children.some(child => location.pathname === child.path);

            return (
              <div key={idx} className="mb-2">
                <button
                  onClick={() => toggleGroup(item.id)}
                  className={`
                            w-full flex items-center gap-3 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors
                            ${!isExpanded ? 'justify-center' : ''}
                            ${hasActiveChild ? 'text-blue-700' : ''}
                        `}
                >
                  <item.icon size={20} className={hasActiveChild ? 'text-blue-600' : 'text-gray-500'} />
                  {isExpanded && (
                    <>
                      <span className="flex-1 text-left font-medium text-sm">{item.label}</span>
                      {isGroupActive ? <ChevronRight size={16} className="rotate-90 transition-transform" /> : <ChevronRight size={16} className="transition-transform" />}
                    </>
                  )}
                </button>

                {/* Children */}
                {isExpanded && isGroupActive && (
                  <div className="mt-1 space-y-0.5">
                    {item.children.map((child, cIdx) => (
                      <NavItem key={cIdx} item={child} isChild={true} />
                    ))}
                  </div>
                )}
              </div>
            )
          }

          return <NavItem key={idx} item={item} />;
        })}
      </div>

      {/* Footer / Toggle */}
      <div className="p-3 border-t border-gray-200">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
        >
          {isExpanded ? <ChevronsLeft size={20} /> : <ChevronsRight size={20} />}
        </button>
      </div>
    </div>
  );
};
