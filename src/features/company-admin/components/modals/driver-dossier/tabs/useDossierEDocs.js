import { useData } from '@/context/DataContext';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { canOfferCompanyRoute, companyRoute } from '@app/routes/companyRouteAccess';

/**
 * The company whose E-Docs the dossier's Documents to sign may use, or null.
 *
 * What E-Docs itself is offered by (`canOfferCompanyRoute` on its route: the
 * company's `eDocs` feature, off only when `false`), and only for the company
 * the person works in, which E-Docs serves: a dossier opened for another
 * company (a super admin's) offers none, so nothing is sent or changed under
 * the wrong one.
 */
export function useDossierEDocs(companyId) {
    const { currentCompanyProfile, currentUserClaims } = useData();
    if (!companyId || currentCompanyProfile?.id !== companyId) return null;
    const allowed = canOfferCompanyRoute(companyRoute('eDocs'), {
        isCompanyAdmin: isCompanyAdminForRoute(currentUserClaims, companyId),
        features: currentCompanyProfile.features,
    });
    return allowed ? currentCompanyProfile : null;
}

export default useDossierEDocs;
