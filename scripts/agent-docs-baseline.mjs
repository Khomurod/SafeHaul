/**
 * The agent-docs limits may only move down.
 *
 * `agent-docs-limits.mjs` comes from the branch under test, and that branch may
 * edit it: a check that read only the current file would accept a raised limit
 * in the same change as the text the raise lets through. So the limits are also
 * read at the base commit — chosen exactly as the source-size guard chooses it
 * (`resolveBaselineRef`) — and any raised, loosened or removed limit is refused.
 * Raising one is the owner's decision, taken by changing this check in a change
 * the owner approves.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBaselineRef } from './source-size-baseline.mjs';
import { resolveValidatedBaseline } from './source-size-validated.mjs';
import { removeTree } from './lib/throwaway.mjs';

export const LIMITS_PATH = 'scripts/agent-docs-limits.mjs';

/**
 * Every way `current` is looser than `base`.
 *
 * @param {{limits: object[], alwaysLoaded: string[], alwaysLoadedMaxBytes: number}} base
 * @param {{limits: object[], alwaysLoaded: string[], alwaysLoadedMaxBytes: number}} current
 */
export function loosenedLimits(base, current) {
    const problems = [];
    const now = new Map(current.limits.map((limit) => [limit.pattern, limit]));
    for (const was of base.limits) {
        const is = now.get(was.pattern);
        if (!is) {
            problems.push(`${was.pattern}: its limit was removed`);
            continue;
        }
        if (is.maxLines > was.maxLines) problems.push(`${was.pattern}: maxLines raised from ${was.maxLines} to ${is.maxLines}`);
        if (was.maxBytes && !(is.maxBytes <= was.maxBytes)) {
            problems.push(`${was.pattern}: maxBytes raised from ${was.maxBytes} to ${is.maxBytes ?? 'no limit'}`);
        }
        if (was.mustExist && !is.mustExist) problems.push(`${was.pattern}: no longer required to exist`);
        if (was.requirePaths && !is.requirePaths) problems.push(`${was.pattern}: no longer required to carry \`paths:\``);
    }
    if (current.alwaysLoadedMaxBytes > base.alwaysLoadedMaxBytes) {
        problems.push(`the always-loaded budget was raised from ${base.alwaysLoadedMaxBytes} to ${current.alwaysLoadedMaxBytes} bytes`);
    }
    for (const path of base.alwaysLoaded) {
        if (!current.alwaysLoaded.includes(path)) problems.push(`${path}: dropped from the always-loaded budget`);
    }
    return problems.map((problem) => `${problem}, compared with the base commit. Limits only move down; shorten the text instead.`);
}

/** The limits as committed at `ref`, or null when the file did not exist there yet. */
export async function readLimitsAt(ref, { cwd }) {
    let source;
    try {
        source = execFileSync('git', ['show', `${ref}:${LIMITS_PATH}`], {
            cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null;
    }
    const dir = mkdtempSync(join(tmpdir(), 'agent-docs-base-'));
    try {
        const file = join(dir, 'limits.mjs');
        writeFileSync(file, source);
        const mod = await import(pathToFileURL(file).href);
        return {
            limits: mod.AGENT_DOC_LIMITS,
            alwaysLoaded: mod.ALWAYS_LOADED,
            alwaysLoadedMaxBytes: mod.ALWAYS_LOADED_MAX_BYTES,
        };
    } finally {
        removeTree(dir);
    }
}

/** Compare the current limits with the base commit's. */
export async function checkLimitsDirection({ current, cwd, requireBaseline, env = process.env }) {
    const headSha = execFileSync('git', ['rev-parse', 'HEAD^{commit}'], { cwd, encoding: 'utf8' }).trim();
    const lookup = await resolveValidatedBaseline({ env, cwd, headSha });
    const base = resolveBaselineRef({ env, cwd, ...lookup });
    if (!base.ref) {
        const why = `no base commit to compare the limits with: ${base.error}`;
        return requireBaseline ? { problems: [why], describe: why } : { problems: [], describe: `${why} (skipped locally)` };
    }
    const was = await readLimitsAt(base.ref, { cwd });
    const at = `${base.ref.slice(0, 8)} (${base.source})`;
    if (!was) return { problems: [], describe: `${LIMITS_PATH} is new since ${at}; nothing to compare` };
    return { problems: loosenedLimits(was, current), describe: `limits compared with ${at}` };
}
