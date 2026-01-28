import React, { useState, useEffect } from 'react';
import {
    Plus, Rocket, History, LayoutGrid, List, Search, Filter,
    MessageSquare, Users, Zap, TrendingUp, BarChart3, Loader2
} from 'lucide-react';
import { collection, query, orderBy, onSnapshot, doc, setDoc, serverTimestamp, deleteDoc } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { CampaignCard } from './components/CampaignCard';
import { CampaignEditor } from './CampaignEditor';
import { CampaignDetails } from './components/CampaignDetails';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function CampaignsDashboard({ companyId }) {
    const [campaigns, setCampaigns] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('drafts'); // 'drafts' | 'history'
    const [selectedCampaignId, setSelectedCampaignId] = useState(null);
    const [viewingSession, setViewingSession] = useState(null);
    const { showSuccess, showError } = useToast();

    // 1. Fetch Drafts
    useEffect(() => {
        if (!companyId) return;
        const q = query(
            collection(db, 'companies', companyId, 'campaign_drafts'),
            orderBy('updatedAt', 'desc')
        );
        const unsub = onSnapshot(q, (snap) => {
            setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            setLoading(false);
        });
        return () => unsub();
    }, [companyId]);

    // 1b. Fetch Live/Past Sessions
    useEffect(() => {
        if (!companyId) return;
        const q = query(
            collection(db, 'companies', companyId, 'bulk_sessions'),
            orderBy('createdAt', 'desc')
        );
        const unsub = onSnapshot(q, (snap) => {
            setSessions(snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    name: data.name,
                    status: data.status,
                    createdAt: data.createdAt,
                    updatedAt: data.lastUpdateAt || data.createdAt, // Map for CampaignCard
                    messageConfig: data.config, // Map for CampaignCard
                    matchCount: data.progress?.totalCount || data.targetIds?.length || 0,
                    progress: data.progress, // Pass full progress for bar
                    ...data
                };
            }));
        });
        return () => unsub();
    }, [companyId]);

    // Stats Calculation
    const liveCount = sessions.filter(s => ['active', 'queued', 'scheduled'].includes(s.status)).length;
    const totalOutreach = sessions.reduce((acc, s) => acc + (s.progress?.processedCount || 0), 0);
    // Approximate response rate (mock calculation for now, or need real data source)
    const responseRate = '0%';

    // 2. Create New Campaign Draft
    const handleNewCampaign = async () => {
        if (!companyId) return;
        const newId = `camp_${Date.now()}`;
        try {
            await setDoc(doc(db, 'companies', companyId, 'campaign_drafts', newId), {
                name: 'Untitled Campaign',
                status: 'draft',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                filters: {},
                messageConfig: { method: 'sms', message: '' }
            });
            setSelectedCampaignId(newId);
        } catch (err) {
            showError("Failed to create campaign: " + err.message);
        }
    };

    const handleDeleteCampaign = async (campaign) => {
        if (!companyId || !campaign.id) return;
        if (!window.confirm(`Are you sure you want to delete "${campaign.name}"?`)) return;

        try {
            // Determine collection based on activeTab or campaign data
            if (activeTab === 'drafts') {
                await deleteDoc(doc(db, 'companies', companyId, 'campaign_drafts', campaign.id));
                showSuccess("Campaign draft deleted");
            } else {
                // User requested ability to delete queued campaigns.
                // If it's active/queued, we should ideally cancel the cloud task,
                // but since we don't have a direct cancel endpoint ready,
                // deleting the doc will cause the worker to 404 and stop processing (safe fail).
                await deleteDoc(doc(db, 'companies', companyId, 'bulk_sessions', campaign.id));
                showSuccess("Campaign record deleted");
            }
        } catch (err) {
            showError("Failed to delete campaign: " + err.message);
        }
    };

    if (selectedCampaignId) {
        return (
            <CampaignEditor
                companyId={companyId}
                campaignId={selectedCampaignId}
                onClose={() => setSelectedCampaignId(null)}
            />
        );
    }

    if (viewingSession) {
        return (
            <CampaignDetails
                campaign={viewingSession}
                onClose={() => setViewingSession(null)}
            />
        );
    }

    return (
        <div className="p-8 max-w-[1600px] mx-auto min-h-screen bg-slate-50/50">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-12 gap-6">
                <div>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-10 w-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 rotate-[-10deg]">
                            <Rocket size={24} />
                        </div>
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight uppercase">Campaigns</h1>
                    </div>
                    <p className="text-slate-500 font-medium text-lg max-w-xl">
                        Design and deploy bulk engagement sequences to reactivate your driver database.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleNewCampaign}
                        className="flex items-center gap-2 px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-slate-900/10 hover:bg-blue-600 hover:shadow-blue-500/20 transition-all active:scale-95 group"
                    >
                        <Plus size={18} className="group-hover:rotate-90 transition-transform" />
                        Create Campaign
                    </button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
                {[
                    { label: 'Live Campaigns', value: liveCount, icon: Zap, color: 'blue' },
                    { label: 'Total Outreach', value: totalOutreach, icon: Users, color: 'emerald' },
                    { label: 'Response Rate', value: responseRate, icon: TrendingUp, color: 'amber' },
                    { label: 'Carrier Score', value: '100', icon: BarChart3, color: 'indigo' },
                ].map((stat, i) => (
                    <div key={i} className="bg-white p-6 rounded-[2.5rem] border border-slate-200 shadow-sm flex items-center gap-5">
                        <div className={`w-14 h-14 rounded-2xl bg-${stat.color}-50 flex items-center justify-center text-${stat.color}-600 ring-1 ring-${stat.color}-100`}>
                            <stat.icon size={26} />
                        </div>
                        <div>
                            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{stat.label}</div>
                            <div className="text-2xl font-black text-slate-900 tracking-tight">{stat.value}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Content Tabs */}
            <div className="flex items-center justify-between mb-8">
                <div className="bg-white p-1 rounded-2xl border border-slate-200 flex gap-1">
                    <button
                        onClick={() => setActiveTab('drafts')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'drafts' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <LayoutGrid size={16} /> Drafts
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                        <History size={16} /> Past Sequences
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Search campaigns..."
                            className="pl-11 pr-6 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-blue-100 outline-none w-64"
                        />
                    </div>
                </div>
            </div>

            {/* List View */}
            {loading ? (
                <div className="py-32 flex flex-col items-center justify-center text-slate-400 animate-in fade-in">
                    <Loader2 size={48} className="animate-spin mb-4" />
                    <span className="font-bold text-lg tracking-tight uppercase tracking-widest">Synchronizing...</span>
                </div>
            ) : (activeTab === 'drafts' ? campaigns : sessions).length === 0 ? (
                <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center animate-in zoom-in-95 duration-700">
                    <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6">
                        <Rocket size={48} />
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight mb-2">No {activeTab === 'drafts' ? 'Drafts' : 'Campaigns'} Found</h3>
                    <p className="text-slate-500 font-medium mb-10 text-center max-w-sm">
                        Ready to reactivate your driver database? Create your first automated messaging sequence.
                    </p>
                    <button
                        onClick={handleNewCampaign}
                        className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/20 hover:bg-blue-700 transition-all active:scale-95"
                    >
                        Define Initial Campaign
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in slide-in-from-bottom-5 duration-700">
                    {(activeTab === 'drafts' ? campaigns : sessions).map(campaign => (
                        <CampaignCard
                            key={campaign.id}
                            campaign={campaign}
                            onClick={() => activeTab === 'drafts' ? setSelectedCampaignId(campaign.id) : setViewingSession(campaign)}
                            onDelete={handleDeleteCampaign}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
