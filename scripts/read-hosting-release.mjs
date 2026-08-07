#!/usr/bin/env node
/**
 * Read back the Hosting version ID that is currently live on a site.
 *
 * Firebase Hosting versions are immutable. Capturing the ID right after a
 * Testing deploy is what lets a promotion later copy *those exact bytes* with
 * `firebase hosting:clone SITE:@VERSION_ID`, instead of rebuilding whatever
 * `main` happens to point at by the time somebody presses the button.
 *
 * Authenticates with GOOGLE_ACCESS_TOKEN, which the deploy workflow mints from
 * the existing Workload Identity Federation exchange. No service-account key is
 * downloaded, created or stored.
 *
 * Usage: node scripts/read-hosting-release.mjs <siteId> <outputPrefix>
 * Prints `<prefix>_version_id=...` lines for $GITHUB_OUTPUT.
 */

const [, , siteId, prefix] = process.argv;

if (!siteId || !prefix) {
    console.error('Usage: read-hosting-release.mjs <siteId> <outputPrefix>');
    process.exit(1);
}

const token = process.env.GOOGLE_ACCESS_TOKEN;
if (!token) {
    console.error('GOOGLE_ACCESS_TOKEN is not set. The auth step must request token_format: access_token.');
    process.exit(1);
}

const url =
    `https://firebasehosting.googleapis.com/v1beta1/sites/${encodeURIComponent(siteId)}` +
    '/releases?pageSize=1';

const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
});

if (!response.ok) {
    const body = await response.text();
    console.error(`Hosting API returned ${response.status} for site ${siteId}: ${body.slice(0, 400)}`);
    process.exit(1);
}

const payload = await response.json();
const release = payload?.releases?.[0];

// `version.name` looks like `sites/<site>/versions/<versionId>`. The trailing
// segment is the only part `hosting:clone` accepts.
const versionName = release?.version?.name;
const versionId = typeof versionName === 'string' ? versionName.split('/').pop() : undefined;

if (!versionId) {
    console.error(
        `Could not resolve a live Hosting version for site ${siteId}. ` +
        'Refusing to record a release that cannot later be promoted by ID.',
    );
    process.exit(1);
}

console.log(`${prefix}_version_id=${versionId}`);
