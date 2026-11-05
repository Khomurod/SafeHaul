import { ATS_STATUS_NEW, LEAD_DEFAULT_STATUS } from '@shared/constants/atsStatus';
import { applicationStatusLabel } from '@shared/utils/applicationStatus';

/**
 * The dossier's one name for a stored status, in the sidebar and the status
 * picker alike: its stage's, so `New Application` and a lead's `New Lead` read
 * New, `Approved` Hired and `Rejected` Declined. Display only; the stored value
 * never changes.
 */
export function dossierStatusLabel(status) {
    return applicationStatusLabel(status === LEAD_DEFAULT_STATUS ? ATS_STATUS_NEW : status);
}
