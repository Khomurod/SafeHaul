import React from 'react';
import { Check, Wifi, WifiOff, Activity } from 'lucide-react';
import { Badge, Card, IconButton, Select } from '@/design-system/components';
import { MISSING_TOKEN, lineDisplay } from '../../utils/linePhone';

/**
 * Company Default Line card.
 *
 * Presentation only — the token/select value derivation, the
 * `setDefaultNumber`/`setDefaultTokenOverride` wiring, and `handleVerifyLine`
 * are unchanged from `NumberAssignmentManager.jsx`, where this card was
 * originally inlined.
 *
 * Defects fixed here:
 *  - the `<select>` had no accessible name (now `aria-label`);
 *  - the verify button was icon-only with a `title` but no `aria-label`, so its
 *    accessible name depended on the title-fallback step of the accessible-name
 *    algorithm rather than an explicit label (now an `IconButton`);
 *  - the verify result was a plain colored `<div>` with `text-[10px]` (below the
 *    12 px floor) and no live-region role (now a `role="status"`/`role="alert"`
 *    `Badge` row at `text-ds-xs`).
 */
export function DefaultLineSection({
    lines,
    sanitizedDefault,
    defaultInInventory,
    defaultNumber,
    setDefaultNumber,
    defaultTokenOverride,
    setDefaultTokenOverride,
    savedDefaultToken,
    tokenForPhone,
    phoneForToken,
    resolveLineToken,
    handleVerifyLine,
    verifyingLine,
    lineStatuses,
}) {
    const status = lineStatuses[defaultNumber];
    const isVerifying = verifyingLine === defaultNumber;

    return (
        <Card padding="md">
            <div className="mb-ds-4 flex items-start justify-between">
                <div>
                    <h3 className="flex items-center gap-ds-2 font-bold text-ds-content">
                        <Check className="text-ds-status-success-fg" size={18} aria-hidden="true" /> Company Default Line
                    </h3>
                    <p className="mt-ds-1 text-ds-xs text-ds-content-muted">
                        Used for automated system messages and unassigned recruiters.
                    </p>
                </div>
            </div>
            <div className="flex max-w-lg gap-ds-3">
                <Select
                    aria-label="Company default line"
                    value={defaultTokenOverride ?? (tokenForPhone(sanitizedDefault) || resolveLineToken(savedDefaultToken) || (sanitizedDefault ? MISSING_TOKEN : ''))}
                    onChange={(e) => {
                        const t = e.target.value;
                        setDefaultTokenOverride(t);
                        if (!t) setDefaultNumber('');
                        else if (t !== MISSING_TOKEN) setDefaultNumber(phoneForToken(t));
                        // MISSING_TOKEN: keep the configured-but-unsynced default as-is
                    }}
                    className="flex-1"
                >
                    <option value="">-- Select Default Number --</option>
                    {lines.map((l, idx) => (
                        <option key={l.token} value={l.token}>
                            {lineDisplay(l.label, l.phone, idx, `· ${l.usageType || 'Line'}`)}
                        </option>
                    ))}
                    {/* Resilience: configured default that isn't in the synced inventory */}
                    {sanitizedDefault && !defaultInInventory && (
                        <option value={MISSING_TOKEN}>
                            {sanitizedDefault} (Missing from sync)
                        </option>
                    )}
                </Select>
                {defaultNumber && (
                    <IconButton
                        label="Verify default line connection"
                        variant="secondary"
                        onClick={() => handleVerifyLine(defaultNumber)}
                        disabled={isVerifying}
                        loading={isVerifying}
                    >
                        {!isVerifying && (
                            status?.success ? <Wifi size={16} className="text-ds-status-success-fg" />
                                : status?.success === false ? <WifiOff size={16} className="text-ds-status-danger-fg" />
                                    : <Activity size={16} />
                        )}
                    </IconButton>
                )}
            </div>
            {status && (
                <div className="mt-ds-3" role={status.success ? 'status' : 'alert'}>
                    <Badge tone={status.success ? 'success' : 'danger'}>
                        {status.success ? `Verified: ${status.identity}` : `Error: ${status.error}`}
                    </Badge>
                </div>
            )}
        </Card>
    );
}

export default DefaultLineSection;
