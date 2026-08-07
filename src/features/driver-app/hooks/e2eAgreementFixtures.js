/**
 * The agreement set `useApplicationAgreements` serves when
 * `VITE_E2E_TEST_MODE=1`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The consent step deliberately loads its wording from the server, and just as
 * deliberately blocks submission when that load fails — an applicant must never
 * certify against agreements that did not render. In E2E runs the Firebase
 * project is unreachable by design (placeholder credentials), so the callable
 * always fails, so every guest-submission spec stopped at a permanently disabled
 * Submit button. The behaviour under test was fine; the environment simply has
 * no server.
 *
 * The same problem was already solved this way for the company dashboard
 * (`e2eDashboardFixtures.js`): serve a local fixture through the SAME code path,
 * gated strictly on E2E mode.
 *
 * The bodies below are short stand-ins, NOT the real legal text, and they say so
 * in their own wording. That is the safe direction to be wrong in: a fixture
 * that quietly duplicated the registry's text could drift from it, and drifted
 * agreement text is precisely the failure the server-side registry exists to
 * prevent. Nothing here is ever preserved — an E2E submission never reaches the
 * snapshot writer.
 */

export const E2E_AGREEMENT_VERSION = 'e2e-fixture';

const fixture = (id, title, requiresSignature) => ({
    id,
    version: E2E_AGREEMENT_VERSION,
    title,
    body: `TEST FIXTURE — NOT LEGAL TEXT.\n\nThis stands in for the "${title}" disclosure while the application is exercised end to end against an unreachable backend. The real wording is resolved from the server-side agreement registry and is what a real applicant reads and accepts.`,
    requiresSignature,
});

export const E2E_AGREEMENTS = [
    fixture('electronicSignature', 'Agreement to Conduct Transaction Electronically', true),
    fixture('fcraDisclosure', 'Background Check Disclosure and Authorization', true),
    fixture('pspDisclosure', 'FMCSA PSP Disclosure and Authorization', true),
    fixture('clearinghouseConsent', 'FMCSA Clearinghouse Full Query Consent', true),
];

export default E2E_AGREEMENTS;
