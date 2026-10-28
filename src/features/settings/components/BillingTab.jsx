import React from 'react';
import {
    Badge,
    FieldDisplay,
    FieldMessage,
    FormSection,
} from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';

/**
 * Company Settings Billing tab.
 *
 * Presentation-only: it maps the company's plan type to a plan name and status
 * tone, and displays static support guidance. Plan calculation, plan names,
 * and the informational-only behaviour are preserved exactly from the previous
 * inline implementation. The design-system primitives stay business-neutral.
 */
export function BillingTab({ currentCompanyProfile }) {
    const isPaidPlan = currentCompanyProfile?.planType === 'paid';
    const planName = isPaidPlan ? 'Pro Plan' : 'Free Plan';

    return (
        <div className="space-y-ds-6" data-testid="billing-settings">
            <PageHeader title="Plan" description="Manage your subscription." />
            <FormSection title="Subscription">
                <FieldDisplay label="Current Plan">
                    <Badge tone={isPaidPlan ? 'success' : 'neutral'}>{planName}</Badge>
                </FieldDisplay>
                <FieldMessage tone="help">
                    To upgrade or cancel, please contact support.
                </FieldMessage>
            </FormSection>
        </div>
    );
}
