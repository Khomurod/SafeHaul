import React, { useState, useEffect, useCallback } from 'react';
import {
    ArrowLeft, CheckCircle2, Circle, Users, MessageSquare, Rocket, Save
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useCampaignDraft } from './hooks/useCampaignDraft';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, FormField, Input } from '@/design-system/components';

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
    const isE2ECampaignMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';

    const { saveDraft, isSaving } = useCampaignDraft(companyId);

    // #9 FIX: Track whether user has made actual changes — prevents auto-save on mount with defaults
    const [isDirty, setIsDirty] = useState(false);
    const isInitializedRef = React.useRef(false);

    // 1. Sync Logic (Read)
    useEffect(() => {
        if (isE2ECampaignMock) {
            setCampaignData({
                name: 'E2E Mock Campaign',
                filters: { mode: 'all' },
                messageConfig: { method: 'sms', message: 'E2E mock campaign message.' },
                status: 'draft',
                matchCount: 12,
            });
            isInitializedRef.current = true;
            return () => {};
        }
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
    }, [companyId, campaignId, isE2ECampaignMock]);

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

    const handleAudienceChange = useCallback((newFilters, count) => {
        setCampaignData(prev => {
            // Guard against no-op updates to avoid render loops from effect-driven callbacks.
            if (prev.filters === newFilters && (prev.matchCount || 0) === (count || 0)) {
                return prev;
            }
            return { ...prev, filters: newFilters, matchCount: count };
        });
        setIsDirty(true);
    }, []);

    const isSectionComplete = (sectionId) => {
        if (sectionId === 'audience') return campaignData.matchCount > 0;
        if (sectionId === 'content') return !!campaignData.messageConfig?.message;
        return false;
    };

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-ds-surface-subtle md:flex-row">

            {/* Sidebar Navigation */}
            <aside className="flex shrink-0 flex-col border-b border-ds-border bg-ds-surface md:w-64 md:border-b-0 md:border-r">
                <div className="flex h-16 shrink-0 items-center border-b border-ds-border-subtle px-ds-4">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        <ArrowLeft size={16} aria-hidden="true" /> Exit
                    </Button>
                </div>

                <div className="flex flex-col gap-ds-6 p-ds-4 md:p-ds-6">
                    <FormField id="campaign-editor-name" label="Campaign Name">
                        <Input
                            type="text"
                            value={campaignData.name}
                            onChange={(e) => { setIsDirty(true); setCampaignData(prev => ({ ...prev, name: e.target.value })); }}
                            placeholder="Enter campaign name..."
                        />
                    </FormField>

                    <nav aria-label="Campaign sections" className="flex flex-col gap-ds-2">
                        {SECTIONS.map(section => {
                            const isActive = activeSection === section.id;
                            const isDone = isSectionComplete(section.id);
                            const Icon = section.icon;

                            return (
                                <button
                                    key={section.id}
                                    type="button"
                                    onClick={() => setActiveSection(section.id)}
                                    aria-current={isActive ? 'step' : undefined}
                                    className={[
                                        'flex w-full items-center justify-between rounded-ds-lg p-ds-3 transition-all',
                                        'focus-visible:outline-none focus-visible:shadow-ds-focus',
                                        isActive
                                            ? 'bg-ds-status-info-bg text-ds-status-info-fg shadow-ds-xs'
                                            : 'text-ds-content-secondary hover:bg-ds-surface-subtle',
                                    ].join(' ')}
                                >
                                    <span className="flex items-center gap-ds-3">
                                        <Icon size={18} className={isActive ? 'text-ds-action-primary' : 'text-ds-content-muted'} aria-hidden="true" />
                                        <span className="text-ds-sm font-bold">{section.label}</span>
                                    </span>
                                    {isDone ? (
                                        <>
                                            <CheckCircle2 size={16} className="text-ds-status-success-fg" aria-hidden="true" />
                                            <span className="sr-only"> (completed)</span>
                                        </>
                                    ) : (
                                        <>
                                            <Circle size={16} className="text-ds-border" aria-hidden="true" />
                                            <span className="sr-only"> (incomplete)</span>
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                </div>

                <div className="mt-auto border-t border-ds-border-subtle p-ds-4">
                    <div className="flex items-center justify-between text-ds-xs font-bold text-ds-content-muted">
                        <span role="status" aria-live="polite">{isSaving ? 'Saving...' : 'Auto-Saved'}</span>
                        <Save size={14} className={isSaving ? 'animate-pulse text-ds-action-primary' : ''} aria-hidden="true" />
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="relative min-w-0 flex-1 overflow-y-auto bg-ds-surface-subtle p-ds-6">
                <React.Suspense fallback={<div role="status" className="p-ds-10 text-center text-ds-content-muted">Loading Module...</div>}>
                    {activeSection === 'audience' && (
                        <AudienceBuilder
                            companyId={companyId}
                            filters={campaignData.filters || {}}
                            campaignScopeKey={`${companyId || 'no-company'}:${campaignId || 'new-campaign'}`}
                            onChange={handleAudienceChange}
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
