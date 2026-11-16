import React, { useState, useEffect, useCallback } from 'react';
import { Icon, ArrowLeft, Save } from '@design-system/icons';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useCampaignDraft } from './hooks/useCampaignDraft';
import { isLaunchedDraft } from './constants/campaignConstants';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Button, FormField, Input, Notice, SectionNavigation } from '@/design-system/components';
/*
 * The rail's glyphs come from the registry rather than `lucide-react`, because
 * `SectionNavigation` renders `item.icon` through `Icon` and the registry hands
 * out TOKENS, not components — a raw import throws by name at the call site.
 * Required by the migration, not Phase 7 arriving early.
 */
import { MessageSquare, Rocket, Users } from '@/design-system/icons';

// Lazy load sub-components
const AudienceBuilder = React.lazy(() => import('./components/AudienceBuilder').then(m => ({ default: m.AudienceBuilder })));
const ContentComposer = React.lazy(() => import('./components/ContentComposer').then(m => ({ default: m.ContentComposer })));
const LaunchPad = React.lazy(() => import('./components/LaunchPad').then(m => ({ default: m.LaunchPad })));

const SECTIONS = [
    { id: 'audience', label: 'Audience', icon: Users },
    { id: 'content', label: 'Content', icon: MessageSquare },
    { id: 'launch', label: 'Launch', icon: Rocket },
];

/**
 * The campaign as its draft stores it: `rawData`, a large array, lives only in
 * React state, and the launch claim is the server's (`initBulkSession`), so a
 * tab never writes it back.
 */
function draftToSave(campaignData) {
    const { filters, ...rest } = campaignData;
    delete rest.launchClaim;
    const { rawData, ...cleanFilters } = filters || {};
    return { ...rest, filters: cleanFilters };
}

/**
 * The audience as the recruiter chose it, to tell an edit from a recount: key
 * order does not count, and the uploaded rows (React state only) count by
 * identity once there are any.
 */
function audienceOf(filters) {
    const { rawData, ...chosen } = filters || {};
    const sorted = (value) => (value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
        : value);
    return { key: JSON.stringify(sorted(chosen)), rows: rawData?.length ? rawData : null };
}

/**
 * `isNew`: a campaign "Create campaign" opened, with no draft yet. Its first
 * save (the autosave after an edit, or the save before Launch) creates the
 * draft under `campaignId` and later saves update it; leaving before then
 * writes nothing.
 */
export function CampaignEditor({ companyId, campaignId, isNew = false, onClose, onViewReport }) {
    const [activeSection, setActiveSection] = useState('audience');
    const [campaignData, setCampaignData] = useState({
        name: 'Untitled Campaign',
        filters: {},
        messageConfig: { method: 'sms', message: '' },
        status: 'draft'
    });
    const isE2ECampaignMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';

    const { saveDraft, isSaving } = useCampaignDraft(companyId);
    const isLaunched = isLaunchedDraft(campaignData);

    // #9 FIX: Track whether user has made actual changes — prevents auto-save on mount with defaults
    const [isDirty, setIsDirty] = useState(false);
    // A new campaign starts from the defaults: there is no snapshot to wait for.
    const isInitializedRef = React.useRef(isNew);
    // Whether the draft is stored: the ref decides what a save writes, the state shows it.
    const storedRef = React.useRef(!isNew);
    // Saves run one after another, so a save made while the first is on its
    // way (an autosave and the save before Launch) updates the draft the first
    // created rather than creating it again with later times.
    const saveChainRef = React.useRef(Promise.resolve());
    const [isStored, setIsStored] = useState(!isNew);
    const reportedAudienceRef = React.useRef(null);

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

    // The first save creates the draft, every later one updates it. The id is
    // fixed when the editor opens, so saves that overlap still make one draft.
    const persist = useCallback((data) => {
        const run = saveChainRef.current.then(async () => {
            const saved = await saveDraft(campaignId, draftToSave(data), { create: !storedRef.current });
            if (saved) {
                storedRef.current = true;
                setIsStored(true);
            }
            return saved;
        });
        // A failed save does not stop the next one from running.
        saveChainRef.current = run.catch(() => {});
        return run;
    }, [campaignId, saveDraft]);

    // 2. Auto-Save Logic (Write)
    // We debounce the save to avoid thrashing Firestore
    // #9 FIX: Only save when user has actually made changes (isDirty)
    // A launched draft is a record: a stale tab's edits are not saved over it.
    useEffect(() => {
        if (!isDirty || !isInitializedRef.current || isLaunched) return;
        const timer = setTimeout(() => {
            if (campaignId) persist(campaignData);
        }, 2000); // 2 second auto-save delay
        return () => clearTimeout(timer);
    }, [campaignData, campaignId, persist, isDirty, isLaunched]);

    // Launch sends what the editor shows, so an edit autosave has not written
    // yet is saved first: the draft the server claims, and keeps as the
    // record, holds the same, and the claim's update brings back nothing older.
    // A campaign never saved is saved, edited or not: the server claims a draft.
    // A failed save stops the launch, so nothing goes out that the draft lacks.
    const saveBeforeLaunch = useCallback(async () => {
        if (!campaignId || !isInitializedRef.current || isLaunched) return;
        if (!isDirty && storedRef.current) return;
        if (await persist(campaignData) === false) {
            throw new Error('We could not save the campaign. Check your connection and try again.');
        }
    }, [campaignData, campaignId, persist, isDirty, isLaunched]);

    // The server marked the draft launched (`launchedAt`, `sessionId`) before it
    // answered, so it leaves Drafts and cannot be launched again.
    const handleLaunchSuccess = () => {
        onClose();
    };

    const updateData = (section, data) => {
        setIsDirty(true);
        setCampaignData(prev => ({
            ...prev,
            [section]: { ...prev[section], ...data }
        }));
    };

    // `countedFor` names the channel the count was made for, and how many it
    // left out as already messaged by that channel; the launch checks it.
    // The audience step also reports on its own (when it opens, and when the
    // server recounts): only a report whose audience differs from the last one
    // is the recruiter's edit, so opening a campaign saves nothing.
    const handleAudienceChange = useCallback((newFilters, count, countedFor = null) => {
        const audience = audienceOf(newFilters);
        const last = reportedAudienceRef.current;
        reportedAudienceRef.current = audience;
        setCampaignData(prev => {
            // Guard against no-op updates to avoid render loops from effect-driven callbacks.
            if (prev.filters === newFilters && (prev.matchCount || 0) === (count || 0)
                && prev.countedFor?.method === countedFor?.method
                && prev.countedFor?.alreadyMessaged === countedFor?.alreadyMessaged
                && prev.countedFor?.needsRecount === countedFor?.needsRecount) {
                return prev;
            }
            return { ...prev, filters: newFilters, matchCount: count, countedFor };
        });
        if (last && (last.key !== audience.key || last.rows !== audience.rows)) setIsDirty(true);
    }, []);

    const isSectionComplete = (sectionId) => {
        if (sectionId === 'audience') return campaignData.matchCount > 0;
        if (sectionId === 'content') return !!campaignData.messageConfig?.message;
        return false;
    };

    // Opened after its launch (a stale tab, or the moment before the editor
    // closes): the notice replaces the editor, so there is no Launch to press.
    if (isLaunched) {
        const sessionId = campaignData.sessionId;
        return (
            <div className="min-h-full bg-ds-surface-subtle p-ds-6">
                <div className="mx-auto flex max-w-2xl flex-col items-start gap-ds-4">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        <Icon icon={ArrowLeft} /> Exit
                    </Button>
                    <Notice
                        tone="info"
                        title="This campaign was already launched"
                        titleAs="h2"
                        className="w-full"
                        actions={sessionId && onViewReport ? (
                            <Button variant="secondary" size="sm" onClick={() => onViewReport(sessionId)}>
                                View report
                            </Button>
                        ) : undefined}
                    >
                        It can&apos;t be launched again. To message people again, create a new campaign.
                    </Notice>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-ds-surface-subtle md:flex-row">

            {/* Sidebar Navigation */}
            <aside className="flex shrink-0 flex-col border-b border-ds-border bg-ds-surface md:w-64 md:border-b-0 md:border-r">
                <div className="flex h-16 shrink-0 items-center border-b border-ds-border-subtle px-ds-4">
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        <Icon icon={ArrowLeft} /> Exit
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

                    {/*
                        The completion state is domain knowledge — what makes a
                        section "done" is this feature's business — so it is
                        mapped here and handed to the primitive as a status. The
                        rail owns the appearance, the announcement and the
                        keyboard behaviour, none of which this screen should be
                        deciding for itself.
                    */}
                    <SectionNavigation
                        label="Campaign sections"
                        groups={[{
                            id: 'sections',
                            items: SECTIONS.map(section => ({
                                ...section,
                                status: isSectionComplete(section.id) ? 'complete' : 'incomplete',
                            })),
                        }]}
                        currentId={activeSection}
                        currentType="step"
                        frame="none"
                        onSelect={setActiveSection}
                    />
                </div>

                <div className="mt-auto border-t border-ds-border-subtle p-ds-4">
                    <div className="flex items-center justify-between text-ds-xs font-bold text-ds-content-muted">
                        <span role="status" aria-live="polite">{isSaving ? 'Saving...' : (isStored ? 'Auto-Saved' : 'Not saved yet')}</span>
                        <Icon icon={Save} size="sm" className={isSaving ? 'animate-pulse text-ds-action-primary' : ''} />
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
                            method={campaignData.messageConfig?.method === 'email' ? 'email' : 'sms'}
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
                            campaignId={campaignId}
                            campaign={campaignData}
                            onBeforeLaunch={saveBeforeLaunch}
                            onLaunchSuccess={handleLaunchSuccess}
                        />
                    )}
                </React.Suspense>
            </main>

        </div>
    );
}
