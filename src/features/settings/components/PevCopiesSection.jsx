import React, { useEffect, useRef, useState } from 'react';
import { saveCompanySettings } from '@features/companies';
import { Icon, Save } from '@design-system/icons';
import { useToast } from '@shared/components/feedback';
import { Button, FormField, FormSection, Input } from '@/design-system/components';
import { MAX_PEV_COPIES, formatPevCopies, parsePevCopies } from '@features/company-admin/utils/pevCopies';
import { usePevDefaultCopies } from '@features/company-admin/hooks/usePevDefaultCopies';

/**
 * The people every previous employment verification request copies (CC) by
 * default: `companies/{id}.pevCcEmails`. The send dialog starts from this list
 * and the recruiter may change it for one request.
 *
 * The list is read from the company document when the section opens: the
 * signed-in profile is loaded once per session, so a list saved since would
 * otherwise show as empty. Once the admin has typed or saved, the read never
 * replaces the field.
 */
export function PevCopiesSection({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const { copies } = usePevDefaultCopies(currentCompanyProfile?.id, currentCompanyProfile?.pevCcEmails);
    const [text, setText] = useState(() => formatPevCopies(copies));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const typed = useRef(false);

    useEffect(() => {
        if (!typed.current) setText(formatPevCopies(copies));
    }, [copies]);

    const handleSave = async () => {
        const { emails, error: parseError } = parsePevCopies(text);
        if (parseError) {
            setError(parseError);
            return;
        }
        setSaving(true);
        try {
            await saveCompanySettings(currentCompanyProfile.id, { pevCcEmails: emails });
            // The field now holds what is saved; a read still on its way is older.
            setText(formatPevCopies(emails));
            showSuccess(emails.length > 0 ? 'Verification copies saved.' : 'Verification requests will copy no one by default.');
        } catch (saveError) {
            showError(`Could not save the verification copies: ${saveError.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <FormSection
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
                    onChange={(e) => {
                        typed.current = true;
                        setText(e.target.value);
                        if (error) setError('');
                    }}
                    placeholder="safety@yourcompany.com, compliance@yourcompany.com"
                    autoComplete="off"
                />
            </FormField>
            <div className="flex justify-end">
                <Button variant="secondary" loading={saving} onClick={handleSave}>
                    {!saving && <Icon icon={Save} size="lg" />}
                    Save Copies
                </Button>
            </div>
        </FormSection>
    );
}

export default PevCopiesSection;
