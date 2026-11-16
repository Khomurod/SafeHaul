import React, { useId } from 'react';
import { Icon, AlertCircle, AlertTriangle, CheckCircle, Circle, Clock, Info, MinusCircle } from '@design-system/icons';
import { Badge, Button, Card } from '@/design-system/components';
import { buildDqChecklist } from '../../utils/dqChecklist';
import { describeExpiry } from '../../utils/dqExpiry';

/**
 * The DQ tab's "What's in the file": each item of the record's DQ file and
 * whether the file holds it, above the list of files. The mapping is
 * `dqChecklist.js`; this owns the words and the item → Badge mapping.
 *
 * It says what is in the file and what is not, never that a file is complete
 * or compliant. Optional items are shown and never counted. Dates are UTC days.
 *
 * An item the file lacks, or holds expired, has Upload (`onUpload(type)`: the
 * tab's form with the item's type chosen); the employers have Open Previous
 * Employment (`onOpenPev`), where they are verified.
 */

/** Feature-owned item state → Badge. Each badge pairs its tone with an icon and words. */
function presentationOf(item) {
    if (item.state === 'expired') return { tone: 'danger', icon: AlertCircle, label: 'Expired' };
    if (item.state === 'none') return { tone: 'neutral', icon: MinusCircle, label: 'None listed' };
    // Employers are verified, not filed: the badge says how far that went.
    if (item.employers) {
        return item.state === 'present'
            ? { tone: 'success', icon: CheckCircle, label: 'All done' }
            : { tone: 'warning', icon: AlertTriangle, label: 'Not all done' };
    }
    if (item.state === 'missing') {
        return item.optional
            ? { tone: 'neutral', icon: Circle, label: 'Not in file' }
            : { tone: 'warning', icon: AlertTriangle, label: 'Missing' };
    }
    if (item.expiry?.state === 'expiring') return { tone: 'warning', icon: Clock, label: 'Expiring soon' };
    return { tone: 'success', icon: CheckCircle, label: 'In file' };
}

const EMPLOYER_STATES = Object.freeze({
    answered: 'answered',
    no_response: 'no answer after the attempts, marked at day 30',
    waiting: 'request sent, no answer yet',
    not_requested: 'not requested',
});

/** The lines under an item's name. */
function detailsOf(item) {
    if (item.employers) {
        const lines = item.employers.length === 0
            ? ['No employers listed for the last three years.']
            : [];
        if (item.handInquiries > 0) {
            lines.push(`${item.handInquiries} ${item.handInquiries === 1 ? 'inquiry' : 'inquiries'} uploaded by hand, not matched to an employer.`);
        }
        return lines;
    }
    if (item.state === 'missing' || !item.dated) return [];
    return [item.expiry ? describeExpiry(item.expiry) : 'No valid-until date recorded.'];
}

function summaryOf({ missing, expired }) {
    if (missing === 0 && expired === 0) return 'Nothing on this list is missing or expired.';
    return [missing > 0 && `${missing} missing`, expired > 0 && `${expired} expired`].filter(Boolean).join(', ') + '.';
}

/** The item's way to what fills it, or null. */
function actionOf(item, { onUpload, onOpenPev, disabled }) {
    if (item.employers) {
        return onOpenPev
            ? <Button variant="link" size="sm" onClick={onOpenPev}>Open Previous Employment</Button>
            : null;
    }
    if (!onUpload || !item.uploadType || (item.state !== 'missing' && item.state !== 'expired')) return null;
    return (
        <Button variant="link" size="sm" aria-label={`Upload ${item.label}`} disabled={disabled} onClick={() => onUpload(item.uploadType)}>
            Upload
        </Button>
    );
}

function ChecklistItem({ item, actions }) {
    const presentation = presentationOf(item);
    const action = actionOf(item, actions);
    return (
        <li className="flex flex-col gap-ds-1 px-ds-4 py-ds-3 sm:flex-row sm:items-start sm:justify-between sm:gap-ds-4">
            <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-ds-2 text-ds-sm font-medium text-ds-content">
                    <span>{item.label}</span>
                    {item.optional && <span className="text-ds-xs font-normal text-ds-content-secondary">Optional</span>}
                </p>
                {detailsOf(item).map((line) => (
                    <p key={line} className="text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">{line}</p>
                ))}
                {item.employers?.length > 0 && (
                    <ul className="mt-ds-1 space-y-ds-1">
                        {item.employers.map((employer) => (
                            <li key={employer.key} className="text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                                {`${employer.name}: ${EMPLOYER_STATES[employer.state]}`}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-ds-1 sm:items-end">
                <Badge tone={presentation.tone} icon={presentation.icon}>{presentation.label}</Badge>
                {action}
            </div>
        </li>
    );
}

export function DQChecklist({ files, record, onUpload = null, onOpenPev = null, disabled = false }) {
    const headingId = `dq-checklist-${useId().replace(/:/g, '')}`;
    const checklist = buildDqChecklist({ files, record });
    const actions = { onUpload, onOpenPev, disabled };

    return (
        <Card padding="none" className="overflow-hidden">
            <section aria-labelledby={headingId}>
                <div className="border-b border-ds-border-subtle px-ds-4 py-ds-3">
                    <h3 id={headingId} className="text-ds-heading-sm font-bold text-ds-content">What&apos;s in the file</h3>
                    <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">{summaryOf(checklist)}</p>
                </div>
                <ul className="divide-y divide-ds-border-subtle">
                    {checklist.items.map((item) => <ChecklistItem key={item.id} item={item} actions={actions} />)}
                </ul>
                <p className="flex items-start gap-ds-2 border-t border-ds-border-subtle px-ds-4 py-ds-3 text-ds-xs text-ds-content-secondary">
                    <Icon icon={Info} size="sm" className="mt-px shrink-0" />
                    <span>
                        What this file holds, item by item. It is not a compliance check. Optional items are never
                        counted, and dates are read as UTC days.
                    </span>
                </p>
            </section>
        </Card>
    );
}

export default DQChecklist;
