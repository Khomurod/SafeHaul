// src/features/companies/components/StatCard.jsx
import React from 'react';

export function StatCard({ title, value, icon, active, onClick, colorClass, id }) {
  return (
    <div 
      id={id}
      onClick={onClick}
      className={`p-4 rounded-xl shadow-sm border transition-all cursor-pointer flex flex-col justify-between h-full relative overflow-hidden group min-h-[90px]
        ${active 
          ? `ring-2 ring-offset-1 ${colorClass} bg-white` 
          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-md'
        }`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
           <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 truncate" title={title}>
             {title}
           </p>
           <p className="text-2xl font-bold text-gray-900 mt-1 truncate" title={value}>
             {value}
           </p>
        </div>
        <div className={`p-2 rounded-lg shrink-0 ${active ? colorClass.replace('ring-', 'bg-').replace('500', '50') + ' text-' + colorClass.split('-')[1] + '-600' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'}`}>
          {/* Ensure icon receives size prop if supported, otherwise use clone to force size */}
          {React.isValidElement(icon) ? React.cloneElement(icon, { size: 18 }) : icon}
        </div>
      </div>
    </div>
  );
}