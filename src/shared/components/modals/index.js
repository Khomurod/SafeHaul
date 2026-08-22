/*
 * Domain modals. The accessible `Modal` shell and `ConfirmDialog` moved to
 * `@design-system/patterns` — they are business-neutral primitives, and the
 * design system may not depend on `shared`, so they could only live here while
 * that move was outstanding. Import them from the design system; this barrel
 * deliberately does not re-export them, so there is one place to import each.
 */
export { CompanyChooserModal } from './CompanyChooserModal';
export { FeatureLockedModal } from './FeatureLockedModal';
export { CallOutcomeModal } from './CallOutcomeModal';
export { CallOutcomeModalUI } from './CallOutcomeModalUI';
export { ManageTeamModal } from './ManageTeamModal';
