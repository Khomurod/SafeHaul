/**
 * The approved SafeHaul capability knowledge package.
 *
 * The automated blog writes about SafeHaul. Left to itself an AI model will
 * invent plausible features, so this file is the *only* thing it is allowed to
 * know about the product. Every entry was verified against source files and
 * the project's own audit reports, not against the marketing site — the
 * landing page currently makes several claims the code does not support, and
 * those are recorded in `PROHIBITED_CLAIMS` precisely so the blog cannot
 * repeat them.
 *
 * The rules that make this trustworthy:
 *  - only `available` features may be described as things SafeHaul does today;
 *  - `planned`, `partial` and `retired` entries exist so the generator can be
 *    told what *not* to say, never as material to write from;
 *  - every entry names the source files that prove it;
 *  - `KNOWLEDGE_VERSION` is stamped onto every published article, so a claim
 *    can always be traced back to the package that authorised it.
 *
 * Maintenance: `test/unit/blogKnowledge.test.js` fails if an entry loses its
 * evidence, if a prohibited claim also appears as an approved one, or if the
 * version is not bumped alongside a content change.
 */

/**
 * Bump on any meaningful change to the entries below. Published articles record
 * the version that authorised their claims.
 */
const KNOWLEDGE_VERSION = '2026-08-02.1';

/** The commit this package was last verified against. */
const LAST_VERIFIED_COMMIT = '17f33c978ff876498fdf1b2cfe664b20de0bc306';

const STATUS = Object.freeze({
    /** Working in production and safe to describe in the present tense. */
    AVAILABLE: 'available',
    /** Works, with a stated limitation that must accompany any mention. */
    PARTIAL: 'partial',
    /** On the roadmap. Must never be described as existing. */
    PLANNED: 'planned',
    /** Removed from the product. Must never be described at all. */
    RETIRED: 'retired',
});

const FEATURES = Object.freeze([
    {
        id: 'applicant-tracking',
        name: 'Driver applicant tracking',
        status: STATUS.AVAILABLE,
        description: 'A nine-step driver application covering contact details, qualifications, licence, violations, accidents, employment history, general information, review and consent, with a recruiter pipeline for moving candidates through hiring stages.',
        intendedUsers: ['recruiters', 'hiring managers', 'safety teams'],
        businessBenefit: 'Replaces paper and spreadsheet applications with one structured record per driver, so nothing needed for a hiring decision is scattered across email.',
        limitations: ['Pipeline stages are fixed rather than per-company configurable.'],
        sourceFiles: ['src/features/driver-app/', 'functions/guestApplication.js', 'src/config/applicationSchema.js'],
        documentation: ['README.md', 'docs/FULL_APPLICATION_AUDIT_REPORT.md'],
        approvedClaims: [
            'SafeHaul collects a complete driver application in one structured record.',
            'Applications can be submitted by an invited driver or through a public company link.',
            'An application in progress survives a lost connection and is submitted when the device reconnects.',
        ],
    },
    {
        id: 'offline-application',
        name: 'Offline-tolerant application submission',
        status: STATUS.AVAILABLE,
        description: 'Applications are queued in the browser and retried with exponential backoff. Each application has a deterministic identifier derived from company, email and phone, so a retry cannot create a duplicate.',
        intendedUsers: ['drivers', 'recruiters'],
        businessBenefit: 'A driver filling in an application at a truck stop with poor reception does not lose their work or create duplicate records.',
        limitations: [],
        sourceFiles: ['src/features/driver-app/', 'functions/shared/buildApplicationDoc.js'],
        documentation: ['ARCHITECTURE.md'],
        approvedClaims: [
            'A submission interrupted by a dropped connection is retried automatically.',
            'Retried submissions cannot create duplicate driver records.',
        ],
    },
    {
        id: 'document-management',
        name: 'Driver qualification document storage',
        status: STATUS.AVAILABLE,
        description: 'Per-driver document storage with tenant-isolated access rules, server-issued signed links, and audit records for access.',
        intendedUsers: ['safety teams', 'compliance staff'],
        businessBenefit: 'Driver qualification paperwork is held in one place per driver with controlled access, instead of in shared drives.',
        limitations: [
            'SafeHaul stores and organises documents. It does not monitor expiry dates or send renewal reminders.',
        ],
        sourceFiles: ['src/features/documents/', 'functions/storageSecure.js', 'src/storage.rules'],
        documentation: ['docs/firestore-data-model.md', 'docs/security-posture.md'],
        approvedClaims: [
            'Driver documents are stored per driver with access limited to that company\'s team.',
            'Document links are issued by the server and checked against company membership.',
        ],
    },
    {
        id: 'edoc-signing',
        name: 'Electronic documents and signatures',
        status: STATUS.AVAILABLE,
        description: 'Template-based document envelopes with placed signer fields, draw-or-type signatures, a public signing link, constant-time token comparison, double-submit protection and tamper-evident sealing of the completed document.',
        intendedUsers: ['recruiters', 'compliance staff', 'drivers'],
        businessBenefit: 'Hiring paperwork is signed remotely and sealed, without a separate e-signature subscription.',
        limitations: [],
        sourceFiles: ['src/features/signing/', 'functions/digitalSealing.js', 'functions/publicSigning.js'],
        documentation: ['README.md', 'docs/FULL_APPLICATION_AUDIT_REPORT.md'],
        approvedClaims: [
            'Documents can be sent for signature and signed in a browser without an account.',
            'A completed document is sealed so later alteration is detectable.',
            'A signing link cannot be submitted twice.',
        ],
    },
    {
        id: 'ai-field-assistant',
        name: 'AI signer-field placement',
        status: STATUS.AVAILABLE,
        description: 'Inspects an uploaded PDF for existing form fields and ruled blanks, and uses AI vision only for pages it cannot describe deterministically. Every suggestion is validated, clamped to the page and presented for human review before it is applied.',
        intendedUsers: ['recruiters', 'compliance staff'],
        businessBenefit: 'Turning a scanned form into a signable document takes minutes rather than manual field-by-field placement.',
        limitations: [
            'Suggestions always require human review. SafeHaul does not place fields on a document unattended.',
        ],
        sourceFiles: ['functions/edocFieldPlacement.js', 'src/features/signing/hooks/useAiFieldAssistant.js'],
        documentation: ['docs/security-posture.md'],
        approvedClaims: [
            'SafeHaul can suggest where signer fields belong on an uploaded form.',
            'Suggested field placements are reviewed by a person before they take effect.',
        ],
    },
    {
        id: 'cdl-autofill',
        name: 'CDL photo auto-fill',
        status: STATUS.AVAILABLE,
        description: 'A driver photographs their commercial licence and the application fields are pre-filled from it. The extraction runs server-side against a validated schema; the driver reviews and corrects every field before submitting.',
        intendedUsers: ['drivers', 'recruiters'],
        businessBenefit: 'Cuts the longest, most error-prone part of a mobile application down to a photograph.',
        limitations: [
            'Extracted values are always presented for the driver to check. Nothing is submitted unreviewed.',
        ],
        sourceFiles: ['functions/cdlParser.js', 'src/features/driver-app/hooks/useCdlAutoFill.js'],
        documentation: ['docs/security-posture.md'],
        approvedClaims: [
            'A driver can start an application by photographing their licence.',
            'Auto-filled values are shown to the driver for review before submission.',
        ],
    },
    {
        id: 'employment-verification',
        name: 'Previous-employment verification',
        status: STATUS.AVAILABLE,
        description: 'Token-based verification requests sent to a driver\'s previous employers, with rate limiting, private result files and a server-issued signed link that checks company membership before release.',
        intendedUsers: ['safety teams', 'compliance staff'],
        businessBenefit: 'Employment verification requests and responses are tracked in one place with a record of what was asked and answered.',
        limitations: [
            'Requests are initiated from SafeHaul. Automated scheduled follow-up beyond the built-in reminder cycle is not available.',
        ],
        sourceFiles: ['functions/employmentVerification/', 'functions/getSignedPevUrl.js'],
        documentation: ['docs/FULL_APPLICATION_AUDIT_REPORT.md'],
        approvedClaims: [
            'SafeHaul sends previous-employment verification requests and records the responses.',
            'Verification result files are only reachable through a server-issued link checked against company membership.',
        ],
    },
    {
        id: 'bulk-messaging',
        name: 'Bulk SMS and email campaigns',
        status: STATUS.PARTIAL,
        description: 'Batched outbound SMS and email to candidate segments, with per-company encrypted provider credentials, per-recruiter line routing, automatic fallback to the company main number, duplicate suppression and cancel-safe batch processing.',
        intendedUsers: ['recruiters'],
        businessBenefit: 'A recruiter can contact a filtered candidate list without exporting it to another tool.',
        limitations: [
            'Requires the company to supply its own messaging provider credentials.',
            'Carrier charges are billed by the provider, not by SafeHaul.',
            'Two-way conversation threads and automated drip sequences are not available.',
        ],
        sourceFiles: ['functions/bulkActions/', 'functions/integrations/', 'functions/emailService.js'],
        documentation: ['ARCHITECTURE.md', 'README.md'],
        approvedClaims: [
            'Recruiters can message a filtered list of candidates in bulk.',
            'Each company connects its own messaging provider credentials, which are stored encrypted.',
        ],
    },
    {
        id: 'lead-intake',
        name: 'Candidate lead intake',
        status: STATUS.AVAILABLE,
        description: 'Three intake channels into one company-scoped lead list: manual entry, spreadsheet import, and a Facebook Lead Ads webhook.',
        intendedUsers: ['recruiters', 'marketing staff'],
        businessBenefit: 'Leads from advertising and from a recruiter\'s own list arrive in the same place.',
        limitations: ['Automated instant-response messaging to a new lead is not available.'],
        sourceFiles: ['src/features/leads/', 'functions/integrations/facebook.js'],
        documentation: ['ARCHITECTURE.md'],
        approvedClaims: [
            'Candidate leads can be added manually, imported from a spreadsheet, or received from Facebook Lead Ads.',
        ],
    },
    {
        id: 'analytics',
        name: 'Recruiting analytics',
        status: STATUS.AVAILABLE,
        description: 'Dashboards over the hiring pipeline, built from incrementally maintained daily counters rather than recomputed on read.',
        intendedUsers: ['hiring managers', 'fleet managers', 'owners'],
        businessBenefit: 'Shows where candidates are entering and leaving the hiring process without manual reporting.',
        limitations: ['Reporting covers activity recorded in SafeHaul, not external systems.'],
        sourceFiles: ['src/features/analytics/', 'functions/statsAggregator.js', 'functions/dashboardStatsRollup.js'],
        documentation: ['ARCHITECTURE.md'],
        approvedClaims: ['SafeHaul reports on hiring pipeline activity from the records it holds.'],
    },
    {
        id: 'multi-tenant',
        name: 'Multi-company management',
        status: STATUS.AVAILABLE,
        description: 'Each carrier is a separate tenant with its own team, roles, public application profile, custom application questions and feature flags. Cross-company access is denied by database rules, not only by the interface.',
        intendedUsers: ['owners', 'platform administrators'],
        businessBenefit: 'A group operating several carriers keeps their hiring records genuinely separate.',
        limitations: [],
        sourceFiles: ['src/firestore.rules', 'functions/companyAdmin.js', 'src/features/super-admin/'],
        documentation: ['docs/firestore-data-model.md', 'docs/security-posture.md'],
        approvedClaims: [
            'Each company\'s records are isolated by database access rules.',
            'Every company has its own team, roles and public application link.',
        ],
    },
    {
        id: 'audit-logging',
        name: 'Activity and audit records',
        status: STATUS.AVAILABLE,
        description: 'Activity logs on applications and leads, value-free audit records for credential access, and tamper-evident sealing of signed documents. Logs carry a retention expiry.',
        intendedUsers: ['compliance staff', 'owners'],
        businessBenefit: 'There is a record of who did what, which is what an audit asks for.',
        limitations: [],
        sourceFiles: ['functions/activityLogRetention.js', 'functions/environmentVault/audit.js', 'functions/digitalSealing.js'],
        documentation: ['docs/security-posture.md'],
        approvedClaims: [
            'SafeHaul keeps activity records for actions taken on a driver record.',
            'Credential access is audited without recording the credential itself.',
        ],
    },

    // ---------------------------------------------------------------------
    // Not available. Present so the generator can be told what not to say.
    // ---------------------------------------------------------------------
    {
        id: 'dq-expiry-monitoring',
        name: 'Automated document-expiry monitoring and alerts',
        status: STATUS.PLANNED,
        description: 'A daily monitor for expiring driver qualification documents with automatic 30/60/90-day alerts.',
        intendedUsers: [],
        businessBenefit: '',
        limitations: ['On the roadmap. Not built. SafeHaul does not currently monitor expiry dates or send renewal reminders.'],
        sourceFiles: [],
        documentation: ['README.md — Scaling Roadmap, Phase 1'],
        approvedClaims: [],
    },
    {
        id: 'background-checks',
        name: 'MVR, PSP and Clearinghouse integrations',
        status: STATUS.PLANNED,
        description: 'Direct integration with motor vehicle record, PSP and FMCSA Clearinghouse providers.',
        intendedUsers: [],
        businessBenefit: '',
        limitations: ['On the roadmap. Not built. SafeHaul does not order or receive background checks.'],
        sourceFiles: [],
        documentation: ['README.md — Scaling Roadmap, Phase 3'],
        approvedClaims: [],
    },
    {
        id: 'marketing-automation',
        name: 'Speed-to-lead automation and drip campaigns',
        status: STATUS.PLANNED,
        description: 'Automatic instant response to a new lead, two-way chat and multi-step drip sequences.',
        intendedUsers: [],
        businessBenefit: '',
        limitations: ['On the roadmap. Not built.'],
        sourceFiles: [],
        documentation: ['README.md — Scaling Roadmap, Phase 2'],
        approvedClaims: [],
    },
    {
        id: 'app-check',
        name: 'Firebase App Check attestation',
        status: STATUS.RETIRED,
        description: 'Client attestation on callable endpoints.',
        intendedUsers: [],
        businessBenefit: '',
        limitations: ['Deliberately removed. The residual risk is documented and accepted, with rate limits and path validation as the compensating controls.'],
        sourceFiles: [],
        documentation: ['docs/PRODUCTION_AUDIT_REPORT.md — R1'],
        approvedClaims: [],
    },
    {
        id: 'telegram-intake',
        name: 'Telegram application intake',
        status: STATUS.RETIRED,
        description: 'Driver application intake through a Telegram bot.',
        intendedUsers: [],
        businessBenefit: '',
        limitations: ['Removed from the product.'],
        sourceFiles: [],
        documentation: ['docs/FULL_APPLICATION_AUDIT_REPORT.md — superseded notice'],
        approvedClaims: [],
    },
]);

/**
 * Claims the blog must never make, each with the reason.
 *
 * Several of these are on the public landing page today. They are listed here
 * because the blog is generated from verified capability, not from marketing
 * copy, and an article repeating a false claim is worse than an article that
 * omits a feature.
 */
const PROHIBITED_CLAIMS = Object.freeze([
    { claim: 'SafeHaul is free forever', reason: 'Contradicted by the published subscription pricing.' },
    { claim: 'SafeHaul automates DQ file expiry monitoring or sends renewal reminders', reason: 'Roadmap item, not built.' },
    { claim: 'SafeHaul runs MVR, PSP or FMCSA Clearinghouse checks', reason: 'Roadmap item, not built.' },
    { claim: 'SafeHaul uses Firebase App Check or reCAPTCHA attestation', reason: 'Deliberately removed; the risk is documented and accepted.' },
    { claim: 'SafeHaul provides a job board', reason: 'No such feature exists in the codebase.' },
    { claim: 'SafeHaul offers complete GDPR data export', reason: 'No export-all feature is implemented or documented.' },
    { claim: 'SafeHaul sends automated instant replies or drip sequences to new leads', reason: 'Roadmap item, not built.' },
    { claim: 'SafeHaul distributes leads between companies', reason: 'The lead distribution engine was removed.' },
    { claim: 'SafeHaul accepts applications through Telegram', reason: 'Retired feature.' },
    { claim: 'SafeHaul guarantees FMCSA or DOT compliance', reason: 'SafeHaul supports a carrier\'s own compliance process; it cannot guarantee an outcome.' },
    { claim: 'SafeHaul provides legal advice', reason: 'It does not, and articles must say so where regulation is discussed.' },
    { claim: 'Any named carrier endorses SafeHaul', reason: 'No attributed testimonial has been collected.' },
]);

const BY_ID = new Map(FEATURES.map((feature) => [feature.id, feature]));

function availableFeatures() {
    return FEATURES.filter((feature) => feature.status === STATUS.AVAILABLE || feature.status === STATUS.PARTIAL);
}

function approvedClaims() {
    return availableFeatures().flatMap((feature) => feature.approvedClaims);
}

/**
 * The compact briefing handed to the article generator.
 *
 * Deliberately not the whole repository, and deliberately not the whole of this
 * file: unavailable features appear only as a "do not claim" list, so there is
 * nothing for a model to write from.
 */
function buildKnowledgeBriefing() {
    const features = availableFeatures().map((feature) => ({
        name: feature.name,
        status: feature.status,
        description: feature.description,
        who: feature.intendedUsers.join(', '),
        benefit: feature.businessBenefit,
        limitations: feature.limitations,
        approvedClaims: feature.approvedClaims,
    }));

    const doNotClaim = [
        ...PROHIBITED_CLAIMS.map((entry) => entry.claim),
        ...FEATURES
            .filter((feature) => feature.status === STATUS.PLANNED || feature.status === STATUS.RETIRED)
            .map((feature) => `${feature.name} — ${feature.limitations[0] || 'not available'}`),
    ];

    return {
        version: KNOWLEDGE_VERSION,
        verifiedAtCommit: LAST_VERIFIED_COMMIT,
        product: 'SafeHaul, a hiring and compliance platform for US trucking carriers.',
        features,
        doNotClaim,
    };
}

/**
 * Checks generated text against the prohibited-claim list.
 *
 * Substring matching over a curated phrase list is intentionally simple: it is
 * a deterministic backstop, not a language model. `blogKnowledge.test.js` pins
 * the phrases it must catch.
 */
const PROHIBITED_PATTERNS = Object.freeze([
    { pattern: /free\s+forever/i, claim: 'SafeHaul is free forever' },
    { pattern: /\bapp\s*check\b/i, claim: 'SafeHaul uses Firebase App Check' },
    { pattern: /\brecaptcha\b/i, claim: 'SafeHaul uses reCAPTCHA attestation' },
    { pattern: /\b(mvr|psp)\b.{0,40}\b(check|screening|integration)/i, claim: 'SafeHaul runs MVR or PSP checks' },
    { pattern: /clearinghouse\s+(query|check|automation|integration)/i, claim: 'SafeHaul runs Clearinghouse queries' },
    { pattern: /(automat\w*|smart)\s+(dq|document|qualification)\s+(file\s+)?(expir\w*|monitor\w*|reminder|alert)/i, claim: 'SafeHaul automates DQ expiry monitoring' },
    { pattern: /(expir\w*|renewal)\s+(reminder|alert)s?\b/i, claim: 'SafeHaul sends expiry reminders' },
    { pattern: /\bjob\s*board\b/i, claim: 'SafeHaul provides a job board' },
    { pattern: /drip\s+(campaign|sequence)/i, claim: 'SafeHaul runs drip campaigns' },
    { pattern: /speed[-\s]to[-\s]lead/i, claim: 'SafeHaul provides speed-to-lead automation' },
    { pattern: /(guarantee\w*)\s+(your\s+)?(fmcsa|dot)\s+compliance/i, claim: 'SafeHaul guarantees compliance' },
    { pattern: /\b(legal advice|we advise you legally)\b/i, claim: 'SafeHaul provides legal advice' },
    { pattern: /applications?\s+(via|through|by)\s+telegram/i, claim: 'SafeHaul accepts applications through Telegram' },
]);

/**
 * @param {string} text article text to check
 * @returns {{ ok: boolean, violations: Array<{ claim: string }> }}
 */
function checkClaims(text) {
    const haystack = typeof text === 'string' ? text : '';
    const violations = [];
    for (const entry of PROHIBITED_PATTERNS) {
        if (entry.pattern.test(haystack)) violations.push({ claim: entry.claim });
    }
    return { ok: violations.length === 0, violations };
}

module.exports = {
    KNOWLEDGE_VERSION,
    LAST_VERIFIED_COMMIT,
    STATUS,
    FEATURES,
    PROHIBITED_CLAIMS,
    PROHIBITED_PATTERNS,
    availableFeatures,
    approvedClaims,
    buildKnowledgeBriefing,
    checkClaims,
    getFeature: (id) => BY_ID.get(id) || null,
};
