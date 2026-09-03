import React from 'react';
import { Badge, FieldDisplay } from '@/design-system/components';

/**
 * An employer whose identity the carrier fixed, shown as a record rather than a field.
 *
 * A carrier that started this application from the driver's PSP report knows who
 * the driver drove for — the report names the carrier and its USDOT number beside
 * an inspection date. What it does not know is when they started, when they left,
 * or why. So the identifying half of the row is presented as what it is, a fact
 * already on file, and every other field on the same row stays the driver's to fill
 * in.
 *
 * Deliberately not a disabled input. A disabled `<input>` reads as "this field is
 * broken" and is skipped by the tab order, taking its label with it; a read-only
 * display with a badge says what is true. The enforcement is elsewhere anyway —
 * `applicationLockedFields.js`, checked at submission against the carrier's own
 * record — so this is here to explain, not to prevent.
 */
export function LockedEmployerIdentity({ companyName, dotNumber }) {
    return (
        <div className="space-y-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3">
            <div className="flex flex-wrap items-center justify-between gap-ds-2">
                <FieldDisplay label="Company Name" emphasis="strong">
                    {companyName || `USDOT ${dotNumber}`}
                </FieldDisplay>
                <Badge tone="info">Added by your carrier</Badge>
            </div>
            {dotNumber && <FieldDisplay label="USDOT Number">{dotNumber}</FieldDisplay>}
            <p className="text-ds-xs text-ds-content-muted">
                This carrier is on the safety record your employer used to start your application, so its
                name and USDOT number are fixed. Add the dates you worked there and why you left.
            </p>
        </div>
    );
}

export default LockedEmployerIdentity;
