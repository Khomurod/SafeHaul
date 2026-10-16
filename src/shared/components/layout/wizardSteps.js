/**
 * The driver application wizard's pages, in order: each page's name and the
 * title its heading shows.
 *
 * The one list every reader of the order uses: the wizard frame
 * (`Stepper.jsx`) builds its pages and "Step N of M" titles from it, resuming
 * and the submission's routing turn a page's name into its index with it, and
 * the Unfinished applications list counts progress with it. It holds no
 * components, so the company workspace never loads the step screens.
 *
 * The company's own questions are a page only when the company asks any: after
 * General Questions, before the review.
 */
const WIZARD_STEPS = Object.freeze([
    Object.freeze({ id: 'contact', title: 'Personal Information' }),
    Object.freeze({ id: 'qualifications', title: 'Qualification Information' }),
    Object.freeze({ id: 'license', title: 'License Information' }),
    Object.freeze({ id: 'violations', title: 'Motor Vehicle Record' }),
    Object.freeze({ id: 'accidents', title: 'Accident History' }),
    Object.freeze({ id: 'employment', title: 'Employment History' }),
    Object.freeze({ id: 'general', title: 'General Questions' }),
    Object.freeze({ id: 'custom_questions', title: 'Additional Questions' }),
    Object.freeze({ id: 'review', title: 'Review Information' }),
    Object.freeze({ id: 'consent', title: 'Agreements & Signature' }),
]);

/** The pages of a company's wizard, in order. */
export function wizardStepsFor(hasCustomQuestions) {
    return WIZARD_STEPS.filter((step) => hasCustomQuestions || step.id !== 'custom_questions');
}

/** The names of those pages, in order. */
export function buildSemanticStepOrder(hasCustomQuestions) {
    return wizardStepsFor(hasCustomQuestions).map((step) => step.id);
}

/**
 * A page's index: an index already in range is itself, a name is its place in
 * the order, and anything else is the first page.
 */
export function resolveWizardStepIndex(semanticStep, hasCustomQuestions) {
    const order = buildSemanticStepOrder(hasCustomQuestions);
    if (typeof semanticStep === 'number' && semanticStep >= 0 && semanticStep < order.length) {
        return semanticStep;
    }
    const idx = order.indexOf(semanticStep);
    return idx >= 0 ? idx : 0;
}
