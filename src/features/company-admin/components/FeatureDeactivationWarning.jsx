import React, { useId, useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { AlertTriangle, X } from 'lucide-react';
import { Button, IconButton, StatusMedallion } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Interstitial notice shown when a company has features scheduled for
 * deactivation. Mounted by the company app shell.
 *
 * Migrated to the design system 2026-07-28; it was a hand-built overlay found by
 * the repository-wide dialog scan.
 *
 * Presentation only. Frozen and unchanged: the 7:00–16:00 `America/Chicago`
 * business-hours gate, the future-dated `featureSchedules` selection, the
 * `feature_warnings_shown_{companyId}` localStorage key and its 2-hour
 * re-show rule, the 60-second polling interval and its cleanup, the
 * `companies/{id}/feature_alerts` write with `featureKey` / `userId` /
 * `userEmail` (and its `'Unknown'` fallback) / `serverTimestamp()` plus the
 * `{ views: 1 }` / `{ dismisses: 1 }` / `{ salesClicks: 1 }` counters, the
 * Telegram sales URL and its `_blank` target, and every user-facing string.
 *
 * Defects fixed:
 *  1. **The overlay was a hand-built `fixed inset-0` div** with no
 *     `role="dialog"`, no `aria-modal`, no focus move on open, no focus trap and
 *     no focus restoration — and this dialog sits at `z-[9999]` over the whole
 *     app, so a keyboard user was trapped behind it with no way in or out. It now
 *     uses the shared accessible `Modal`. Escape now dismisses (recording the same
 *     `dismisses` counter the X button does); backdrop click still does **not**
 *     dismiss, preserving the original deliberate `stopPropagation`.
 *  2. **The close control had no accessible name** — an icon-only button whose
 *     only child was a decorative `<X>`.
 *  3. **The scheduled-feature list was an unnamed scroll region.**
 *  4. **`animate-bounce` on a 48px alarm icon** ran indefinitely with no
 *     reduced-motion guard. The medallion carries the same meaning without the
 *     motion.
 *  5. Legacy palette throughout — `bg-red-900/40` backdrop, a solid `bg-red-600`
 *     header, a `from-red-600 to-red-700` gradient action, and `text-2xl
 *     font-black` / `text-lg` arbitrary type — replaced with `--ds-*` tokens and
 *     the approved `Button`.
 *
 * Also removed: unused `doc` / `updateDoc` Firestore imports.
 */
export function FeatureDeactivationWarning() {
    const { currentCompanyProfile, currentUser } = useData();
    const [activeWarnings, setActiveWarnings] = useState([]);
    const titleId = useId();
    const descriptionId = useId();
    const listLabelId = useId();

    useEffect(() => {
        if (!currentCompanyProfile || !currentCompanyProfile.featureSchedules) return;

        const checkSchedules = () => {
            const now = new Date();
            // Check if current time is between 7:00 AM and 4:00 PM Central Time
            const ctTimeString = now.toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false });
            const ctHour = parseInt(ctTimeString.split(', ')[1].split(':')[0], 10);

            if (ctHour < 7 || ctHour >= 16) {
                return; // Outside business hours
            }

            // Find all features scheduled in the future
            const scheduledFeatures = [];
            for (const [featureKey, scheduledDateStr] of Object.entries(currentCompanyProfile.featureSchedules)) {
                if (scheduledDateStr) {
                    const scheduledDate = new Date(scheduledDateStr);
                    if (scheduledDate > now) {
                        scheduledFeatures.push({ featureKey, scheduledDate });
                    }
                }
            }

            if (scheduledFeatures.length > 0) {
                // Use a composite key to ensure we don't spam them if the schedule hasn't changed much
                // but track the fact that we've shown "a" warning. We'll show a single warning for all of them.
                const lastShownKey = `feature_warnings_shown_${currentCompanyProfile.id}`;
                const lastShownStr = localStorage.getItem(lastShownKey);
                const lastShown = lastShownStr ? new Date(lastShownStr) : null;

                // Show if never shown, or if > 2 hours ago
                if (!lastShown || (now - lastShown) > 2 * 60 * 60 * 1000) {
                    setActiveWarnings(scheduledFeatures);
                    localStorage.setItem(lastShownKey, now.toISOString());

                    // Log view to Firestore for all features
                    scheduledFeatures.forEach(f => {
                        logInteraction(f.featureKey, { views: 1 });
                    });
                }
            }
        };

        checkSchedules();

        // Also set up an interval to check periodically (e.g. every minute)
        const interval = setInterval(checkSchedules, 60000);
        return () => clearInterval(interval);

    }, [currentCompanyProfile, currentUser]);

    const logInteraction = async (featureKey, incrementData) => {
        if (!currentCompanyProfile || !currentUser) return null;
        try {
            const alertsRef = collection(db, "companies", currentCompanyProfile.id, "feature_alerts");
            await addDoc(alertsRef, {
                featureKey,
                userId: currentUser.uid,
                userEmail: currentUser.email || 'Unknown',
                timestamp: serverTimestamp(),
                ...incrementData
            });
        } catch (e) {
            console.error("Failed to log interaction", e);
        }
    };

    if (activeWarnings.length === 0) return null;

    const handleClose = () => {
        activeWarnings.forEach(f => logInteraction(f.featureKey, { dismisses: 1 }));
        setActiveWarnings([]);
    };

    const handleContactSales = () => {
        activeWarnings.forEach(f => logInteraction(f.featureKey, { salesClicks: 1 }));
        window.open('https://t.me/tomr_robins0n', '_blank');
        setActiveWarnings([]);
    };

    return (
        <Modal
            onClose={handleClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            // Preserves the original deliberate `stopPropagation`: this notice is
            // not dismissed by clicking away from it.
            closeOnBackdrop={false}
            overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
            className="flex w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-status-danger-border bg-ds-surface shadow-ds-lg"
        >
            <div className="relative flex flex-col items-center border-b border-ds-status-danger-border bg-ds-status-danger-bg p-ds-6 text-center">
                <div className="absolute right-ds-4 top-ds-4">
                    <IconButton label="Dismiss deactivation notice" variant="ghost" size="sm" onClick={handleClose}>
                        <X size={24} aria-hidden="true" />
                    </IconButton>
                </div>
                <StatusMedallion tone="danger" size="lg" className="mb-ds-4"><AlertTriangle /></StatusMedallion>
                <h2 id={titleId} className="text-ds-heading-lg font-bold uppercase tracking-wider text-ds-status-danger-fg">
                    Notice of Deactivation
                </h2>
            </div>
            <div className="p-ds-6 text-center">
                <Stack gap="md">
                    <p id={descriptionId} className="text-ds-body-lg text-ds-content">
                        The following features are scheduled to be turned off for your company:
                    </p>
                    <span id={listLabelId} className="sr-only">Features scheduled for deactivation</span>
                    <div
                        role="region"
                        aria-labelledby={listLabelId}
                        tabIndex={0}
                        className="max-h-48 overflow-y-auto rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 text-left focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                        <Stack gap="sm">
                            {activeWarnings.map(w => (
                                <div key={w.featureKey} className="flex flex-col border-b border-ds-border-subtle pb-ds-2 last:border-0 last:pb-0">
                                    <span className="font-bold text-ds-status-danger-fg">{w.featureKey}</span>
                                    <span className="text-ds-sm text-ds-content-secondary">On: {w.scheduledDate.toLocaleString()}</span>
                                </div>
                            ))}
                        </Stack>
                    </div>
                    <p className="text-ds-sm text-ds-content-secondary">
                        Please reach out to our Sales Team immediately if you wish to keep these features active.
                    </p>
                    <Button variant="danger" size="lg" fullWidth onClick={handleContactSales}>
                        Contact Sales
                    </Button>
                </Stack>
            </div>
        </Modal>
    );
}
