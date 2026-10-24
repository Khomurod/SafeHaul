import React, { useId, useState } from 'react';
import { db } from '@lib/firebase';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { Icon, Zap, Calendar, X, Clock, BarChart2 } from '@design-system/icons';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Button, DataTable, IconButton, Switch } from '@/design-system/components';
import { Modal } from '@design-system/patterns';
import { ScheduleDeactivationDialog } from './ScheduleDeactivationDialog';
import { COMPANY_FEATURES, isFeatureOn } from '../config/features';

/**
 * One company's features: a switch for each, a scheduled switch-off, and the
 * interactions with the alert a switched-off feature shows. The Features tab of
 * the company's screen (`CompanyView`).
 *
 * Frozen contracts: the `features.{key}` / `featureSchedules.{key}` update
 * shapes, the "clear the schedule when a feature is toggled manually" rule, the
 * ISO-string schedule value, the missing-field / invalid / past-date
 * validation order, the `feature_alerts` aggregation by
 * `userEmail || userId || 'Unknown'`, the five feature keys and their order,
 * and every toast string.
 *
 * These are `Switch`, not `Checkbox`: toggling one writes to Firestore
 * immediately, and a checkbox announces a value you set and then submit. After
 * a write the company is read again (`onChanged`), and every control waits for
 * that read, so a second click cannot write the value the first one replaced.
 */
const ALL_FEATURES = COMPANY_FEATURES;

export function FeaturesView({ company, onChanged }) {
    const { showSuccess, showError } = useToast();
    const titleId = useId();
    const [loading, setLoading] = useState(false);
    // The company as read when a write began: until it is read again, every control waits.
    const [writtenOver, setWrittenOver] = useState(null);
    const busy = writtenOver === company;

    const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
    const [selectedScheduleInfo, setSelectedScheduleInfo] = useState(null);
    const [scheduleDate, setScheduleDate] = useState('');
    const [scheduleTime, setScheduleTime] = useState('');

    const [statsModalOpen, setStatsModalOpen] = useState(false);
    const [selectedStatsInfo, setSelectedStatsInfo] = useState(null);
    const [alertStats, setAlertStats] = useState([]);
    const [statsLoading, setStatsLoading] = useState(false);

    /** Writes `fields` to the company; true when saved, and the company is read again. */
    const write = async (fields) => {
        setWrittenOver(company);
        try {
            await updateDoc(doc(db, "companies", company.id), fields);
            onChanged();
            return true;
        } catch (e) {
            setWrittenOver(null);
            throw e;
        }
    };

    const toggleFeature = async (featureKey, currentValue) => {
        try {
            await write({
                [`features.${featureKey}`]: !currentValue,
                [`featureSchedules.${featureKey}`]: null // clear schedule if manually toggled
            });
            showSuccess(`Updated ${company.companyName}`);
        } catch (e) {
            console.error("Update failed:", e);
            showError("Failed to toggle feature.");
        }
    };

    const openScheduleModal = (featureKey) => {
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

        const { featureKey } = selectedScheduleInfo;
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
            await write({
                [`featureSchedules.${featureKey}`]: dt.toISOString()
            });
            showSuccess(`Scheduled deactivation for ${company.companyName}`);
            setScheduleModalOpen(false);
        } catch (e) {
            console.error("Schedule failed:", e);
            showError("Failed to schedule deactivation.");
        } finally {
            setLoading(false);
        }
    };

    const cancelSchedule = async (featureKey) => {
        try {
            await write({
                [`featureSchedules.${featureKey}`]: null
            });
            showSuccess(`Cancelled schedule for ${company.companyName}`);
        } catch (e) {
            console.error("Cancel schedule failed:", e);
            showError("Failed to cancel schedule.");
        }
    };

    const openStatsModal = async (featureKey) => {
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

    return (
        <>
            <section aria-labelledby={titleId}>
                <h3 id={titleId} className="mb-ds-3 flex items-center gap-ds-2 text-ds-body font-bold text-ds-content">
                    <Icon icon={Zap} className="text-ds-status-accent-fg" />
                    Features
                </h3>
                <div
                    role="region"
                    aria-label="Features of this company"
                    tabIndex={0}
                    className="overflow-x-auto rounded-ds-lg border border-ds-border-subtle focus-visible:outline-none focus-visible:shadow-ds-focus"
                >
                    <table className="ds-native-table">
                        <caption className="sr-only">Features of {company.companyName}</caption>
                        <thead>
                            <tr>
                                <th scope="col">Feature</th>
                                <th scope="col">On</th>
                                <th scope="col">Scheduled switch-off</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ALL_FEATURES.map(f => {
                                // On unless switched off, as every screen that honours
                                // the flag reads it (`features.{key} === false` hides it).
                                const isEnabled = isFeatureOn(company, f.key);
                                const schedule = company.featureSchedules?.[f.key];

                                return (
                                    <tr key={f.key}>
                                        <th scope="row" className="font-medium text-ds-content">{f.label}</th>
                                        <td>
                                            <Switch
                                                label={`${f.label} for ${company.companyName}`}
                                                checked={isEnabled}
                                                disabled={busy}
                                                onChange={() => toggleFeature(f.key, isEnabled)}
                                            />
                                        </td>
                                        <td>
                                            <div className="flex flex-wrap items-center gap-ds-2">
                                                {isEnabled && (
                                                    <IconButton
                                                        label={`Schedule deactivation of ${f.label} for ${company.companyName}`}
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={busy}
                                                        onClick={() => openScheduleModal(f.key)}
                                                    >
                                                        <Icon icon={Calendar} />
                                                    </IconButton>
                                                )}
                                                {schedule && (
                                                    <>
                                                        <span className="flex items-center gap-1 rounded-ds-sm bg-ds-status-warning-bg px-1.5 py-1 text-ds-xs text-ds-status-warning-fg">
                                                            <Icon icon={Clock} size="xs" />
                                                            {new Date(schedule).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                            <IconButton
                                                                label={`Cancel scheduled deactivation of ${f.label} for ${company.companyName}`}
                                                                variant="ghost"
                                                                size="sm"
                                                                disabled={busy}
                                                                onClick={() => cancelSchedule(f.key)}
                                                            >
                                                                <Icon icon={X} size="xs" />
                                                            </IconButton>
                                                        </span>
                                                        <Button variant="ghost" size="sm" onClick={() => openStatsModal(f.key)}>
                                                            <Icon icon={BarChart2} size="xs" /> Alerts
                                                            <span className="sr-only">{` for ${f.label} at ${company.companyName}`}</span>
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

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

/** Each user's interactions with the alert: one row per email, counts on the end edge. */
const ALERT_STATS_COLUMNS = [
    {
        key: 'email',
        header: 'User Email',
        rowHeader: true,
        width: 'xl',
        render: (stat) => <span className="[overflow-wrap:anywhere]">{stat.email}</span>,
    },
    { key: 'views', header: 'Views', align: 'end', width: 'sm', render: (stat) => <span className="tabular-nums">{stat.views}</span> },
    { key: 'dismisses', header: 'Dismisses (X)', align: 'end', width: 'md', render: (stat) => <span className="tabular-nums">{stat.dismisses}</span> },
    {
        key: 'salesClicks',
        header: 'Contact Sales Clicks',
        align: 'end',
        width: 'lg',
        render: (stat) => <span className="tabular-nums">{stat.salesClicks}</span>,
    },
];

function AlertStatsDialog({ info, stats, loading, onClose }) {
    const titleId = useId();

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            size="2xl"
            scroll="body"
        >
            <div className="flex shrink-0 items-center justify-between border-b border-ds-border-subtle bg-ds-status-info-bg p-ds-5">
                <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-status-info-fg">
                    <Icon icon={BarChart2} size="2xl" /> Alert Interactions
                </h2>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onClose}>
                    <Icon icon={X} size="xl" />
                </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-ds-6">
                <p className="mb-ds-4 text-ds-sm text-ds-content-secondary">
                    Stats for <strong>{info?.featureKey}</strong> at <strong>{info?.company?.companyName}</strong>.
                </p>

                <DataTable
                    ariaLabel="Alert interactions by user"
                    density="compact"
                    minWidth="none"
                    data={stats}
                    columns={ALERT_STATS_COLUMNS}
                    getRowId={(stat) => stat.email}
                    isLoading={loading}
                    loadingLabel="Loading alert stats"
                    empty={{ title: 'No alert interactions recorded yet.' }}
                />
            </div>
            <div className="flex shrink-0 justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
        </Modal>
    );
}

