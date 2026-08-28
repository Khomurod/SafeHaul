/**
 * A module-resolution hook that reports what Node actually loads.
 *
 * Registered into a child process by `test-sources.mjs`. Every resolution that
 * lands on a file is printed, so the parent gets the real module graph rather
 * than an inference about it — which after three rounds of specifier syntax
 * evading a regex is the only account of "what the scanner is made of" that
 * cannot be written around. `next()` is Node's own resolver, so import
 * attributes, URL queries, comments in odd places and anything else the grammar
 * allows are handled by definition.
 *
 * Named `test-` so it is not itself part of the covered set.
 */
export async function resolve(specifier, context, next) {
    const result = await next(specifier, context);
    if (result.url.startsWith('file:')) process.stdout.write(`GRAPH ${result.url}\n`);
    return result;
}
