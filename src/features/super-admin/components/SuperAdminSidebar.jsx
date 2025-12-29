import React from "react";
import {
  LayoutDashboard,
  Building,
  Users,
  FileText,
  Database,
  Plus,
  Layers,
  BarChart3,
  Activity, // <-- New Icon
} from "lucide-react";

function NavItem({ label, icon, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-3 w-full px-4 py-3 rounded-lg text-left font-medium
        ${
          isActive
            ? "bg-blue-600 text-white shadow-md"
            : "text-gray-700 hover:bg-gray-100"
        }
        transition-all
      `}
    >
      {icon}
      {label}
    </button>
  );
}

export function SuperAdminSidebar({
  activeView,
  setActiveView,
  isSearching,
  onClearSearch,
}) {
  const handleNavClick = (viewName) => {
    setActiveView(viewName);
    if (onClearSearch) onClearSearch();
  };

  return (
    <nav className="w-full sm:w-64 shrink-0 bg-white p-4 rounded-xl shadow-lg border border-gray-200 space-y-2 sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto custom-scrollbar">
      <NavItem
        label="Dashboard"
        icon={<LayoutDashboard size={20} />}
        isActive={activeView === "dashboard" && !isSearching}
        onClick={() => handleNavClick("dashboard")}
      />

      <NavItem
        label="Analytics"
        icon={<BarChart3 size={20} />}
        isActive={activeView === "analytics" && !isSearching}
        onClick={() => handleNavClick("analytics")}
      />

      <div className="my-2 border-t border-gray-100"></div>

      <NavItem
        label="Companies"
        icon={<Building size={20} />}
        isActive={activeView === "companies" && !isSearching}
        onClick={() => handleNavClick("companies")}
      />
      <NavItem
        label="Users"
        icon={<Users size={20} />}
        isActive={activeView === "users" && !isSearching}
        onClick={() => handleNavClick("users")}
      />
      <NavItem
        label="Unified Driver DB"
        icon={<FileText size={20} />}
        isActive={activeView === "applications" && !isSearching}
        onClick={() => handleNavClick("applications")}
      />

      <div className="my-2 border-t border-gray-100"></div>

      <NavItem
        label="Global Features"
        icon={<Layers size={20} />}
        isActive={activeView === "features" && !isSearching}
        onClick={() => handleNavClick("features")}
      />

      {/* NEW LINK */}
      <NavItem
        label="System Health"
        icon={<Activity size={20} />}
        isActive={activeView === "system-health" && !isSearching}
        onClick={() => handleNavClick("system-health")}
      />

      <NavItem
        label="Bulk Lead Adding"
        icon={<Database size={20} />}
        isActive={activeView === "bulk-lead-adding" && !isSearching}
        onClick={() => handleNavClick("bulk-lead-adding")}
      />
      <NavItem
        label="Create New"
        icon={<Plus size={20} />}
        isActive={activeView === "create" && !isSearching}
        onClick={() => handleNavClick("create")}
      />
    </nav>
  );
}
