import React, { useId, useState, useMemo } from 'react';
import { db } from '@lib/firebase';
import { doc, updateDoc, writeBatch } from 'firebase/firestore';
import { Search, Zap, Loader2, Calendar, X, Clock, BarChart2 } from 'lucide-react';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { collection, getDocs } from 'firebase/firestore';
import { Button, Card, Checkbox, IconButton, Input } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Global feature-override matrix: one row per company, one column per feature.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the
 * `features.{key}` / `featureSchedules.{key}` update shapes, the "clear the
 * schedule when a feature is toggled manually" rule, the ISO-string schedule
 * value, the missing-field / invalid / past-date validation order, the
 * `feature_alerts` aggregation by `userEmail || userId || 'Unknown'`, the five
 * feature keys and their order, and every toast string are unchanged.
 *
 * Defects fixed here:
 *  1. **The feature toggles had no accessible name and no state.** Each was a
 *     bare `<button>` containing only a styled `<span>` — no text, no
 *     `aria-label`, no `aria-checked`, no `role`. A screen-reader user heard
 *     "button" and could not tell which feature it was, which company it
 *     belonged to, or whether it was on. They are now approved `Checkbox`
 *     controls whose label names both the feature and the company.
 *  2. Two hand-built `fixed inset-0` overlays (schedule, alert stats) with no
 *     dialog role, focus trap, Escape or focus restoration — both now use the
 *     shared accessible `Modal`. The old ones also closed on any backdrop click
 *     while relying on `stopPropagation` inside, so a drag that ended outside
 *     discarded an in-progress schedule.
 *  3. `text-[10px]` schedule text, below the 12 px floor.
 *  4. The schedule date/time inputs were unlabelled — `<label>` with no
 *     `htmlFor` and no `id` on the control.
 *  5. The per-cell schedule / cancel / alerts controls were icon-only with no
 *     accessible name, repeated once per company × feature.
 *  6. Legacy palette throughout, including two saturated modal headers.
 *
 * A native `Checkbox` is used rather than an ARIA switch: the design system has
 * no approved switch primitive (the `ToggleSwitch` in Company Settings is
 * feature-owned, and importing it here would cross feature boundaries). That gap
 * is recorded in the roadmap. A checkbox is the correct accessible fallback for
 * a boolean and needs no custom keyboard handling.
 *
 * NOTE — `handleBulkAction` below is **unreachable**: nothing in the render calls
 * it, so the platform has no bulk enable/disable UI despite the handler existing.
 * It is left intact rather than migrated or deleted — building the UI would be
 * inventing a workflow, and deleting it would discard possibly-staged work.
 * Recorded in the roadmap for an owner decision.
 */
const ALL_FEATURES = [
    { key: 'pev', label: 'PEV' },
    { key: 'campaignsEnabled', label: 'Campaigns' },
    { key: 'eDocs', label: 'E-Docs' },
    { key: 'importLeads', label: 'Import Leads' },
    { key: 'callTracking', label: 'Call Tracking' }
];

export function FeaturesView({ companyList, onDataUpdate }) {
    const { showSuccess, showError, showInfo } = useToast();
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [bulkLoading, setBulkLoading] = useState(false);
    const searchId = useId();

    const filteredList = useMemo(() => {
        if (!search) return companyList;
        const term = search.toLowerCase();
        return companyList.filter(c => c.companyName?.toLowerCase().includes(term));
    }, [companyList, search]);

    const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
    const [selectedScheduleInfo, setSelectedScheduleInfo] = useState(null);
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');

    const [statsModalOpen, setStatsModalOpen] = useState(false);
    const [selectedStatsInfo, setSelectedStatsInfo] = useState(null);
    const [alertStats, setAlertStats] = useState([]);
    const [statsLoading, setStatsLoading] = useState(false);

    const toggleFeature = async (company, featureKey, currentValue) => {
        try {
            const docRef = doc(db, "companies", company.id);
            await updateDoc(docRef, {
                [`features.${featureKey}`]: !currentValue,
                [`featureSchedules.${featureKey}`]: null // clear schedule if manually toggled
            });
            showSuccess(`Updated ${company.companyName}`);
            onDataUpdate();
        } catch (e) {
            console.error("Update failed:", e);
            showError("Failed to toggle feature.");
        }
    };

    const openScheduleModal = (company, featureKey) => {
        setSelectedScheduleInfo({ company, featureKey });
        setScheduleDate('');
        setScheduleTime('');
        setScheduleModalOpen(true);
    };

    const handleScheduleDeactivation = async () => {
        if (!scheduleDate || !scheduleTime) {
            showError("Please select both date and time.");
            return;
        }

        const { company, featureKey } = selectedScheduleInfo;
        const dtStr = `${scheduleDate}T${scheduleTime}:00`;
        const dt = new Date(dtStr);
        if (isNaN(dt.getTime())) {
            showError("Invalid date/time.");
            return;
        }

        if (dt.getTime() < Date.now()) {
            showError("Cannot schedule in the past.");
            return;
        }

        setLoading(true);
        try {
            const docRef = doc(db, "companies", company.id);
            await updateDoc(docRef, {
                [`featureSchedules.${featureKey}`]: dt.toISOString()
            });
            showSuccess(`Scheduled deactivation for ${company.companyName}`);
            setScheduleModalOpen(false);
            onDataUpdate();
        } catch (e) {
            console.error("Schedule failed:", e);
            showError("Failed to schedule deactivation.");
        } finally {
            setLoading(false);
        }
    };

    const cancelSchedule = async (company, featureKey) => {
        try {
            const docRef = doc(db, "companies", company.id);
            await updateDoc(docRef, {
                [`featureSchedules.${featureKey}`]: null
            });
            showSuccess(`Cancelled schedule for ${company.companyName}`);
            onDataUpdate();
        } catch (e) {
            console.error("Cancel schedule failed:", e);
            showError("Failed to cancel schedule.");
        }
    };

    const openStatsModal = async (company, featureKey) => {
        setSelectedStatsInfo({ company, featureKey });
        setAlertStats([]);
        setStatsModalOpen(true);
        setStatsLoading(true);

        try {
            const alertsRef = collection(db, "companies", company.id, "feature_alerts");
            const snapshot = await getDocs(alertsRef);

            const statsMap = new Map();

            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (data.featureKey === featureKey) {
                    const email = data.userEmail || data.userId || 'Unknown';
                    if (!statsMap.has(email)) {
                        statsMap.set(email, { email, views: 0, dismisses: 0, salesClicks: 0 });
                    }
                    const userStats = statsMap.get(email);
                    userStats.views += data.views || 0;
                    userStats.dismisses += data.dismisses || 0;
                    userStats.salesClicks += data.salesClicks || 0;
                }
            });

            setAlertStats(Array.from(statsMap.values()));
        } catch (error) {
            console.error("Error loading stats:", error);
            showError("Failed to load alert stats.");
        } finally {
            setStatsLoading(false);
        }
    };

    // Unreachable — see this file's header note. Preserved verbatim.
    const handleBulkAction = async (featureKey, targetState) => {
        setBulkLoading(true);
        showInfo("Processing bulk update...");

        try {
            const BATCH_SIZE = 400;
            const chunks = [];
            for (let i = 0; i < companyList.length; i += BATCH_SIZE) {
                chunks.push(companyList.slice(i, i + BATCH_SIZE));
            }

            for (const chunk of chunks) {
                const batch = writeBatch(db);
                chunk.forEach(company => {
                    const ref = doc(db, "companies", company.id);
                    batch.update(ref, { [`features.${featureKey}`]: targetState });
                });
                await batch.commit();
            }

            showSuccess(`Successfully ${targetState ? 'Enabled' : 'Disabled'} feature for all companies.`);
            onDataUpdate();
        } catch (e) {
            console.error("Bulk update failed:", e);
            showError("Bulk update failed.");
        } finally {
            setBulkLoading(false);
        }
    };
    // Referenced so the unreachable handler does not read as an unused-variable
    // lint error while it awaits an owner decision.
    void handleBulkAction; void bulkLoading;

    return (
        <>
            <Stack gap="lg" className="flex h-full flex-col">
                <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-ds-border-subtle p-ds-5">
                        <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                            <Zap size={20} className="text-ds-status-accent-fg" aria-hidden="true" />
                            Company Feature Overrides
                        </h2>
                    </div>

                    <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface p-ds-4">
                        <div className="relative max-w-md">
                            <label htmlFor={searchId} className="sr-only">Search companies by name</label>
                            <Input
                                id={searchId}
                                type="search"
                                placeholder="Search companies..."
                                className="pl-10"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                        </div>
                    </div>

                    {/* Keyboard-focusable, named scroll region: below `sm` the table
                    scrolls horizontally, and in the empty state it holds no
                    focusable children, so keyboard users could not scroll it at
                    all (axe `scrollable-region-focusable`). Same pattern already
                    used by `EnvelopeHistory` and `CampaignResultsTable`. */}
                <div
                    role="region"
                    aria-label="Feature matrix"
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-auto bg-ds-canvas focus-visible:outline-none focus-visible:shadow-ds-focus"
                >
                        <table className="w-full border-collapse text-left">
                            <caption className="sr-only">Feature overrides by company</caption>
                            <thead className="sticky top-0 z-20 bg-ds-surface-subtle shadow-ds-xs">
                                <tr>
                                    <th scope="col" className="sticky left-0 z-30 border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Company Name</th>
                                    {ALL_FEATURES.map(f => (
                                        <th key={f.key} scope="col" className="whitespace-nowrap border-b border-ds-border-subtle px-ds-6 py-ds-3 text-center text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">
                                            {f.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ds-border-subtle bg-ds-surface">
                                {filteredList.length === 0 ? (
                                    <tr>
                                        <td colSpan={ALL_FEATURES.length + 1} className="p-ds-10 text-center text-ds-content-muted">
                                            No companies found.
                                        </td>
                                    </tr>
                                ) : filteredList.map(company => (
                                    <tr key={company.id} className="transition-colors hover:bg-ds-surface-subtle">
                                        <th scope="row" className="sticky left-0 z-10 border-r border-ds-border-subtle bg-ds-surface px-ds-6 py-ds-4 text-left font-medium text-ds-content">
                                            {company.companyName}
                                        </th>
                                        {ALL_FEATURES.map(f => {
                                            const isEnabled = company.features?.[f.key] === true;
                                            const schedule = company.featureSchedules?.[f.key];

                                            return (
                                                <td key={f.key} className="min-w-[160px] space-y-ds-2 px-ds-6 py-ds-4 text-center">
                                                    <div className="flex items-center justify-center gap-ds-2">
                                                        <Checkbox
                                                            label={`${f.label} for ${company.companyName}`}
                                                            labelHidden
                                                            checked={isEnabled}
                                                            onChange={() => toggleFeature(company, f.key, isEnabled)}
                                                        />
                                                        {isEnabled && (
                                                            <IconButton
                                                                label={`Schedule deactivation of ${f.label} for ${company.companyName}`}
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => openScheduleModal(company, f.key)}
                                                            >
                                                                <Calendar size={16} aria-hidden="true" />
                                                            </IconButton>
                                                        )}
                                                    </div>
                                                    {schedule && (
                                                        <div className="flex flex-col items-center justify-center gap-1 rounded-ds-sm bg-ds-status-warning-bg px-1.5 py-1 text-ds-xs leading-tight text-ds-status-warning-fg">
                                                            <div className="flex items-center gap-1">
                                                                <Clock size={12} aria-hidden="true" />
                                                                <span>{new Date(schedule).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                                                                <IconButton
                                                                    label={`Cancel scheduled deactivation of ${f.label} for ${company.companyName}`}
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => cancelSchedule(company, f.key)}
                                                                >
                                                                    <X size={12} aria-hidden="true" />
                                                                </IconButton>
                                                            </div>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => openStatsModal(company, f.key)}
                                                            >
                                                                <BarChart2 size={12} aria-hidden="true" /> Alerts
                                                                <span className="sr-only">{` for ${f.label} at ${company.companyName}`}</span>
                                                            </Button>
                                                        </div>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </Stack>

            {scheduleModalOpen && (
                <ScheduleDeactivationDialog
                    info={selectedScheduleInfo}
                    date={scheduleDate}
                    time={scheduleTime}
                    onDateChange={setScheduleDate}
                    onTimeChange={setScheduleTime}
                    loading={loading}
                    onCancel={() => setScheduleModalOpen(false)}
                    onConfirm={handleScheduleDeactivation}
                />
            )}

            {statsModalOpen && (
                <AlertStatsDialog
                    info={selectedStatsInfo}
                    stats={alertStats}
                    loading={statsLoading}
                    onClose={() => setStatsModalOpen(false)}
                />
            )}
        </>
    );
}

function ScheduleDeactivationDialog({ info, date, time, onDateChange, onTimeChange, loading, onCancel, onConfirm }) {
    const titleId = useId();
    const dateId = useId();
    const timeId = useId();

    return (
        <Modal
            onClose={onCancel}
            labelledBy={titleId}
            closeOnBackdrop={false}
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-status-warning-bg p-ds-5">
                <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-status-warning-fg">
                    <Clock size={24} aria-hidden="true" /> Schedule Deactivation
                </h2>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onCancel}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>
            <div className="space-y-ds-4 p-ds-6">
                <p className="text-ds-sm text-ds-content-secondary">
                    Select when you want the feature <strong>{info?.featureKey}</strong> to be deactivated automatically for <strong>{info?.company?.companyName}</strong>.
                </p>
                <div className="flex flex-col gap-ds-2">
                    <label htmlFor={dateId} className="text-ds-sm font-medium text-ds-content-secondary">Date</label>
                    <Input
                        id={dateId}
                        type="date"
                        value={date}
                        onChange={(e) => onDateChange(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                    />
                </div>
                <div className="flex flex-col gap-ds-2">
                    <label htmlFor={timeId} className="text-ds-sm font-medium text-ds-content-secondary">Time</label>
                    <Input
                        id={timeId}
                        type="time"
                        value={time}
                        onChange={(e) => onTimeChange(e.target.value)}
                    />
                </div>
                <div className="mt-ds-6 flex justify-end gap-ds-2">
                    <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                    <Button
                        variant="primary"
                        onClick={onConfirm}
                        disabled={loading || !date || !time}
                        loading={loading}
                    >
                        {loading ? "Scheduling..." : "Schedule"}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function AlertStatsDialog({ info, stats, loading, onClose }) {
    const titleId = useId();

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="flex shrink-0 items-center justify-between border-b border-ds-border-subtle bg-ds-status-info-bg p-ds-5">
                <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-status-info-fg">
                    <BarChart2 size={24} aria-hidden="true" /> Alert Interactions
                </h2>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-ds-6">
                <p className="mb-ds-4 text-ds-sm text-ds-content-secondary">
                    Stats for <strong>{info?.featureKey}</strong> at <strong>{info?.company?.companyName}</strong>.
                </p>

                {loading ? (
                    <div role="status" className="flex justify-center p-ds-8">
                        <Loader2 className="animate-spin text-ds-content-link" size={32} aria-hidden="true" />
                        <span className="sr-only">Loading alert stats</span>
                    </div>
                ) : stats.length === 0 ? (
                    <p className="rounded-ds-lg bg-ds-surface-subtle p-ds-8 text-center text-ds-content-muted">No alert interactions recorded yet.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface text-left">
                            <caption className="sr-only">Alert interactions by user</caption>
                            <thead className="bg-ds-surface-subtle">
                                <tr>
                                    <th scope="col" className="border-b border-ds-border-subtle px-ds-4 py-ds-2 text-ds-sm font-bold text-ds-content-secondary">User Email</th>
                                    <th scope="col" className="border-b border-ds-border-subtle px-ds-4 py-ds-2 text-center text-ds-sm font-bold text-ds-content-secondary">Views</th>
                                    <th scope="col" className="border-b border-ds-border-subtle px-ds-4 py-ds-2 text-center text-ds-sm font-bold text-ds-content-secondary">Dismisses (X)</th>
                                    <th scope="col" className="border-b border-ds-border-subtle px-ds-4 py-ds-2 text-center text-ds-sm font-bold text-ds-content-secondary">Contact Sales Clicks</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-ds-border-subtle">
                                {stats.map((stat, idx) => (
                                    <tr key={idx} className="hover:bg-ds-surface-subtle">
                                        <th scope="row" className="px-ds-4 py-ds-2 text-left text-ds-sm font-normal text-ds-content">{stat.email}</th>
                                        <td className="px-ds-4 py-ds-2 text-center text-ds-sm tabular-nums">{stat.views}</td>
                                        <td className="px-ds-4 py-ds-2 text-center text-ds-sm tabular-nums">{stat.dismisses}</td>
                                        <td className="px-ds-4 py-ds-2 text-center text-ds-sm font-bold tabular-nums text-ds-content-link">{stat.salesClicks}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <div className="flex shrink-0 justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
        </Modal>
    );
}
