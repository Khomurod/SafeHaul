// src/features/company-admin/components/PerformanceWidget.jsx
import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { 
  Loader2, Calendar, Users, Trophy, X, Search, 
  Medal, Award 
} from 'lucide-react';

export function PerformanceWidget({ companyId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Data State
  const [leaderboard, setLeaderboard] = useState([]);

  // --- HELPER: Get Current Date in Chicago ---
  const getChicagoToday = () => {
    const formatter = new Intl.DateTimeFormat('en-CA', { 
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return formatter.format(new Date());
  };

  const [startDate, setStartDate] = useState(getChicagoToday);
  const [endDate, setEndDate] = useState(getChicagoToday);

  useEffect(() => {
    if (companyId) fetchData();
  }, [companyId]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const addHours = (date, h) => {
        const copy = new Date(date);
        copy.setTime(copy.getTime() + (h * 60 * 60 * 1000));
        return copy;
      };

      const baseStart = new Date(startDate + "T00:00:00Z");
      const baseEnd = new Date(endDate + "T23:59:59Z");
      const utcStart = addHours(baseStart, 6); 
      const utcEnd = addHours(baseEnd, 6);

      const getHistory = httpsCallable(functions, 'getTeamPerformanceHistory');
      const result = await getHistory({
        companyId,
        startDate: utcStart.toISOString(),
        endDate: utcEnd.toISOString()
      });

      if (result.data.success) {
        const sortedLeaderboard = (result.data.data || []).sort((a, b) => b.dials - a.dials);
        setLeaderboard(sortedLeaderboard);
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

  const totalDials = leaderboard.reduce((acc, curr) => acc + curr.dials, 0);

  // --- UI HELPERS ---
  const getInitials = (name) => name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  const getRankIcon = (index) => {
    if (index === 0) return <Medal size={20} className="text-yellow-500 fill-yellow-100" />;
    if (index === 1) return <Medal size={20} className="text-gray-400 fill-gray-100" />;
    if (index === 2) return <Medal size={20} className="text-orange-700 fill-orange-100" />;
    return <span className="text-sm font-bold text-gray-400 w-5 text-center">{index + 1}</span>;
  };

  const SuccessBar = ({ connected, dials }) => {
    const safeDials = dials || 1;
    const rate = Math.min(100, Math.round((connected / safeDials) * 100));
    return (
      <div className="flex flex-col w-24">
        <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
           <span className="font-bold text-green-700">{connected}</span>
           <span>{rate}%</span>
        </div>
        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full" style={{ width: `${rate}%` }} />
        </div>
      </div>
    );
  };

  return (
    <>
      <div 
        onClick={() => setIsOpen(true)}
        className="p-4 rounded-xl shadow-sm border bg-white border-gray-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between h-full relative overflow-hidden group min-h-[90px]"
      >
        <div className="absolute right-0 top-0 w-20 h-20 bg-blue-50 rounded-bl-full -mr-10 -mt-10 transition-transform group-hover:scale-110" />
        <div className="flex justify-between items-start gap-3 relative z-10">
          <div className="min-w-0 flex-1">
             <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 truncate">Team Performance</p>
             <div className="flex items-baseline gap-2 mt-1">
                <p className="text-2xl font-bold text-gray-900 text-blue-600">{totalDials}</p>
                <span className="text-xs text-gray-400 font-medium">total calls</span>
             </div>
          </div>
          <div className="p-2 rounded-lg bg-white shadow-sm text-blue-600 ring-1 ring-gray-100 shrink-0">
            <Trophy size={18} />
          </div>
        </div>
        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center gap-2 relative z-10">
            <span className="text-[10px] text-blue-600 font-bold hover:underline flex items-center gap-1">
              View Leaderboard
            </span>
        </div>
      </div>

      {isOpen && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100]" onClick={() => setIsOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col border border-gray-200 overflow-hidden animate-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>

            {/* HEADER */}
            <div className="p-5 border-b border-gray-200 bg-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-yellow-50 rounded-xl text-yellow-600 border border-yellow-100">
                  <Award size={28} />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Performance Center</h2>
                  <p className="text-xs text-gray-500">Track metrics and gamify success.</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                 <button onClick={() => setIsOpen(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* FILTERS */}
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/50 flex flex-wrap items-center gap-4 shrink-0">
               <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                  <Calendar size={14} className="text-gray-400" />
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-xs font-semibold text-gray-700 outline-none cursor-pointer"/>
                  <span className="text-gray-300">to</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-xs font-semibold text-gray-700 outline-none cursor-pointer"/>
               </div>
               <button onClick={handleSearchClick} disabled={loading} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center gap-2 disabled:opacity-50">
                  {loading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />} Update
               </button>
            </div>

            {/* CONTENT AREA: LEADERBOARD ONLY */}
            <div className="flex-1 overflow-auto bg-white relative">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 text-center w-16">Rank</th>
                        <th className="px-6 py-4">Recruiter</th>
                        <th className="px-4 py-4 text-center">Total Dials</th>
                        <th className="px-4 py-4 text-left">Connected Success</th>
                        <th className="px-4 py-4 text-center text-blue-600">Callback</th>
                        <th className="px-4 py-4 text-center text-gray-400">VM / No Ans</th>
                        <th className="px-4 py-4 text-center text-red-400">Rejections</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {leaderboard.map((agent, index) => (
                        <tr key={agent.id} className="hover:bg-blue-50/30 transition-colors group">
                          <td className="px-6 py-4 text-center"><div className="flex justify-center items-center">{getRankIcon(index)}</div></td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm ${index === 0 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600' : 'bg-blue-100 text-blue-600'}`}>
                                {getInitials(agent.name)}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-gray-900">{agent.name}</p>
                                <p className="text-[10px] text-gray-400 uppercase font-medium">{index === 0 ? '🔥 Top Performer' : 'Recruiter'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center"><span className="px-3 py-1 rounded-full bg-gray-100 text-gray-700 font-bold text-sm">{agent.dials}</span></td>
                          <td className="px-4 py-4"><SuccessBar connected={agent.connected} dials={agent.dials} /></td>
                          <td className="px-4 py-4 text-center font-medium text-blue-600">{agent.callback}</td>
                          <td className="px-4 py-4 text-center text-gray-400">{agent.vm}</td>
                          <td className="px-4 py-4 text-center text-red-400">{agent.notInt + agent.notQual}</td>
                        </tr>
                      ))}
                      {leaderboard.length === 0 && !loading && (
                        <tr><td colSpan="7" className="p-12 text-center text-gray-400">No activity found.</td></tr>
                      )}
                    </tbody>
                </table>
            </div>

          </div>
        </div>
      )}
    </>
  );
}