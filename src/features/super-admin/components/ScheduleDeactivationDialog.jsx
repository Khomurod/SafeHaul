import React, { useId } from 'react';
import { Icon, Clock, X } from '@design-system/icons';
import { Button, IconButton, Input } from '@/design-system/components';
import { Modal } from '@design-system/patterns';

/**
 * Schedule the automatic deactivation of one feature for one company: a date
 * and a time, confirmed from the feature matrix.
 *
 * Split out of `FeaturesView.jsx` on 2026-09-06 (audit step K), when labelling
 * the alert-stats table's scroll region took that file past the 500-line
 * maximum. This dialog is the one piece of that file with no table in it, so
 * moving it changes no design-system inventory: the two approved raw tables
 * stay where the allowlist records them. Behaviour is unchanged.
 */
export function ScheduleDeactivationDialog({ info, date, time, onDateChange, onTimeChange, loading, onCancel, onConfirm }) {
    const titleId = useId();
    const dateId = useId();
    const timeId = useId();

    return (
        <Modal
            onClose={onCancel}
            labelledBy={titleId}
            closeOnBackdrop={false}
            size="lg"
            scroll="body"
        >
            <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-status-warning-bg p-ds-5">
                <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-status-warning-fg">
                    <Icon icon={Clock} size="2xl" /> Schedule Deactivation
                </h2>
                <IconButton label="Close" variant="ghost" size="sm" onClick={onCancel}>
                    <Icon icon={X} size="xl" />
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

export default ScheduleDeactivationDialog;
