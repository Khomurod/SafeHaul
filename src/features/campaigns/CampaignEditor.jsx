import React, { useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft, CheckCircle2, Circle, Users, MessageSquare, Rocket, Save
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useCampaignDraft } from './hooks/useCampaignDraft';

// Lazy load sub-components
const AudienceBuilder = React.lazy(() => import('./components/AudienceBuilder').then(m => ({ default: m.AudienceBuilder })));
const ContentComposer = React.lazy(() => import('./components/ContentComposer').then(m => ({ default: m.ContentComposer })));
const LaunchPad = React.lazy(() => import('./components/LaunchPad').then(m => ({ default: m.LaunchPad })));

const SECTIONS = [
    { id: 'audience', label: 'Audience', icon: Users },
    { id: 'content', label: 'Content', icon: MessageSquare },
    { id: 'launch', label: 'Launch', icon: Rocket },
];

export function CampaignEditor({ companyId, campaignId, onClose }) {
    const [activeSection, setActiveSection] = useState('audience');
    const [campaignData, setCampaignData] = useState({
        name: 'Untitled Campaign',
        filters: {},
        messageConfig: { method: 'sms', message: '' },
        status: 'draft'
    });

    const { saveDraft, isSaving } = useCampaignDraft(companyId);

    // #9 FIX: Track whether user has made actual changes — prevents auto-save on mount with defaults
    const [isDirty, setIsDirty] = useState(false);
    const isInitializedRef = React.useRef(false);

    // 1. Sync Logic (Read)
    useEffect(() => {
        if (!companyId || !campaignId) return;
        const unsub = onSnapshot(doc(db, 'companies', companyId, 'campaign_drafts', campaignId), (snap) => {
            if (snap.exists()) {
                const incoming = snap.data();
                setCampaignData(prev => {
                    // Deep-merge filters to preserve rawData (which only lives in React state, not Firestore)
                    const mergedFilters = { ...prev.filters, ...incoming.filters };
                    // Preserve rawData from React state — Firestore never has it
                    if (prev.filters?.rawData) {
                        mergedFilters.rawData = prev.filters.rawData;
                    }
                    return { ...prev, ...incoming, filters: mergedFilters };
                });
                // Mark initialization complete after first snapshot
                isInitializedRef.current = true;
            }
        });
        return () => unsub();
    }, [companyId, campaignId]);

    // 2. Auto-Save Logic (Write)
    // We debounce the save to avoid thrashing Firestore
    // #9 FIX: Only save when user has actually made changes (isDirty)
    useEffect(() => {
        if (!isDirty || !isInitializedRef.current) return;
        const timer = setTimeout(() => {
            if (campaignId) {
                // Strip rawData before saving — it's a large array that only lives in React state
                const { filters, ...rest } = campaignData;
                const { rawData, ...cleanFilters } = filters || {};
                saveDraft(campaignId, { ...rest, filters: cleanFilters });
            }
        }, 2000); // 2 second auto-save delay
        return () => clearTimeout(timer);
    }, [campaignData, campaignId, saveDraft, isDirty]);

    const updateData = (section, data) => {
        setIsDirty(true);
        setCampaignData(prev => ({
            ...prev,
            [section]: { ...prev[section], ...data }
        }));
    };

    const isSectionComplete = (sectionId) => {
        if (sectionId === 'audience') return campaignData.matchCount > 0;
        if (sectionId === 'content') return !!campaignData.messageConfig?.message;
        return false;
    };

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden">

            {/* Sidebar Navigation */}
            <aside className="w-64 bg-white border-r border-slate-200 flex flex-col z-20">
                <div className="h-16 flex items-center px-6 border-b border-slate-100">
                    <button onClick={onClose} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm transition-colors">
                        <ArrowLeft size={16} /> Exit
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-8">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Campaign Name</label>
                        <input
                            type="text"
                            value={campaignData.name}
                            onChange={(e) => { setIsDirty(true); setCampaignData(prev => ({ ...prev, name: e.target.value })); }}
                            className="w-full text-lg font-black text-slate-900 bg-transparent border-b border-slate-200 focus:border-blue-500 outline-none transition-all pb-1 truncate placeholder-slate-300"
                            placeholder="Enter campaign name..."
                        />
                    </div>

                    <nav className="space-y-2">
                        {SECTIONS.map(section => {
                            const isActive = activeSection === section.id;
                            const isDone = isSectionComplete(section.id);
                            const Icon = section.icon;

                            return (
                                <button
                                    key={section.id}
                                    onClick={() => setActiveSection(section.id)}
                                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${isActive ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <Icon size={18} className={isActive ? 'text-blue-600' : 'text-slate-400'} />
                                        <span className="text-sm font-bold">{section.label}</span>
                                    </div>
                                    {isDone ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-slate-200" />}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <div className="mt-auto p-6 border-t border-slate-100">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                        <span>{isSaving ? 'Saving...' : 'Auto-Saved'}</span>
                        <Save size={14} className={isSaving ? 'animate-pulse text-blue-500' : ''} />
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto bg-slate-50 p-8 relative">
                <React.Suspense fallback={<div className="p-10 text-center text-slate-400">Loading Module...</div>}>
                    {activeSection === 'audience' && (
                        <AudienceBuilder
                            companyId={companyId}
                            filters={campaignData.filters || {}}
                            onChange={(newFilters, count) => {
                                setCampaignData(prev => ({ ...prev, filters: newFilters, matchCount: count }));
                            }}
                        />
                    )}

                    {activeSection === 'content' && (
                        <ContentComposer
                            messageConfig={campaignData.messageConfig || {}}
                            onChange={(newConfig) => updateData('messageConfig', newConfig)}
                        />
                    )}

                    {activeSection === 'launch' && (
                        <LaunchPad
                            companyId={companyId}
                            campaign={campaignData}
                            onLaunchSuccess={onClose}
                        />
                    )}
                </React.Suspense>
            </main>

        </div>
    );
}
