// src/shared/components/modals/RoleSelectionModal.jsx
import React from 'react';
import { Truck, Building2, ArrowRight } from 'lucide-react';

export function RoleSelectionModal({ onSelect }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        <div className="p-8 text-center border-b border-slate-100">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Welcome Back
          </h2>
          <p className="text-slate-500">
            You have access to multiple portals. Where would you like to go?
          </p>
        </div>

        <div className="p-6 space-y-4">
          <button
            onClick={() => onSelect('driver')}
            className="w-full flex items-center gap-4 p-5 bg-slate-50 hover:bg-blue-50 border-2 border-slate-200 hover:border-blue-500 rounded-xl transition-all group"
          >
            <div className="w-14 h-14 bg-blue-100 group-hover:bg-blue-200 rounded-xl flex items-center justify-center transition-colors">
              <Truck size={28} className="text-blue-600" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                Driver Portal
              </h3>
              <p className="text-sm text-slate-500">
                Manage your profile, view applications, and find opportunities
              </p>
            </div>
            <ArrowRight size={20} className="text-slate-400 group-hover:text-blue-600 transition-colors" />
          </button>

          <button
            onClick={() => onSelect('employer')}
            className="w-full flex items-center gap-4 p-5 bg-slate-50 hover:bg-indigo-50 border-2 border-slate-200 hover:border-indigo-500 rounded-xl transition-all group"
          >
            <div className="w-14 h-14 bg-indigo-100 group-hover:bg-indigo-200 rounded-xl flex items-center justify-center transition-colors">
              <Building2 size={28} className="text-indigo-600" />
            </div>
            <div className="flex-1 text-left">
              <h3 className="text-lg font-semibold text-slate-900 group-hover:text-indigo-700 transition-colors">
                Employer Portal
              </h3>
              <p className="text-sm text-slate-500">
                Manage your company, review applications, and recruit drivers
              </p>
            </div>
            <ArrowRight size={20} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
          </button>
        </div>

        <div className="px-6 pb-6">
          <p className="text-xs text-slate-400 text-center">
            You can switch between portals anytime from the menu
          </p>
        </div>

      </div>
    </div>
  );
}
