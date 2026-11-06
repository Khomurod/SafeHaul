import React from 'react';
import { Button, Link, Skeleton } from '@/design-system/components';
import { Section } from '@/design-system/layouts';
import { Icon, Info } from '@design-system/icons';
import { useHiringBrief } from '@features/companies';
import { hiredLabel } from '@features/companies/hooks/dashboardPeriods';
import { useInAppLink } from '../hooks/useInAppLink';

/**
 * "This month" on the dashboard, one line: applications added this month,
 * applications in process, and applications hired this month (from the day hire
 * dates began: "hired since Nov 6"). Each number is a server count of the list
 * its link opens (`useHiringBrief`): All Applications on this month, the In
 * process tab, and this month's hires whatever their status now. The Hired card
 * above counts every hired driver, so the line does not repeat it.
 *
 * While the numbers load the line is a placeholder, and after a failure it says
 * so with Try again: never a 0 that was not counted.
 */
const APPLICATIONS = '/company/drivers/applications';
const LINE = 'flex flex-wrap items-center gap-x-ds-2 gap-y-ds-1 text-ds-sm text-ds-content-secondary';

function briefItems(brief, month) {
    return [
        {
            id: 'applications',
            count: brief.applications,
            words: brief.applications === 1 ? 'application' : 'applications',
            state: { period: { field: 'createdAt', month } },
        },
        { id: 'in-process', count: brief.inProcess, words: 'in process', state: { segment: 'in_process' } },
        { id: 'hired', count: brief.hired, words: hiredLabel(month), state: { period: { field: 'hiredAt', month } } },
    ];
}

function BriefLine({ brief, month }) {
    const follow = useInAppLink();
    return (
        // The spaces between the parts keep the sentence whole when read or copied; the gap spaces it on screen.
        <p className={LINE}>
            <span className="font-semibold text-ds-content">This month:</span>{' '}
            {briefItems(brief, month).map((item, index) => (
                <React.Fragment key={item.id}>
                    {index > 0 && <>{' '}<span aria-hidden="true">·</span>{' '}</>}
                    <Link
                        href={APPLICATIONS}
                        className="whitespace-nowrap"
                        onClick={follow({ href: APPLICATIONS, state: item.state })}
                    >
                        <span className="font-semibold tabular-nums">{item.count.toLocaleString('en-US')}</span>
                        {' '}{item.words}
                    </Link>
                </React.Fragment>
            ))}
        </p>
    );
}

export function HiringBrief({ companyId }) {
    const { brief, month, isLoading, error, refresh } = useHiringBrief(companyId);
    if (!companyId) return null;

    let line;
    if (error) {
        line = (
            <p className={LINE}>
                <Icon icon={Info} size="sm" />
                <span>This month’s numbers could not be loaded just now.</span>
                <Button variant="secondary" size="sm" onClick={refresh}>Try again</Button>
            </p>
        );
    } else if (isLoading || !brief) {
        line = <p className="text-ds-sm"><Skeleton width="half" /></p>;
    } else {
        line = <BriefLine brief={brief} month={month} />;
    }

    return (
        <Section aria-label="This month">
            {/* One polite sentence for the line, always present so it can fill. */}
            <p role="status" className="ds-visually-hidden">
                {error ? '' : (isLoading || !brief) ? 'Loading this month’s numbers.' : 'This month’s numbers loaded.'}
            </p>
            {line}
        </Section>
    );
}

export default HiringBrief;
