import React from 'react';
import {
    Badge,
    FieldDisplay,
    FieldMessage,
    FormSection,
} from '@/design-system/components';

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
        <div className="max-w-4xl animate-in fade-in" data-testid="billing-settings">
            <FormSection title="Billing & Plan" description="Manage your subscription.">
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
