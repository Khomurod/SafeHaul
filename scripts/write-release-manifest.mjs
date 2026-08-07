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
 * Usage: node scripts/write-release-manifest.mjs <distDir> <channel> <sha>
 */
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , distDir, channel, sha] = process.argv;

if (!distDir || !channel || !sha) {
    console.error('Usage: write-release-manifest.mjs <distDir> <channel> <sha>');
    process.exit(1);
}

if (!['testing', 'production'].includes(channel)) {
    console.error(`Refusing to stamp an unknown channel: ${channel}`);
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
    channel,
    builtAt: new Date().toISOString(),
};

const target = resolve(outDir, 'release.json');
writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Stamped ${target}: ${channel} @ ${sha}`);
