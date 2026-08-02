/** Fixed tenant id for ATS sandbox / testing applications (public apply mirror). */
export const SANDBOX_COMPANY_ID = 'SANDBOX';

/** Draft key segment + sourceSlug when no Firestore public_profiles/SANDBOX doc exists */
export const SANDBOX_APP_SLUG = 'sandbox';

/** Fallback public profile when `public_profiles/SANDBOX` is missing */
export function buildDefaultSandboxPublicProfile() {
  return {
    id: SANDBOX_COMPANY_ID,
    companyName: 'SafeHaul Sandbox (Testing)',
    appSlug: SANDBOX_APP_SLUG,
    customQuestions: [],
    applicationConfig: {
      cdlUpload: { hidden: false, required: true },
      medCardUpload: { hidden: false, required: true },
      showEmergencyContacts: false,
    },
    postApplicationTemplates: [],
  };
}
