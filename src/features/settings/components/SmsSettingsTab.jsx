import React from 'react';
import { LineManager } from '@/features/super-admin/components/integrations/LineManager';
import { NumberAssignmentManager } from './NumberAssignmentManager';

/**
 * Company-admin SMS configuration tab.
 *
 * Gives Company Admins the same self-service phone setup Super Admins have:
 *  - Phone Line Wallet (LineManager): add / remove provider lines, entering the
 *    RingCentral JWT + optional per-line client credentials. Those secrets are
 *    encrypted server-side by the `addPhoneLine` callable (which already authorizes
 *    company admins) and are never echoed back to the browser.
 *  - Number Assignments (NumberAssignmentManager): pick the default company line and
 *    assign 1:1 lines to recruiters.
 *
 * No plaintext credential handling on the client — the admin enters a secret once and
 * it is encrypted on save; reads only ever return the masked/non-secret fields.
 */
export function SmsSettingsTab({ currentCompanyProfile }) {
    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName || currentCompanyProfile?.name;

    if (!companyId) {
        return <div className="p-ds-8 text-center text-ds-sm text-ds-content-muted">Select a company to configure SMS.</div>;
    }

    return (
        <div className="space-y-8 max-w-5xl animate-in fade-in">
            <LineManager companyId={companyId} companyName={companyName} />
            <NumberAssignmentManager companyId={companyId} />
        </div>
    );
}
