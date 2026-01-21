import React from 'react';

export function Section({ title, children, className = "" }) {
  return (
    <div className={`bg-white p-6 rounded-lg shadow-sm border border-gray-200 ${className}`}>
      {title && (
        <h3 className="text-lg font-bold text-gray-800 mb-4 border-b border-gray-100 pb-2">
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

export function InfoGrid({ children }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {children}
    </div>
  );
}

export function InfoItem({ label, value, isEditing, onChange, type = "text", options = [] }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
        {label}
      </label>

      {isEditing ? (
        options.length > 0 ? (
          <select 
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Select...</option>
            {options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input
            type={type}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      ) : (
        <p className="text-lg font-medium text-gray-900 break-words">
          {value || <span className="text-gray-300 italic">N/A</span>}
        </p>
      )}
    </div>
  );
}