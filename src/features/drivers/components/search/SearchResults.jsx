import React from 'react';
import { MapPin, Filter, Phone, ChevronLeft, ChevronRight } from 'lucide-react';
import { getFieldValue, formatPhoneNumber, formatExperience, normalizePhone } from '@shared/utils/helpers';
import { DRIVER_TYPES } from './SearchConfig';

function TelegramLogo({ className }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
      <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
    </svg>
  );
}

export function SearchResults({
    results,
    paginatedData,
    loading,
    error,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
    totalPages,
    onCallClick,
    onViewClick
}) {

    const getTelegramLink = (phone) => {
        if (!phone) return '#';
        let cleaned = normalizePhone(phone);
        if (cleaned.length === 10) cleaned = '1' + cleaned;
        return `https://t.me/+${cleaned}`;
    };

    const handleTelegramAction = (driver, phone) => {
        onCallClick(driver);
        
        const link = getTelegramLink(phone);
        if (link && link !== '#') {
            window.open(link, '_blank');
        }
    };

    return (
        <>
            <div className="flex-1 overflow-auto bg-white min-h-0">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                        <tr>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Driver Name</th>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Location</th>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Experience</th>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">Type</th>
                            <th className="px-6 py-3 text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loading && (
                            <tr><td colSpan={5} className="text-center py-20 text-gray-400">Loading...</td></tr>
                        )}
                        {!loading && error && (
                            <tr><td colSpan={5} className="text-center py-20 text-red-500">{error}</td></tr>
                        )}
                        {!loading && !error && paginatedData.length === 0 && (
                            <tr>
                                <td colSpan={5} className="text-center py-20 text-gray-400">
                                    <Filter className="mx-auto mb-2" size={32}/>
                                    <p>Select your filters and click "Search Drivers" to find candidates.</p>
                                </td>
                            </tr>
                        )}
                        {!loading && paginatedData.map(driver => {
                            const pi = driver.personalInfo || {};
                            const dp = driver.driverProfile || {};
                            const qual = driver.qualifications || {};
                            const typeLabel = DRIVER_TYPES.find(t => t.value === dp.type)?.label || dp.type || 'N/A';
                            
                            return (
                                <tr key={driver.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold shrink-0">
                                                {getFieldValue(pi.firstName).charAt(0)}
                                            </div>
                                            <div>
                                                <p className="font-semibold text-gray-800">{getFieldValue(pi.firstName)} {getFieldValue(pi.lastName)}</p>
                                                <p className="text-xs text-gray-400">{formatPhoneNumber(pi.phone)}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">
                                        <div className="flex items-center gap-1"><MapPin size={14} className="text-gray-400"/>{getFieldValue(pi.city)}, {getFieldValue(pi.state)}</div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-gray-600">{formatExperience(qual.experienceYears)}</td>
                                    <td className="px-6 py-4">
                                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">{typeLabel}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button 
                                                onClick={() => onCallClick(driver)} 
                                                className="p-2 text-blue-600 hover:bg-blue-50 rounded-full" 
                                                title="Log Phone Call"
                                            >
                                                <Phone size={18}/>
                                            </button>
                                            <button 
                                                onClick={() => handleTelegramAction(driver, pi.phone)} 
                                                className="p-2 text-sky-600 hover:bg-sky-50 rounded-full" 
                                                title="Open Telegram"
                                            >
                                                <TelegramLogo className="w-[18px] h-[18px]"/>
                                            </button>
                                            <button 
                                                onClick={() => onViewClick(driver)} 
                                                className="px-3 py-1.5 text-xs font-bold text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100"
                                            >
                                                View Profile
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {results.length > 0 && (
                <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>Total: <strong>{results.length}</strong></span>
                        <select 
                            className="p-1.5 border rounded-md text-sm"
                            value={itemsPerPage}
                            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                        >
                            <option value={10}>10 / page</option>
                            <option value={20}>20 / page</option>
                            <option value={50}>50 / page</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                            disabled={currentPage === 1}
                            className="p-2 border rounded-lg hover:bg-white disabled:opacity-30"
                        >
                            <ChevronLeft size={16}/>
                        </button>
                        <span className="text-sm font-medium px-2">Page {currentPage} of {totalPages || 1}</span>
                        <button 
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                            disabled={currentPage >= totalPages}
                            className="p-2 border rounded-lg hover:bg-white disabled:opacity-30"
                        >
                            <ChevronRight size={16}/>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
