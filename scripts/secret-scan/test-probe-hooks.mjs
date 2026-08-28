/**
 * A module-resolution hook that records what Node actually loads.
 *
 * Registered into a child process by `test-sources.mjs`. Every resolution that
 * lands on a file is recorded, so the parent gets the real module graph rather
 * than an inference about it — which after several rounds of specifier syntax
 * evading a regex is the only account of "what the scanner is made of" that
 * cannot be written around. `next()` is Node's own resolver, so import
 * attributes, URL queries, comments in odd places and anything else the grammar
 * allows are handled by definition.
 *
 * ## Why a file and not stdout
 *
 * The first version wrote to `process.stdout`. Review on 2026-08-28 pointed out
 * that a hook runs on the loader-hooks thread, where `process.stdout.write` is
 * proxied to the main thread and is asynchronous for a pipe — so a short-lived
 * probe can exit with records still buffered. That would make a REQUIRED test
 * intermittently classify a live module as an orphan, and could let the outside-
 * load check miss a real escape, which is the fail-open direction.
 *
 * It was not reproducible here in 90 attempts across two configurations, and
 * that is not evidence of absence for a race: it is evidence that arguing about
 * it costs more than removing it. `appendFileSync` is synchronous and has
 * returned before the hook does, so there is no window to lose a record in and
 * nothing for exit sequencing to get wrong.
 *
 * Named `test-` so it is not itself part of the covered set.
 */

import { appendFileSync } from 'node:fs';

const RECORD = process.env.SAFEHAUL_PROBE_RECORD;

export async function resolve(specifier, context, next) {
    const result = await next(specifier, context);
    if (RECORD && result.url.startsWith('file:')) appendFileSync(RECORD, `${result.url}\n`);
    return result;
}
