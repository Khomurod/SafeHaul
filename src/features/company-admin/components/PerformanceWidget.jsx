// src/features/company-admin/components/PerformanceWidget.jsx
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@lib/firebase';
import {
  Loader2, Calendar, Users, Trophy, X, Search,
  Medal, Award, LineChart as ChartIcon, List
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#db2777', '#0891b2', '#4b5563'];

export function PerformanceWidget({ companyId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Data State
  const [leaderboard, setLeaderboard] = useState([]);
  const [historyData, setHistoryData] = useState([]); // For graph
  const [selectedRecruiters, setSelectedRecruiters] = useState([]);
  const [viewMode, setViewMode] = useState('leaderboard'); // 'leaderboard' or 'graph'

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
      const statsRef = collection(db, 'companies', companyId, 'stats_daily');
      const q = query(
        statsRef,
        where('__name__', '>=', startDate),
        where('__name__', '<=', endDate),
        orderBy('__name__')
      );

      const snap = await getDocs(q);

      const userTotals = {};
      const formattedHistory = [];

      snap.forEach(doc => {
        const dateKey = doc.id;
        const data = doc.data();

        // Build history point
        const dateObj = new Date(dateKey + 'T00:00:00Z');
        const displayDate = `${dateObj.getUTCMonth() + 1}/${dateObj.getUTCDate()}`;
        const point = { name: displayDate, fullDate: dateKey };

        const byUser = data.byUser || {};
        Object.keys(byUser).forEach(userId => {
          const userData = byUser[userId];
          point[userId] = userData.dials || 0;

          if (!userTotals[userId]) {
            userTotals[userId] = {
              id: userId,
              name: userData.name || 'Unknown Recruiter',
              dials: 0,
              connected: 0,
              voicemail: 0,
              callback: 0,
              notInt: 0,
              notQual: 0
            };
          }
          userTotals[userId].dials += (userData.dials || 0);
          userTotals[userId].connected += (userData.connected || 0);
          userTotals[userId].voicemail += (userData.voicemail || 0);
          userTotals[userId].callback += (userData.callback || 0);
          userTotals[userId].notInt += (userData.notInt || 0);
          userTotals[userId].notQual += (userData.notQual || 0);
        });

        formattedHistory.push(point);
      });

      const sortedLeaderboard = Object.values(userTotals).sort((a, b) => b.dials - a.dials);
      setLeaderboard(sortedLeaderboard);

      if (selectedRecruiters.length === 0) {
        setSelectedRecruiters(sortedLeaderboard.slice(0, 5).map(r => r.id));
      }

      setHistoryData(formattedHistory);

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

  const toggleRecruiter = (id) => {
    setSelectedRecruiters(prev =>
      prev.includes(id) ? prev.filter(uid => uid !== id) : [...prev, id]
    );
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
                {/* VIEW TOGGLE */}
                <div className="bg-gray-100 p-1 rounded-lg flex items-center">
                  <button
                    onClick={() => setViewMode('leaderboard')}
                    className={`p-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition-all ${viewMode === 'leaderboard' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
                  >
                    <List size={14} /> List
                  </button>
                  <button
                    onClick={() => setViewMode('graph')}
                    className={`p-1.5 rounded-md text-xs font-bold flex items-center gap-2 transition-all ${viewMode === 'graph' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
                  >
                    <ChartIcon size={14} /> Trend
                  </button>
                </div>

                <button onClick={() => setIsOpen(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* FILTERS */}
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/50 flex flex-wrap items-center gap-4 shrink-0">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
                <Calendar size={14} className="text-gray-400" />
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-transparent text-xs font-semibold text-gray-700 outline-none cursor-pointer" />
                <span className="text-gray-300">to</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-transparent text-xs font-semibold text-gray-700 outline-none cursor-pointer" />
              </div>
              <button onClick={handleSearchClick} disabled={loading} className="px-4 py-1.5 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition shadow-sm flex items-center gap-2 disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />} Update
              </button>
            </div>

            {/* CONTENT AREA */}
            <div className="flex-1 overflow-hidden bg-white relative flex">

              {viewMode === 'leaderboard' ? (
                <div className="flex-1 overflow-auto">
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
                      {/* TEAM SUMMARY ROW */}
                      {leaderboard.length > 0 && (
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <td className="px-6 py-4 text-center"><Users size={16} className="mx-auto text-slate-400" /></td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Team Average</td>
                          <td className="px-4 py-4 text-center font-bold text-slate-900">
                            {Math.round(totalDials / leaderboard.length)}
                          </td>
                          <td className="px-4 py-4 text-xs font-semibold text-slate-400">Industry Benchmark: 15%</td>
                          <td className="px-4 py-4 text-center text-blue-400">-</td>
                          <td className="px-4 py-4 text-center text-gray-300">-</td>
                          <td className="px-4 py-4 text-center text-red-300">-</td>
                        </tr>
                      )}

                      {leaderboard.map((agent, index) => (
                        <tr key={agent.id} className="hover:bg-blue-50/30 transition-colors group">
                          <td className="px-6 py-4 text-center"><div className="flex justify-center items-center">{getRankIcon(index)}</div></td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-white shadow-sm transition-transform group-hover:scale-105 ${index === 0 ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                                {getInitials(agent.name)}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold text-slate-900 leading-tight">{agent.name}</p>
                                  {index === 0 && <span className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 text-[8px] font-bold rounded uppercase">MVP</span>}
                                </div>
                                <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{index === 0 ? '🏆 Efficiency Leader' : 'Recruitment Team'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center"><span className="px-3 py-1 rounded-lg bg-white border border-slate-200 text-slate-900 font-bold text-sm shadow-sm">{agent.dials}</span></td>
                          <td className="px-4 py-4"><SuccessBar connected={agent.connected} dials={agent.dials} /></td>
                          <td className="px-4 py-4 text-center font-bold text-blue-600">{agent.callback}</td>
                          <td className="px-4 py-4 text-center text-slate-400">{agent.vm}</td>
                          <td className="px-4 py-4 text-center text-red-400 font-semibold">{agent.notInt + agent.notQual}</td>
                        </tr>
                      ))}
                      {leaderboard.length === 0 && !loading && (
                        <tr>
                          <td colSpan="7" className="p-20 text-center">
                            <div className="flex flex-col items-center gap-3 max-w-xs mx-auto">
                              <div className="p-4 bg-slate-50 rounded-full text-slate-300">
                                <ChartIcon size={40} />
                              </div>
                              <h4 className="text-lg font-black text-slate-800">No data for this window</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">Adjust your date range or filters to view team engagement metrics and conversion trends.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
                  {/* CHART */}
                  <div className="flex-1 p-6 min-h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={historyData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                        <Tooltip
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          cursor={{ stroke: '#e5e7eb', strokeWidth: 2 }}
                        />
                        <Legend />
                        {leaderboard.map((agent, index) => (
                          selectedRecruiters.includes(agent.id) && (
                            <Line
                              key={agent.id}
                              type="monotone"
                              dataKey={agent.id}
                              name={agent.name}
                              stroke={COLORS[index % COLORS.length]}
                              strokeWidth={3}
                              dot={{ r: 4, strokeWidth: 2 }}
                              activeDot={{ r: 6 }}
                            />
                          )
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* SELECTOR SIDEBAR */}
                  <div className="w-full md:w-64 border-l border-gray-200 bg-gray-50 p-4 overflow-y-auto">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Compare Recruiters</h3>
                    <div className="space-y-2">
                      {leaderboard.map((agent, index) => {
                        const isSelected = selectedRecruiters.includes(agent.id);
                        const color = COLORS[index % COLORS.length];
                        return (
                          <div
                            key={agent.id}
                            onClick={() => toggleRecruiter(agent.id)}
                            className={`p-2 rounded-lg flex items-center justify-between cursor-pointer border transition-all ${isSelected ? 'bg-white border-gray-200 shadow-sm' : 'bg-transparent border-transparent hover:bg-gray-100 opacity-60'}`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                              <span className="text-sm font-bold text-gray-700">{agent.name}</span>
                            </div>
                            {isSelected && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

            </div>

          </div>
        </div>
      )}
    </>
  );
}