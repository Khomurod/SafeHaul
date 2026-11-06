import React, { useId, useState } from 'react';
import { Button, ButtonLink, Card, StatusMedallion } from '@/design-system/components';
import { Icon, AlertCircle, ArrowRight, CheckCircle, Info } from '@design-system/icons';
import { DriverDossier } from './modals/driver-dossier/DriverDossier';
import { forgetDashboardAttention, useDashboardAttention } from '../hooks/useDashboardAttention';
import { useInAppLink } from '../hooks/useInAppLink';
import { attentionItems, localDay } from '../utils/dashboardAttention';

/**
 * "Needs attention" on the dashboard, for admins and the team alike: the
 * company's records waiting on someone, counted by the server
 * (`useDashboardAttention`), each row with a link to the page that shows them
 * where one exists (`dashboardAttention.js` says what each row says).
 *
 * Rows with nothing to show are hidden; with nothing at all it is one calm
 * line. A count that failed says "could not be checked" for its row; a read that
 * failed is one line with Try again. It never stops the rest of the dashboard.
 * The hired drivers in the DQ row open their file over the dashboard.
 */

function DriverList({ item, onOpen }) {
    return (
        <ul className="mt-ds-2 flex flex-col gap-ds-1 text-ds-sm">
            {item.drivers.map((driver) => (
                <li key={driver.id} className="flex flex-wrap items-baseline gap-x-ds-2">
                    <Button variant="link" size="sm" onClick={() => onOpen(driver.id)}>{driver.name}</Button>
                    <span className="text-ds-content-secondary">{driver.when}</span>
                </li>
            ))}
            {item.others && <li className="text-ds-content-secondary">{item.others}</li>}
        </ul>
    );
}

function AttentionItem({ item, follow, onOpenDriver }) {
    const todo = item.state === 'todo';
    return (
        <li className="flex flex-col gap-ds-3 px-ds-4 py-ds-4 md:flex-row md:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-ds-3">
                <StatusMedallion tone={todo ? 'warning' : 'neutral'}>
                    <Icon icon={todo ? AlertCircle : Info} />
                </StatusMedallion>
                <div className="min-w-0">
                    <h3 className="font-semibold text-ds-content">
                        {item.title}
                        {!todo && <span className="ds-visually-hidden"> (not checked)</span>}
                    </h3>
                    <p className="text-ds-sm text-ds-content-secondary">{item.text}</p>
                    {item.drivers?.length > 0 && <DriverList item={item} onOpen={onOpenDriver} />}
                </div>
            </div>
            {item.link && (
                <ButtonLink href={item.link.href} variant="secondary" size="sm" className="self-start md:self-center" onClick={follow(item.link)}>
                    {item.link.label} <Icon icon={ArrowRight} />
                </ButtonLink>
            )}
        </li>
    );
}

function summaryOf(items) {
    const todo = items.filter((item) => item.state === 'todo').length;
    const unchecked = items.length > todo;
    if (todo === 0) return 'Some things could not be checked just now.';
    return `${todo} ${todo === 1 ? 'thing' : 'things'} to look at.${unchecked ? ' Some could not be checked just now.' : ''}`;
}

const LINE = 'flex flex-wrap items-center gap-x-ds-2 gap-y-ds-1 text-ds-sm text-ds-content-secondary';

export function NeedsAttentionCard({ companyId }) {
    const { isLoading, attention, failed, retry } = useDashboardAttention({ companyId });
    const follow = useInAppLink();
    const [openDriverId, setOpenDriverId] = useState(null);
    const headingId = `needs-attention-${useId().replace(/:/g, '')}`;

    if (!companyId) return null;
    if (failed) {
        return (
            <p className={LINE}>
                <Icon icon={Info} size="sm" />
                <span>What needs attention could not be checked just now.</span>
                <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>
            </p>
        );
    }
    if (isLoading || !attention) {
        return <p role="status" className="text-ds-sm text-ds-content-secondary">Checking what needs attention…</p>;
    }

    const items = attentionItems(attention, { today: localDay() });
    if (items.length === 0) {
        return (
            <p className={LINE}>
                <Icon icon={CheckCircle} size="sm" className="text-ds-status-success-fg" />
                <span>Nothing needs attention right now.</span>
            </p>
        );
    }

    return (
        <>
            <Card padding="none" className="overflow-hidden">
                <section aria-labelledby={headingId}>
                    <div className="border-b border-ds-border-subtle px-ds-4 py-ds-4">
                        <h2 id={headingId} className="text-ds-heading-md font-bold text-ds-content">Needs attention</h2>
                        <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">{summaryOf(items)}</p>
                    </div>
                    <ul className="divide-y divide-ds-border-subtle">
                        {items.map((item) => (
                            <AttentionItem key={item.id} item={item} follow={follow} onOpenDriver={setOpenDriverId} />
                        ))}
                    </ul>
                </section>
            </Card>
            {openDriverId && (
                <DriverDossier
                    key={openDriverId}
                    companyId={companyId}
                    driverId={openDriverId}
                    isOpen
                    onClose={() => setOpenDriverId(null)}
                    onDeleted={() => {
                        // The deleted driver leaves the counts: read them anew, not the kept answer.
                        setOpenDriverId(null);
                        forgetDashboardAttention();
                        retry();
                    }}
                />
            )}
        </>
    );
}

export default NeedsAttentionCard;
