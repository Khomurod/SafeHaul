import React from 'react';
import { SmsSettingsPage } from './sms/SmsSettingsPage';

/**
 * Settings → Text messages (SMS) for a company admin: the company's own lines,
 * who texts from which, and the default (`sms/SmsSettingsPage.jsx`). Secrets are
 * entered once in `AddLineModal`, encrypted server-side by `addPhoneLine`, and
 * never read back. Super Admin keeps its own wallet, `LineManager`.
 */
export function SmsSettingsTab({ currentCompanyProfile }) {
    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName || currentCompanyProfile?.name;

    if (!companyId) {
        return <div className="p-ds-8 text-center text-ds-sm text-ds-content-muted">Select a company to configure SMS.</div>;
    }

    return <SmsSettingsPage companyId={companyId} companyName={companyName} />;
}
