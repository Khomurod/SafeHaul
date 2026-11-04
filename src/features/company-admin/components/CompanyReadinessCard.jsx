import React, { useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { ButtonLink, Card, Link, StatusMedallion } from '@/design-system/components';
import { Icon, AlertCircle, ArrowRight, CheckCircle, Info } from '@design-system/icons';
import { useCompanyReadiness } from '../hooks/useCompanyReadiness';

/**
 * "Company setup" on the dashboard, for a company admin only: the settings the
 * company has not set up (`companyReadiness.js`), each with a link to the page
 * that fixes it, read once when the dashboard opens (`useCompanyReadiness`).
 *
 * When everything is set up it is one calm line, so the dashboard stays quiet
 * and the admin still sees the check ran; the optional PEV copies are a link in
 * that line, never a thing to set up. A read that failed is "not checked". For
 * anyone else it renders nothing and reads nothing.
 */

/** A link inside the app: a plain press stays in the page, any other opens as the browser would. */
function useInAppLink() {
    const navigate = useNavigate();
    return (href) => (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(href);
    };
}

function HintLink({ hint, follow }) {
    return (
        <Link href={hint.href} onClick={follow(hint.href)}>
            {hint.linkLabel}<span className="ds-visually-hidden"> (optional)</span>
        </Link>
    );
}

function ReadinessItem({ item, follow }) {
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
                        <span className="ds-visually-hidden">{todo ? ' (to set up)' : ' (not checked)'}</span>
                    </h3>
                    <p className="text-ds-sm text-ds-content-secondary">{item.text}</p>
                </div>
            </div>
            <ButtonLink href={item.href} variant="secondary" size="sm" className="self-start md:self-center" onClick={follow(item.href)}>
                {item.linkLabel} <Icon icon={ArrowRight} />
            </ButtonLink>
        </li>
    );
}

export function CompanyReadinessCard({ companyId }) {
    const { currentUserClaims } = useData();
    const isAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);
    const { isLoading, readiness } = useCompanyReadiness({ companyId, enabled: isAdmin });
    const follow = useInAppLink();
    const headingId = `company-setup-${useId().replace(/:/g, '')}`;

    if (!isAdmin) return null;
    if (isLoading || !readiness) {
        return <p role="status" className="text-ds-sm text-ds-content-secondary">Checking company setup…</p>;
    }

    const { items, hints } = readiness;
    if (items.length === 0) {
        return (
            <p className="flex flex-wrap items-center gap-x-ds-2 gap-y-ds-1 text-ds-sm text-ds-content-secondary">
                <Icon icon={CheckCircle} size="sm" className="text-ds-status-success-fg" />
                <span>Company setup is complete.</span>
                {hints.map((hint) => <HintLink key={hint.id} hint={hint} follow={follow} />)}
            </p>
        );
    }

    const todo = items.filter((item) => item.state === 'todo').length;
    return (
        <Card padding="none" className="overflow-hidden">
            <section aria-labelledby={headingId}>
                <div className="border-b border-ds-border-subtle px-ds-4 py-ds-4">
                    <h2 id={headingId} className="text-ds-heading-md font-bold text-ds-content">Company setup</h2>
                    <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">
                        {todo > 0
                            ? `${todo} ${todo === 1 ? 'thing' : 'things'} to set up. Each link opens the page that fixes it.`
                            : 'Some settings could not be checked just now.'}
                    </p>
                </div>
                <ul className="divide-y divide-ds-border-subtle">
                    {items.map((item) => <ReadinessItem key={item.id} item={item} follow={follow} />)}
                </ul>
                {hints.length > 0 && (
                    <div className="border-t border-ds-border-subtle px-ds-4 py-ds-3 text-ds-sm text-ds-content-secondary">
                        {hints.map((hint) => (
                            <p key={hint.id}>{hint.text} <HintLink hint={hint} follow={follow} /></p>
                        ))}
                    </div>
                )}
            </section>
        </Card>
    );
}

export default CompanyReadinessCard;
