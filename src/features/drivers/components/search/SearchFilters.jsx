import React from 'react';
import { Search, Loader2 } from 'lucide-react';
import { DRIVER_TYPES, US_STATES } from './SearchConfig';

export function SearchFilters({
    selectedTypes,
    toggleType,
    selectedState,
    setSelectedState,
    loading,
    onSearch
}) {
    return (
        <div className="p-6 bg-gray-50 border-b border-gray-200 flex flex-col gap-4 shrink-0">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                <div className="lg:col-span-6">
                    <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">Driver Types</label>
                    <div className="flex flex-wrap gap-2">
                        {DRIVER_TYPES.map(type => (
                            <button
                                key={type.value}
                                onClick={() => toggleType(type.value)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                                    selectedTypes.includes(type.value)
                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                    : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                                }`}
                            >
                                {type.label}
                            </button>
                        ))}
                        {selectedTypes.length > 0 && (
                            <button 
                                onClick={() => toggleType('CLEAR_ALL')} 
                                className="px-2 py-1.5 text-xs text-gray-500 underline hover:text-gray-800"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-3">
                    <label className="text-xs font-bold text-gray-500 uppercase mb-2 block">State</label>
                    <select 
                        className="w-full p-2 border border-gray-300 rounded-lg bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={selectedState}
                        onChange={(e) => setSelectedState(e.target.value)}
                    >
                        <option value="">Any State</option>
                        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>

                <div className="lg:col-span-3 flex items-end">
                    <button
                        onClick={onSearch}
                        disabled={loading}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="animate-spin" size={18}/> : <Search size={18}/>}
                        {loading ? 'Searching...' : 'Search Drivers'}
                    </button>
                </div>
            </div>
        </div>
    );
}
