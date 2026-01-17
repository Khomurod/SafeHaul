import React from 'react';
import { Building2, Search, X, Zap, LogOut, Loader2, Database, Trash2 } from 'lucide-react';

export function DashboardHeader({ 
    searchQuery, 
    setSearchQuery, 
    onDistribute, 
    distributing, 
    onFixData,
    fixingData,
    onCleanup,
    cleaning,
    onLogout 
}) {
    return (
        <header className="sticky top-0 z-10 bg-white shadow-md border-b border-gray-200">
            <div className="container mx-auto p-4 flex justify-between items-center gap-4">
                
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-600 rounded-lg text-white">
                        <Building2 size={24} />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-800">Super Admin</h1>
                </div>

                <div className="relative flex-1 max-w-xl">
                    <input
                        type="text"
                        placeholder="Global Search..."
                        className="w-full p-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <Search
                        size={20}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    {searchQuery && (
                        <button
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            onClick={() => setSearchQuery('')}
                        >
                            <X size={20} />
                        </button>
                    )}
                </div>
                
                <div className="flex items-center gap-2">
                    
                    <button 
                        onClick={onCleanup}
                        disabled={cleaning}
                        className={`flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm transition-colors ${
                            cleaning 
                            ? 'bg-red-300 cursor-not-allowed' 
                            : 'bg-red-600 hover:bg-red-700'
                        }`}
                        title="Delete 'Unknown Driver' and placeholder records"
                    >
                        {cleaning ? 
                            <Loader2 size={16} className="animate-spin" /> : 
                            <Trash2 size={16} />
                        }
                        {cleaning ? "Purging..." : "Purge Trash"}
                    </button>

                    <button 
                        onClick={onFixData}
                        disabled={fixingData}
                        className={`flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm transition-colors ${
                            fixingData 
                            ? 'bg-gray-400 cursor-not-allowed' 
                            : 'bg-gray-700 hover:bg-gray-800'
                        }`}
                        title="Migrate Drivers to Leads"
                    >
                        {fixingData ? 
                            <Loader2 size={16} className="animate-spin" /> : 
                            <Database size={16} className="text-yellow-400" />
                        }
                        {fixingData ? "Migrating..." : "Fix Data"}
                    </button>

                    <button 
                        onClick={onDistribute}
                        disabled={distributing}
                        className={`flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-lg shadow-sm transition-colors ${
                            distributing ?
                            'bg-purple-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700'
                        }`}
                    >
                        {distributing ?
                        <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                        {distributing ?
                        "Distributing..." : "Distribute Leads"}
                    </button>
                </div>

                <button
                    id="logout-button-super"
                    className="px-3 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-all flex items-center gap-2 ml-2"
                    onClick={onLogout}
                >
                    <LogOut size={18} />
                    <span className="hidden sm:inline">Logout</span>
                </button>
            </div>
        </header>
    );
}