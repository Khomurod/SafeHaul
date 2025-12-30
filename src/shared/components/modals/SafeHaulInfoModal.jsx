import React from 'react';
import { X, Clock, Send, FileCheck, RefreshCw, ShieldCheck, Globe, Lock } from 'lucide-react';

export function SafeHaulInfoModal({ onClose }) {
  return (
    <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center p-4 z-[60] backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]">
        
        <div className="p-6 bg-gradient-to-r from-purple-700 to-indigo-800 text-white flex justify-between items-start shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-2">
                <Globe className="text-purple-200" size={24} />
                <h2 className="text-2xl font-bold">How SafeHaul Leads Work</h2>
            </div>
            <p className="text-purple-100 text-sm max-w-lg">
              Our exclusive lead generation system matches high-intent drivers with your company requirements.
            </p>
          </div>
          <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-10">
            
            <section>
                <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                    <RefreshCw className="text-purple-600" /> The Lead Lifecycle
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
                    <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-0.5 bg-gray-200 -z-10"></div>

                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative text-center group hover:border-purple-300 transition-colors">
                        <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl border-4 border-white shadow-sm">
                            <Clock size={24} />
                        </div>
                        <h4 className="font-bold text-gray-800 mb-2">24-Hour Window</h4>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            You receive <strong className="text-purple-700">50 (Free)</strong> or <strong className="text-purple-700">200 (Pro)</strong> leads daily. You have exactly 24 hours to contact them. Unused leads rotate to other carriers.
                        </p>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative text-center group hover:border-blue-300 transition-colors">
                        <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl border-4 border-white shadow-sm">
                            <Send size={24} />
                        </div>
                        <h4 className="font-bold text-gray-800 mb-2">Engage & Confirm</h4>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            Send your recruiter link. Once a driver replies or clicks, they are locked to your company for <strong className="text-blue-700">7 Days</strong>.
                        </p>
                    </div>

                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm relative text-center group hover:border-green-300 transition-colors">
                        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl border-4 border-white shadow-sm">
                            <FileCheck size={24} />
                        </div>
                        <h4 className="font-bold text-gray-800 mb-2">Application</h4>
                        <p className="text-sm text-gray-500 leading-relaxed">
                            The driver completes the full application. Once submitted, they are permanently added to your <strong className="text-green-700">Direct Applications</strong> list.
                        </p>
                    </div>
                </div>
            </section>

            <section className="bg-gray-50 rounded-2xl p-6 border border-gray-200">
                <div className="flex flex-col md:flex-row gap-8">
                    
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <ShieldCheck className="text-green-600" /> Data Privacy Guarantee
                        </h3>
                        <p className="text-sm text-gray-600 leading-relaxed mb-4">
                            We value your proprietary data. Any leads or applications you upload directly or receive via your custom links are <strong className="text-gray-900">exclusively yours</strong>.
                        </p>
                        <ul className="space-y-3">
                            <li className="flex items-start gap-3 text-sm text-gray-600">
                                <Lock size={18} className="text-green-600 shrink-0 mt-0.5" />
                                <span><strong>Encrypted Storage:</strong> Your company data is encrypted. Even SafeHaul personnel cannot access your private driver lists.</span>
                            </li>
                            <li className="flex items-start gap-3 text-sm text-gray-600">
                                <RefreshCw size={18} className="text-blue-600 shrink-0 mt-0.5" />
                                <span><strong>No Co-mingling:</strong> We never recycle your private leads into the public SafeHaul pool.</span>
                            </li>
                        </ul>
                    </div>

                    <div className="w-px bg-gray-200 hidden md:block"></div>

                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                            <Globe className="text-blue-600" /> Lead Sources
                        </h3>
                        <p className="text-sm text-gray-600 leading-relaxed mb-4">
                            The "SafeHaul Leads" you see in this dashboard are generated independently by our marketing team through targeted campaigns across:
                        </p>
                        <div className="flex flex-wrap gap-2 mb-4">
                            <span className="px-3 py-1 bg-white border border-gray-300 rounded-full text-xs font-bold text-gray-600">Facebook Ads</span>
                            <span className="px-3 py-1 bg-white border border-gray-300 rounded-full text-xs font-bold text-gray-600">Google Search</span>
                            <span className="px-3 py-1 bg-white border border-gray-300 rounded-full text-xs font-bold text-gray-600">Indeed</span>
                            <span className="px-3 py-1 bg-white border border-gray-300 rounded-full text-xs font-bold text-gray-600">TikTok</span>
                        </div>
                        <p className="text-xs text-gray-400 italic">
                            *Any overlap with your existing drivers is purely coincidental based on market activity.
                        </p>
                    </div>

                </div>
            </section>

        </div>

        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end">
            <button onClick={onClose} className="px-8 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl transition shadow-lg shadow-purple-200">
                Got it, thanks!
            </button>
        </div>
      </div>
    </div>
  );
}
