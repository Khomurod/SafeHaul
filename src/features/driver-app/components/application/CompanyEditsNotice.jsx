import React from 'react';
import { Button, Notice } from '@/design-system/components';
import { companyEditSections } from './companyEditsSync';

/**
 * Tells the driver their carrier changed some of their answers.
 *
 * Shown above every step from the moment the page takes the edits until the
 * driver dismisses it or submits, so it is in front of them on the Review page
 * before they sign. Which answers, and when the page takes them, is
 * `companyEditsSync.js`; the list lives with the answers, so a reload keeps it.
 */
export function CompanyEditsNotice({ fields, onDismiss }) {
    if (!Array.isArray(fields) || fields.length === 0) return null;
    const sections = companyEditSections(fields);
    return (
        <Notice
            tone="info"
            title="Your carrier updated your application"
            announce="polite"
            className="mb-ds-6"
            actions={<Button variant="secondary" size="sm" onClick={onDismiss}>Got it</Button>}
        >
            {sections.length > 0
                ? `They changed: ${sections.join(', ')}. Check these answers before you sign.`
                : 'Check your answers before you sign.'}
        </Notice>
    );
}

export default CompanyEditsNotice;
