import React from 'react';
import { FormField, FormSection, Input } from '@/design-system/components';
import { MAX_PEV_COPIES } from '@features/company-admin/utils/pevCopies';

/**
 * The people every previous employment verification request copies (CC) by
 * default: `companies/{id}.pevCcEmails`. The send dialog starts from this list
 * and the recruiter may change it for one request.
 *
 * Settings → Email holds the list (`usePevCopiesDraft`) and saves it with the
 * page's one Save; this draws the field, its section explained beside it as
 * the page's other sections are.
 */
export function PevCopiesSection({ text, error, onChange }) {
    return (
        <FormSection
            layout="aside"
            title="Employment Verification Copies"
            description="People on your team who get a copy (CC) of every previous employment verification request. They receive the same email as the employer, including the response link."
        >
            <FormField
                id="pev-default-copies"
                label="CC addresses"
                description={`Up to ${MAX_PEV_COPIES}, separated by commas. A recruiter can change the list when sending.`}
                error={error || undefined}
            >
                <Input
                    type="text"
                    inputMode="email"
                    value={text}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="safety@yourcompany.com, compliance@yourcompany.com"
                    autoComplete="off"
                />
            </FormField>
        </FormSection>
    );
}

export default PevCopiesSection;
