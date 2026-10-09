import React from 'react';
import { Button, ProgressBar } from '@/design-system/components';

/**
 * An upload on its way: how much of the file has been sent, and Cancel.
 *
 * A tinted block, and deliberately NOT a `Notice`. Its content is a
 * `ProgressBar` and a percentage readout; the text labels the widget rather than
 * being the message, and an info glyph beside a progress bar states nothing the
 * bar does not. `announce` is off where the picker beside it already says it is
 * uploading, so one live region speaks rather than two.
 */
export function UploadProgress({ label, percent, onCancel, announce = true }) {
    const shown = Math.round(percent);
    return (
        <div className="space-y-ds-2 rounded-ds-md border border-ds-status-info-border bg-ds-status-info-bg p-ds-4">
            <p className="flex justify-between text-ds-xs font-semibold text-ds-status-info-fg" role={announce ? 'status' : undefined}>
                <span>Uploading...</span>
                <span>{shown}%</span>
            </p>
            <ProgressBar
                value={percent}
                max={100}
                label={`${label} upload progress`}
                valueText={`${shown}% uploaded`}
            />
            <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={onCancel}>
                    Cancel upload<span className="ds-visually-hidden"> of {label}</span>
                </Button>
            </div>
        </div>
    );
}

export default UploadProgress;
