#!/usr/bin/env node
/**
 * Stamp a release manifest into a built frontend.
 *
 * `VITE_RELEASE_SHA` is compiled into the bundle, which means the only way to
 * read the deployed SHA back is to parse hashed JS chunks. That is too fragile
 * to gate a production promotion on, so the same value is also written as a
 * plain static file that the deployed site serves.
 *
 * The point is independent verification. After any deploy, the live SHA is one
 * request away and needs no credentials:
 *
 *     curl https://truckerapp-system.web.app/release.json
 *
 * The manifest deliberately records NO channel. A production promotion clones the
 * Testing artifact byte for byte, so a channel baked in at build time would then
 * be a lie on production — and the bundle genuinely is channel-agnostic: apply
 * links come from window.location.origin, so the site serving the bytes is what
 * decides the channel. Which channel a SHA is on is a property of the Hosting
 * site, and is answered by the release records, not by the artifact.
 *
 * Usage: node scripts/write-release-manifest.mjs <distDir> <sha>
 */
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , distDir, sha] = process.argv;

if (!distDir || !sha) {
    console.error('Usage: write-release-manifest.mjs <distDir> <sha>');
    process.exit(1);
}

// A short SHA is ambiguous and a branch name is not a release identity. Insist
// on the full 40-character commit id so the manifest can never be "close enough".
if (!/^[0-9a-f]{40}$/.test(sha)) {
    console.error(`Refusing to stamp a release without a full 40-character commit SHA (got: ${sha})`);
    process.exit(1);
}

const outDir = resolve(process.cwd(), distDir);
if (!existsSync(outDir)) {
    console.error(`Build output directory does not exist: ${outDir}`);
    process.exit(1);
}

const manifest = {
    sha,
    builtAt: new Date().toISOString(),
};

const target = resolve(outDir, 'release.json');
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Stamped ${target}: ${sha}`);
