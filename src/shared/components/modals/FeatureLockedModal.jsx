import React from 'react';
import { X, Lock, Zap, ArrowRight, Database } from 'lucide-react';

export function FeatureLockedModal({ onClose, onGoToLeads, featureName = "Search For Drivers" }) {
  return (
    <div className="fixed inset-0 bg-gray-900/70 flex items-center justify-center p-4 z-[60] backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-white/20 overflow-hidden relative">
        
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-white/80 hover:bg-white rounded-full transition-colors z-30 text-gray-500 hover:text-gray-800 shadow-sm"
        >
            <X size={20} />
        </button>

        <div className="relative bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-12 text-center overflow-hidden">
            
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse" style={{ animationDuration: '8s' }} />
                <div className="absolute bottom-[-10%] right-[-10%] w-64 h-64 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse" style={{ animationDuration: '10s' }} />
                <div className="absolute top-[40%] left-[30%] w-32 h-32 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-pulse" style={{ animationDuration: '12s' }} />
            </div>

            <div className="relative z-10 flex flex-col items-center">
                
                <div className="relative mb-8 group cursor-default">
                    <div className="absolute inset-0 bg-blue-500 rounded-full blur opacity-20 group-hover:opacity-30 transition-opacity duration-500"></div>
                    <div className="relative bg-white p-6 rounded-full shadow-xl border border-blue-100 ring-4 ring-blue-50">
                        <Lock size={40} className="text-blue-600" />
                        <div className="absolute -bottom-2 -right-2 bg-yellow-400 p-1.5 rounded-full border-2 border-white shadow-sm animate-bounce" style={{ animationDuration: '3s' }}>
                             <Database size={14} className="text-yellow-900" />
                        </div>
                    </div>
                </div>

                <h2 className="text-3xl font-extrabold text-gray-900 mb-3 tracking-tight">
                    {featureName}
                </h2>
                
                <div className="mb-6">
                    <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md uppercase tracking-wider">
                        <Zap size={12} fill="currentColor" /> Coming Soon
                    </span>
                </div>

                <div className="w-full max-w-xs mx-auto mb-8">
                    <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-2">
                        <span>Development Progress</span>
                        <span>92%</span>
                    </div>
                    <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden shadow-inner">
                        <div className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 w-[92%] rounded-full relative">
                            <div className="absolute inset-0 bg-white/30 w-full h-full animate-[shimmer_2s_infinite]"></div>
                        </div>
                    </div>
                </div>

                <p className="text-gray-600 text-lg max-w-md mx-auto mb-8 leading-relaxed">
                    We are finalizing the global driver search engine. 
                    <br/>
                    In the meantime, you can still access high-intent drivers through our distribution system.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center">
                    <button 
                        onClick={onGoToLeads}
                        className="flex-1 px-6 py-3.5 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-200 hover:-translate-y-0.5 flex items-center justify-center gap-2 group"
                    >
                        <Zap size={18} className="fill-blue-200 text-blue-100" />
                        Go to SafeHaul Leads
                        <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                    
                    <button 
                        onClick={onClose}
                        className="px-6 py-3.5 bg-white text-gray-700 font-bold rounded-xl border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                    >
                        Close
                    </button>
                </div>

            </div>
        </div>
        
        <style>{`
          @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    </div>
  );
}
