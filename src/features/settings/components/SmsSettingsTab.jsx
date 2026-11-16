import React from 'react';
import { Stack } from '@/design-system/layouts';
import { SmsSettingsPage } from './sms/SmsSettingsPage';
import { SmsOptOutSection } from './sms/SmsOptOutSection';

/**
 * Settings → Text messages (SMS) for a company admin: the company's own lines,
 * who texts from which, and the default (`sms/SmsSettingsPage.jsx`). Secrets are
 * entered once in `AddLineModal`, encrypted server-side by `addPhoneLine`, and
 * never read back. Super Admin keeps its own wallet, `LineManager`.
 *
 * Below it, whatever the lines' state, the numbers that asked not to be texted
 * (`sms/SmsOptOutSection.jsx`): campaigns check them before an email too, and
 * the page's frozen contracts stay untouched beside it.
 */
export function SmsSettingsTab({ currentCompanyProfile, isCompanyAdmin = false }) {
    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName || currentCompanyProfile?.name;

    if (!companyId) {
        return <div className="p-ds-8 text-center text-ds-sm text-ds-content-muted">Select a company to configure SMS.</div>;
    }

    return (
        <Stack gap="lg">
            <SmsSettingsPage companyId={companyId} companyName={companyName} />
            <SmsOptOutSection companyId={companyId} canRemove={isCompanyAdmin} />
        </Stack>
    );
}
