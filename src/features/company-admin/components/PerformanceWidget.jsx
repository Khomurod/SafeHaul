// src/features/company-admin/components/PerformanceWidget.jsx
import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Loader2, Calendar, Users, Trophy, X, Search } from 'lucide-react';

export function PerformanceWidget({ companyId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // --- HELPER: Get Current Date in Chicago (Central Time) ---
  const getChicagoToday = () => {
    // Create a formatter for Chicago time
    const formatter = new Intl.DateTimeFormat('en-CA', { // en-CA uses YYYY-MM-DD format
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(new Date());
  };

  // Initialize state with Chicago time
  const [startDate, setStartDate] = useState(getChicagoToday);
  const [endDate, setEndDate] = useState(getChicagoToday);

  useEffect(() => {
    if (companyId) {
      fetchData();
    }
  }, [companyId]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      // --- LOGIC: Convert Selected Date to Chicago Time Window in UTC ---
      // Chicago is roughly UTC-6 (Standard) or UTC-5 (Daylight).
      // To be safe and capture the full "work day", we construct the UTC timestamps manually.

      // 1. Create base dates from inputs (treated as UTC 00:00 by default if we just append T00:00:00Z)
      // We want "YYYY-MM-DD 00:00 Chicago" -> UTC equivalent.
      // Simple approach: Treat the input string as Chicago time.

      const startObj = new Date(`${startDate}T00:00:00`); 
      const endObj = new Date(`${endDate}T23:59:59`);

      // We need to shift these to match Chicago. 
      // If we treat them as UTC, Chicago is +6 hours relative to that ISO string.
      // Example: User picks "2025-12-08".
      // We want start to be 2025-12-08 06:00:00 UTC (which is Midnight CST)
      // We want end to be 2025-12-09 05:59:59 UTC (which is End of Day CST)

      // Helper to add hours to a date
      const addHours = (date, h) => {
        const copy = new Date(date);
        copy.setTime(copy.getTime() + (h * 60 * 60 * 1000));
        return copy;
      };

      // Create UTC base dates
      const baseStart = new Date(startDate + "T00:00:00Z");
      const baseEnd = new Date(endDate + "T23:59:59Z");

      // Shift by +6 hours (Approx Central Time offset to get to UTC)
      // This ensures 8 AM in Uzbekistan doesn't look like "Tomorrow"
      const utcStart = addHours(baseStart, 6); 
      const utcEnd = addHours(baseEnd, 6);

      const getHistory = httpsCallable(functions, 'getTeamPerformanceHistory');
      const result = await getHistory({
        companyId,
        startDate: utcStart.toISOString(),
        endDate: utcEnd.toISOString()
      });

      if (result.data.success) {
        // Sort by dials descending by default
        const sortedData = result.data.data.sort((a, b) => b.dials - a.dials);
        setData(sortedData);
      }
    } catch (error) {
      console.error("Failed to fetch performance:", error);
      setError("Failed to load data.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearchClick = (e) => {
    e.preventDefault();
    fetchData();
  };

  const totalDials = data.reduce((acc, curr) => acc + curr.dials, 0);

  const renderStat = (num, isBold = false) => {
    if (num === 0) return <span className="text-gray-300">0</span>;
    return <span className={isBold ? "font-bold text-gray-900" : "text-gray-700"}>{num}</span>;
  };

  return (
    <>
      <div 
        onClick={() => setIsOpen(true)}
        className="p-4 rounded-xl shadow-sm border bg-white border-gray-200 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between h-full relative overflow-hidden group min-h-[90px]"
      >
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0 flex-1">
             <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 truncate">Team Activity</p>
             <p className="text-2xl font-bold text-gray-900 mt-1 text-blue-600 truncate">{totalDials}</p>
             <p className="text-[9px] text-gray-400 font-medium uppercase truncate">Calls in range (Chicago)</p>
          </div>
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100 transition-colors shrink-0">
            <Users size={18} />
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-2">
            <span className="text-[10px] text-blue-600 font-bold hover:underline truncate">Click to view report</span>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100]" onClick={() => setIsOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col border border-gray-200 overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>

            <div className="p-5 border-b border-gray-200 flex flex-col md:flex-row justify-between items-start md:items-center bg-gray-50 gap-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Trophy className="text-yellow-500" size={24} /> 
                  Performance Report
                </h2>
                <p className="text-sm text-gray-500 mt-1">Analyze call metrics per agent (Timezone: Central US).</p>
              </div>

              <button 
                onClick={() => setIsOpen(false)}
                className="p-2 text-gray-400 hover:bg-white hover:text-gray-600 rounded-full transition-colors absolute top-4 right-4 md:static"
              >
                <X size={24} />
              </button>
            </div>

            <div className="p-4 border-b border-gray-200 bg-white flex flex-col sm:flex-row items-center gap-4 shrink-0">
               <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="bg-gray-100 p-2 rounded-lg flex items-center gap-2 border border-gray-200">
                      <Calendar size={16} className="text-gray-500 ml-1" />
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)}
                        className="bg-transparent text-sm font-medium text-gray-700 outline-none cursor-pointer"
                      />
                      <span className="text-gray-400">-</span>
                      <input 
                        type="date" 
                        value={endDate} 
                        onChange={(e) => setEndDate(e.target.value)}
                        className="bg-transparent text-sm font-medium text-gray-700 outline-none cursor-pointer"
                      />
                  </div>
                  <button 
                    onClick={handleSearchClick}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                    Filter
                  </button>
               </div>
            </div>

            <div className="flex-1 overflow-auto bg-white p-0">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 bg-gray-50 w-16 text-center">#</th>
                        <th className="px-6 py-4 bg-gray-50">Team Member</th>
                        <th className="px-4 py-4 bg-gray-50 text-center">Dials</th>
                        <th className="px-4 py-4 bg-gray-50 text-center text-green-700">Connected</th>
                        <th className="px-4 py-4 bg-gray-50 text-center text-blue-700">Callback</th>
                        <th className="px-4 py-4 bg-gray-50 text-center text-gray-600">Not Int.</th>
                        <th className="px-4 py-4 bg-gray-50 text-center text-orange-600">Not Qual.</th>
                        <th className="px-4 py-4 bg-gray-50 text-center text-yellow-600">VM / No Ans</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.map((agent, index) => (
                        <tr key={agent.id} className="hover:bg-blue-50/50 transition-colors">
                          <td className="px-6 py-4 text-center">
                            <span className={`
                              inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold
                              ${index === 0 ? 'bg-yellow-100 text-yellow-700 ring-4 ring-yellow-50' : 
                                index === 1 ? 'bg-gray-200 text-gray-700' : 
                                index === 2 ? 'bg-orange-100 text-orange-800' : 
                                'text-gray-400 bg-gray-50'}
                            `}>
                              {index + 1}
                            </span>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-900 flex items-center gap-2">
                            {index === 0 && <Trophy size={14} className="text-yellow-500 fill-yellow-500" />}
                            {agent.name}
                          </td>
                          <td className="px-4 py-4 text-center font-bold text-gray-900 bg-gray-50/50">{renderStat(agent.dials, true)}</td>
                          <td className="px-4 py-4 text-center text-green-700 font-medium bg-green-50/30">{renderStat(agent.connected)}</td>
                          <td className="px-4 py-4 text-center text-blue-700">{renderStat(agent.callback)}</td>
                          <td className="px-4 py-4 text-center text-gray-600">{renderStat(agent.notInt)}</td>
                          <td className="px-4 py-4 text-center text-orange-600">{renderStat(agent.notQual)}</td>
                          <td className="px-4 py-4 text-center text-yellow-600">{renderStat(agent.vm)}</td>
                        </tr>
                      ))}

                      {data.length === 0 && !loading && (
                        <tr>
                          <td colSpan="8" className="p-10 text-center text-gray-400 italic">
                            No activity found for this date range.
                          </td>
                        </tr>
                      )}
                    </tbody>
                </table>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-200 text-right shrink-0">
              <button 
                onClick={() => setIsOpen(false)}
                className="px-6 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-100 transition shadow-sm"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  );
}