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
 * ## Why `initialize` and not an environment variable
 *
 * The first version took the record's path from the environment. That is a
 * global for something that belongs to one registration, and `functions/test/
 * unit/environmentRegistry.inventory.test.js` was right to refuse it: every
 * environment variable this repository reads is inventoried as SafeHaul
 * configuration, and a temporary file that a test harness hands its own child
 * process is not configuration — registering it would have put fiction in a
 * Super Admin screen to make a test pass.
 *
 * That guard reads text rather than syntax, so naming a variable in PROSE
 * invents one. Writing this paragraph the first time added a key called `X` and
 * failed the guard on its own explanation. Deliberate, and the right trade: a
 * scan that also sees comments cannot be talked out of a real one.
 *
 * `register()` has a channel for exactly this. `data` is handed to `initialize`
 * before any resolution happens, so the path arrives by the route the platform
 * designed for it and no process-wide name is invented.
 *
 * Named `test-` so it is not itself part of the covered set.
 */

import { appendFileSync } from 'node:fs';

/** Where to append resolved URLs, handed over by `register(..., { data })`. */
let record = null;

export function initialize(data) {
    record = data;
}

export async function resolve(specifier, context, next) {
    const result = await next(specifier, context);
    if (record && result.url.startsWith('file:')) appendFileSync(record, `${result.url}\n`);
    return result;
}
