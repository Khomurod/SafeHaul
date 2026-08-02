import React, { useEffect, useRef } from 'react';
import { Checkbox } from '@/design-system/components';
import { useUtils } from '../../hooks/useUtils';

/**
 * Legal agreement block: frozen disclosure copy plus its acknowledgement
 * checkbox.
 *
 * Presentation is migrated to the approved `Checkbox` primitive and `--ds-*`
 * tokens. Nothing legal changes: the `contentId` legend text, the children
 * (disclosure body), the `checkboxLabel` / `checkboxDescription` strings, the
 * `'agreed'` / `''` stored values, the `checkboxName` element id, the `required`
 * attribute, and the `initializeFormBranding(companyData)` call all behave
 * exactly as before.
 *
 * The `<legend>` is kept (rather than a heading) because it names the fieldset
 * that contains the acknowledgement control, which is what screen readers
 * announce before the checkbox.
 */
const AgreementBox = ({ contentId, companyData, children, showCheckbox = true, checkboxName, checkboxLabel, checkboxDescription, required = false, formData, updateFormData }) => {
    const { initializeFormBranding } = useUtils();
    const contentRef = useRef(null);

    useEffect(() => {
        if (companyData && contentRef.current) {
            initializeFormBranding(companyData);
        }
    }, [companyData, initializeFormBranding, children]);

    const handleChange = (e) => {
        updateFormData(checkboxName, e.target.checked ? 'agreed' : '');
    };

    return (
        <fieldset className="space-y-ds-4 rounded-ds-lg border border-ds-border bg-ds-surface p-ds-4">
            <legend className="px-ds-2 text-ds-body-lg font-semibold text-ds-content">{contentId}</legend>
            {/* Focusable scroll region: a disclosure taller than the box must be
                readable with the keyboard alone. Named "<title> full text" — not
                just the title — so it does not collide with the fieldset's own
                accessible name. */}
            <div
                className="agreement-box"
                tabIndex={0}
                role="group"
                aria-label={`${contentId} full text`}
            >
                <div ref={contentRef} className="legal-prose max-w-none">
                    {children}
                </div>
            </div>
            {showCheckbox && (
                <div className="rounded-ds-md bg-ds-surface-subtle p-ds-4">
                    <Checkbox
                        id={checkboxName}
                        name={checkboxName}
                        label={checkboxLabel}
                        description={checkboxDescription}
                        required={required}
                        checked={formData[checkboxName] === 'agreed'}
                        onChange={handleChange}
                    />
                </div>
            )}
        </fieldset>
    );
};

export default AgreementBox;
