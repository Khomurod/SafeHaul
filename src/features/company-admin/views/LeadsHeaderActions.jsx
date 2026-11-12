import React from 'react';
import { useHref, useLinkClickHandler } from 'react-router-dom';
import { ButtonLink } from '@/design-system/components';
import { Icon, Plus, Upload } from '@design-system/icons';
import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { canOfferCompanyRoute, companyRoute, companyRoutePath } from '@app/routes/companyRouteAccess';

/**
 * The Leads page's own actions, in its header: Add lead and Import leads. They
 * replaced two menu items, and their pages keep their own addresses.
 *
 * Each is offered only when its page would open for the person
 * (`canOfferCompanyRoute`, the check the sidebar makes): Add lead to every staff
 * member, Import leads to a company admin of a company whose `importLeads`
 * feature is on.
 *
 * Both lead to another page, so they are links (`ButtonLink`): announced as
 * links, open in a new tab on a modified click, and an ordinary click moves
 * within the app, as a menu link does. The primary one comes last, at the
 * header's right edge; `PageHeader` lays them out (on a phone, an equal share
 * of one row each), so they are handed over as they are, with no wrapper.
 */
const ACTIONS = [
    { route: companyRoute('importLeads'), label: 'Import leads', icon: Upload, variant: 'secondary' },
    { route: companyRoute('quickAddLead'), label: 'Add lead', icon: Plus, variant: 'primary' },
];

function PageButtonLink({ to, variant, icon, children }) {
    const href = useHref(to);
    const handleClick = useLinkClickHandler(to);
    return (
        <ButtonLink href={href} onClick={handleClick} variant={variant}>
            <Icon icon={icon} />
            {children}
        </ButtonLink>
    );
}

export function LeadsHeaderActions() {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const access = {
        isCompanyAdmin: isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id),
        features: currentCompanyProfile?.features,
    };
    const offered = ACTIONS.filter(({ route }) => canOfferCompanyRoute(route, access));

    return offered.map(({ route, label, icon, variant }) => (
        <PageButtonLink key={route.id} to={companyRoutePath(route)} variant={variant} icon={icon}>
            {label}
        </PageButtonLink>
    ));
}
