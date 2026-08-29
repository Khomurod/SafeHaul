/**
 * A, B, C — which lanes a change selects, and what counts as proof.
 *
 * Together these answer one question in three parts: given a diff, what must
 * run? A says the right lanes are chosen in both directions — the lane is on for
 * a change that needs it and off for one that does not. B says every uncertainty
 * widens rather than narrows. C says an attestation only counts when it came
 * from a successful run of this repository's own pull-request workflow against
 * this exact source tree.
 */

import {
    LANE_NAMES,
    attestationName,
    diffRange,
    isUsableAttestation,
    lanesForPath,
    readAttestations,
    selectLanes,
} from '../ci-plan.mjs';
import { REPO_ID, TREE, assert, chosen } from './test-support.mjs';

/* ========================================================================== */
console.log('\nA. Path selection');
/* ========================================================================== */

assert('A1. a Cloud Functions change runs only the functions lane',
    JSON.stringify(chosen(['functions/leads/onLead.js'])) === JSON.stringify(['functions']),
    JSON.stringify(chosen(['functions/leads/onLead.js'])));

assert('A2. a feature-only frontend change skips the backend and rules lanes',
    JSON.stringify(chosen(['src/features/campaigns/CampaignCard.jsx']))
        === JSON.stringify(['frontend_build', 'frontend_e2e', 'frontend_unit', 'storybook'].sort()),
    JSON.stringify(chosen(['src/features/campaigns/CampaignCard.jsx'])));

assert('A3. an e2e spec change runs only the browser lane',
    JSON.stringify(chosen(['e2e/login.spec.cjs'])) === JSON.stringify(['frontend_e2e']));

assert('A4. a documentation-only change runs no test lane',
    chosen(['docs/RUNBOOK.md', 'README.md', 'CLAUDE.md', '.claude/settings.json']).length === 0,
    JSON.stringify(chosen(['docs/RUNBOOK.md', 'README.md'])));

// The public site has no build step, so "static content is not tested" is an
// easy assumption to make — and this assertion used to encode it. It let a
// static-only commit select no lanes: CI was green while `main` served a homepage
// claiming MVR checks the product does not run. That site is gone; `web/` is the
// public Hosting root now, `src/tests/hostingConfig.test.js` covers it in the
// `frontend_unit` lane. The directory changed, the lesson did not.
assert('A5. a public-site change runs the lane that holds its tests',
    JSON.stringify(chosen(['web/privacy.html'])) === JSON.stringify(['frontend_unit']),
    JSON.stringify(chosen(['web/privacy.html'])));

assert('A5b. a public-site change still skips the backend, rules and browser lanes',
    ['functions', 'rules', 'frontend_e2e', 'frontend_build', 'storybook']
        .every((lane) => !chosen(['web/assets/css/news-foundation.css']).includes(lane)),
    JSON.stringify(chosen(['web/assets/css/news-foundation.css'])));

assert('A6. a mixed frontend + backend change runs both sides',
    JSON.stringify(chosen(['src/features/auth/Login.jsx', 'functions/auth/claims.js']))
        === JSON.stringify(['frontend_build', 'frontend_e2e', 'frontend_unit', 'functions', 'storybook'].sort()),
    JSON.stringify(chosen(['src/features/auth/Login.jsx', 'functions/auth/claims.js'])));

/* ========================================================================== */
console.log('\nB. Conservative fallback to the full suite');
/* ========================================================================== */

const forcesFull = [
    ['a dependency lockfile', 'package-lock.json'],
    ['the frontend manifest', 'package.json'],
    ['the functions lockfile', 'functions/package-lock.json'],
    ['build configuration', 'vite.config.js'],
    ['test-runner configuration', 'vitest.config.js'],
    ['Playwright configuration', 'playwright.config.cjs'],
    ['lint configuration', 'eslint.config.js'],
    ['Firebase project configuration', 'firebase.json'],
    ['Firestore security rules', 'src/firestore.rules'],
    ['Storage security rules', 'src/storage.rules'],
    ['Firestore indexes', 'firestore.indexes.json'],
    ['a CI workflow', '.github/workflows/main.yml'],
    ['a release script', 'scripts/record-release.mjs'],
    ['the CI planner itself', 'scripts/ci-plan.mjs'],
    ['shared UI', 'src/shared/components/form/InputField.jsx'],
    ['the design system', 'src/design-system/Button.jsx'],
    ['a shared hook', 'src/hooks/useCompany.js'],
    ['shared library code', 'src/lib/applicationWrite.js'],
    ['the app shell', 'src/app/routes.jsx'],
    ['the test setup', 'src/tests/setup.js'],
    ['the app entry point', 'src/main.jsx'],
    ['the shared application/PDF architecture', 'src/features/applications/services/applicationPdfService.js'],
    ['anything PDF-named', 'src/features/signing/pdfOverlay.js'],
    ['the PDF worker asset', 'public/pdf.worker.min.mjs'],
    ['an unrecognised top-level file', 'Dockerfile'],
    ['an unrecognised directory', 'terraform/main.tf'],
];

for (const [label, path] of forcesFull) {
    const { full, lanes } = selectLanes({ changedFiles: [path] });
    assert(`B. ${label} (${path}) forces the full suite`,
        full === true && LANE_NAMES.every((lane) => lanes[lane]),
        `full=${full} lanes=${JSON.stringify(lanes)}`);
}

assert('B27. one cross-cutting file among many harmless ones still forces the full suite',
    selectLanes({ changedFiles: ['docs/a.md', 'package-lock.json', 'web/i.html'] }).full === true);

assert('B28. an undeterminable change set forces the full suite',
    selectLanes({ changedFiles: null }).full === true
        && selectLanes({ changedFiles: undefined }).full === true);

assert('B29. an empty change set forces the full suite rather than skipping everything',
    selectLanes({ changedFiles: [] }).full === true,
    'an empty diff means the diff was wrong, not that nothing needs testing');

assert('B30. an unclassifiable path is cross-cutting, not harmless',
    lanesForPath('') === null && lanesForPath(undefined) === null);

/* -- the diff range, which is where "could not be determined" comes from ---- */

assert('B31. a pull request diffs against its base',
    diffRange({ eventName: 'pull_request', event: { pull_request: { base: { sha: 'abc' } } } })
        ?.base === 'abc');

assert('B32. a pull request with no base sha has no usable range',
    diffRange({ eventName: 'pull_request', event: {} }) === null);

assert('B33. a push diffs against its previous head',
    diffRange({ eventName: 'push', event: { before: 'def' } })?.base === 'def');

assert('B34. a push with no previous head (new branch / force push) has no usable range',
    diffRange({ eventName: 'push', event: { before: '0'.repeat(40) } }) === null
        && diffRange({ eventName: 'push', event: {} }) === null);

assert('B35. a manual dispatch has no change set, so it runs everything',
    diffRange({ eventName: 'workflow_dispatch', event: {} }) === null);

/* ========================================================================== */
console.log('\nC. Provenance — what counts as proof');
/* ========================================================================== */

const name = attestationName(TREE, 'frontend_e2e');
const goodArtifact = {
    name,
    expired: false,
    workflow_run: { id: 77, repository_id: REPO_ID, head_repository_id: REPO_ID },
};
const goodRun = { status: 'completed', conclusion: 'success', event: 'pull_request' };

assert('C1. accepts an attestation from a successful pull-request run of this repo',
    isUsableAttestation(goodArtifact, goodRun, { name, repositoryId: REPO_ID }).ok === true,
    JSON.stringify(isUsableAttestation(goodArtifact, goodRun, { name, repositoryId: REPO_ID })));

const rejects = [
    ['an expired artifact', { ...goodArtifact, expired: true }, goodRun],
    ['a different artifact name', { ...goodArtifact, name: `${name}-x` }, goodRun],
    ['another repository', { ...goodArtifact, workflow_run: { ...goodArtifact.workflow_run, repository_id: 999 } }, goodRun],
    ['a fork', { ...goodArtifact, workflow_run: { ...goodArtifact.workflow_run, head_repository_id: 999 } }, goodRun],
    ['an unreadable run', goodArtifact, null],
    ['a still-running run', goodArtifact, { ...goodRun, status: 'in_progress', conclusion: null }],
    ['a failed run', goodArtifact, { ...goodRun, conclusion: 'failure' }],
    ['a cancelled run', goodArtifact, { ...goodRun, conclusion: 'cancelled' }],
    ['a run that was never a pull request', goodArtifact, { ...goodRun, event: 'workflow_dispatch' }],
];

for (const [label, artifact, run] of rejects) {
    assert(`C. rejects ${label}`,
        isUsableAttestation(artifact, run, { name, repositoryId: REPO_ID }).ok === false);
}

// The tree hash is the identity. An attestation for a different tree is simply a
// different artifact name and can never be found by a lookup for this one.
assert('C11. an attestation is bound to one exact source tree',
    attestationName('a'.repeat(40), 'rules') !== attestationName('b'.repeat(40), 'rules'));

{
    // A lookup that 404s, times out or returns junk must leave the lane unproven.
    const attested = await readAttestations({
        treeSha: TREE,
        lanes: ['frontend_e2e', 'rules'],
        repositoryId: REPO_ID,
        api: async () => { throw new Error('502 Bad Gateway'); },
    });
    assert('C12. an attestation lookup that errors leaves every lane unproven',
        attested.frontend_e2e === false && attested.rules === false,
        JSON.stringify(attested));
}

{
    // Defence in depth: if the API ever stops honouring the `name` filter and
    // hands back everything, the local name check must still reject.
    const attested = await readAttestations({
        treeSha: TREE,
        lanes: ['rules'],
        repositoryId: REPO_ID,
        api: async (path) => (path.startsWith('/actions/artifacts')
            ? { artifacts: [{ ...goodArtifact, name: attestationName('0'.repeat(40), 'rules') }] }
            : goodRun),
    });
    assert('C13. an unfiltered artifact list cannot smuggle in a foreign tree',
        attested.rules === false, JSON.stringify(attested));
}

{
    const attested = await readAttestations({
        treeSha: TREE,
        lanes: ['rules'],
        repositoryId: REPO_ID,
        api: async (path) => (path.startsWith('/actions/artifacts')
            ? { artifacts: [{ ...goodArtifact, name: attestationName(TREE, 'rules') }] }
            : goodRun),
    });
    assert('C14. a matching, successful attestation is accepted', attested.rules === true);
}

/* ========================================================================== */
