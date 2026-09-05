/**
 * Where the previous allowlist comes from, and what the base's own content says.
 *
 * `./direction.mjs` decides whether the inventory moved the wrong way; this
 * fetches the two things it needs — the allowlist as committed at the base, and
 * the base's own source measured with the CURRENT rules — and wires them to the
 * ref resolution the size guard already owns.
 *
 * ## Everything here is borrowed on purpose
 *
 * `scripts/source-size-baseline.mjs` answered "which commit is the base" five
 * times and got it wrong the first four, and every one of those rounds applies
 * verbatim to this guard: a push's own `before` is only as good as the run that
 * happened on it, `HEAD~1` after a multi-commit push is inside that push, and an
 * escape hatch is a bypass if nobody checks it. Writing a second resolver would
 * mean re-learning all of it. So `resolveBaselineRef` and `readSizesAt` are
 * imported, and **`SOURCE_SIZE_BASE` is shared rather than duplicated** — one
 * override, one meaning, one place an operator can get it wrong.
 *
 * What is *not* borrowed is the comparison itself: the size backlog is flat
 * (`{path: number}`) and this inventory is nested (`{file: {rule: number}}`),
 * which is why `./direction.mjs` exists at all.
 *
 * ## Why the base is measured with the current rules
 *
 * `measureAt` runs today's rule set over yesterday's file. That is the
 * difference between a ratchet and a straitjacket: a slice that WIDENS a rule
 * legitimately records violations that have been in the tree for months, and
 * comparing against the base's *recorded* counts alone would refuse every such
 * slice. Comparing against the base's *content* accepts it, while still refusing
 * a violation the change itself wrote — which is the only thing an inventory may
 * never absorb.
 *
 * ## And a file that MOVED still counts as content the base carried
 *
 * The first version of this refused a pure rename six ways with no route
 * forward, which was reproduced before it was fixed: rename an allowlisted file
 * and every one of its entries is "a file this change adds", while leaving the
 * entry under the old path fails as stale and deleting it fails as an uncovered
 * violation. A deadlock, on a change that adds not one violation.
 *
 * `scripts/source-size.mjs` has the same rule and has never hit it, because its
 * campaign SPLIT files rather than moving them and a split removes the entry.
 * Here a split moves a hundred palette classes into a new path that still needs
 * one, so the case is reachable and the guard has to answer it.
 *
 * It answers with git rather than with a heuristic: `git diff -M -C` names the
 * path a new file came from, and the base's copy of THAT path is what the entry
 * is measured against. This cannot launder anything — the count still may not
 * exceed what the source carried at the base, so a rename that also adds a
 * violation is refused on the number. `-C` without `--find-copies-harder` is
 * deliberate: copy detection then considers only files the same diff already
 * touches, which is exactly the split shape (original modified, piece created)
 * and costs nothing on an untouched tree.
 */

import { spawnSync } from 'node:child_process';
import {
    readSizesAt, repoRootPath, resolveBaselineRef,
} from '../source-size-baseline.mjs';
import { countViolations } from './counting.mjs';
import { rulesFor } from './source-text.mjs';
import { normaliseAllowlist } from './allowlist.mjs';
import { compareAllowlist, growthJustifiedByBase } from './direction.mjs';

/** Repo-relative, because git is asked about it — the CLI resolves its own copy. */
export const ALLOWLIST_PATH = 'src/design-system/ui-contract.allowlist.json';

/**
 * An allowlist key IS a repo-relative path, as of allowlist version 2.
 *
 * It was `src/`-relative before the scan reached `index.html`, and this was the
 * concatenation that bridged the two. It is the identity now, kept as a named
 * function because it is the one place that would have to change again if the
 * scan ever grew a third root — and because `readAllowlistAt` normalising a v1
 * base into v2 keys is what makes the identity safe (see `./allowlist.mjs`).
 */
export const repoPathForKey = (key) => key;

function defaultRun(args, cwd) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    return { ok: result.status === 0, stdout: result.stdout || '' };
}

/** Parses without throwing, so a corrupt base file is a diagnosis not a stack. */
function parseAllowlist(text) {
    try {
        return { document: JSON.parse(text), error: null };
    } catch (error) {
        return { document: null, error: error.message };
    }
}

/**
 * The allowlist as committed at `ref`.
 *
 * `absent` is not an error: it means the base predates the inventory, and every
 * entry is then legitimately new *as an entry* — which says nothing about
 * whether the violations behind them are. `checkAllowlistDirection` sends that
 * case through the same justification as any other growth.
 *
 * The whole document is returned, not just `files`, because Phase 2a's version
 * field has to be readable here to normalise a v1 base into v2 keys.
 */
export function readAllowlistAt(ref, { cwd = repoRootPath, readSizes = readSizesAt } = {}) {
    const read = readSizes(ref, [ALLOWLIST_PATH], { cwd, countLines: parseAllowlist });
    const found = read[ALLOWLIST_PATH];
    if (found === undefined) return { document: null, files: null, absent: true, error: null };
    if (found.error) {
        return {
            document: null,
            files: null,
            absent: false,
            error: `unreadable at ${ref.slice(0, 8)}: ${found.error}`,
        };
    }
    /*
     * Normalised, because the base may be version 1 — `src/`-relative keys —
     * while the branch is version 2. Comparing those raw would report all 43
     * entries deleted and all 43 added, and every addition would be refused as a
     * new exemption, which is how a key-format change becomes unlandable.
     */
    return {
        document: found.document,
        files: normaliseAllowlist(found.document),
        absent: false,
        error: null,
    };
}

/**
 * Where each file added between `ref` and HEAD came from, if git can say.
 *
 * Returns repo-relative `new -> old`. `-M` catches a rename, `-C` a split (the
 * piece is a copy of a file the same diff modified). Anything git does not
 * attribute is simply absent, and `growthJustifiedByBase` then treats the file
 * as new — which it is.
 *
 * Failure is silence, not an exception: the caller's refusal is already correct
 * for an unattributed file, and a guard that crashes when `git diff` has a bad
 * day is a guard someone removes.
 */
export function movedFrom(ref, { cwd = repoRootPath, run = defaultRun } = {}) {
    /*
     * `ref` against the WORKING TREE, not against HEAD, because that is what the
     * scan reads. In CI they are the same commit and the choice is invisible;
     * locally it is the difference between a rename being attributed the moment
     * `git mv` runs and only after it is committed — and a guard that refuses a
     * rename until you commit it teaches people to commit blind. An untracked new
     * file is in neither diff, so a split is attributed once its piece is added.
     */
    const result = run(['diff', '--name-status', '-M', '-C', '-z', ref], cwd);
    if (!result.ok) return {};
    /*
     * `-z` because a tracked path may contain a newline, and splitting on
     * newlines turns one such path into two — the same reason
     * `scripts/source-size.mjs` keeps `git ls-files -z` intact. With `-z` a
     * rename is three NUL-terminated fields (`R100`, old, new) where an ordinary
     * change is two.
     */
    const fields = result.stdout.split('\0');
    const moves = {};
    for (let i = 0; i < fields.length && fields[i]; i += 1) {
        const status = fields[i];
        if (!/^[RC]/.test(status)) { i += 1; continue; }
        const [old, now] = [fields[i + 1], fields[i + 2]];
        if (old && now) moves[now] = old;
        i += 2;
    }
    return moves;
}

/**
 * How many violations each of these files carried at `ref`, under today's rules.
 *
 * Files absent at `ref` are omitted rather than recorded as zero, because the
 * two mean different things to `growthJustifiedByBase`: zero is "the file was
 * there and clean", absent is "this change created the file", and only the
 * second is a new exemption being written.
 *
 * `readSizes` returns raw text here and the rules are applied afterwards, so the
 * per-file rule routing (stories get a subset, stylesheets get the CSS rules,
 * token definitions get none) stays in one place instead of being smuggled
 * through an injected callback.
 */
export function measureAt(ref, keys, { cwd = repoRootPath, readSizes = readSizesAt, moves = null } = {}) {
    const attributed = moves ?? movedFrom(ref, { cwd });
    const sourcePath = (key) => attributed[repoPathForKey(key)] ?? repoPathForKey(key);
    const sources = readSizes(ref, keys.map(sourcePath), { cwd, countLines: (text) => text });
    const counts = {};
    for (const key of keys) {
        const source = sources[sourcePath(key)];
        if (source === undefined) continue;
        /*
         * Rules come from the key's OWN path, not the path it moved from: a
         * component renamed to `X.stories.jsx` is held to the story rule set from
         * the moment it is one.
         */
        counts[key] = countViolations(source, rulesFor(key), { html: key.endsWith('.html') });
    }
    return counts;
}

/**
 * Compare, or refuse.
 *
 * The sibling of `checkBacklogDirection`, branch for branch, with one
 * simplification the nested shape allows: an absent base allowlist is not a
 * separate bootstrap path. `compareAllowlist({}, current)` reports every entry
 * as growth, and growth is justified against the base's own content either way —
 * so the commit that introduces the inventory is judged by exactly the rule that
 * judges the commit after it. The size guard needed two paths because its
 * bootstrap check is a different function; this one does not.
 *
 * @returns {{problems: string[], describe: string}}
 */
export function checkAllowlistDirection({
    current, requireBaseline = false,
    env = process.env, cwd = repoRootPath,
    lastValidatedBase = () => null, overrideValidated = () => false,
    automaticLookupComplete = () => true,
    resolveRef = resolveBaselineRef, readAt = readAllowlistAt, measure = measureAt,
} = {}) {
    const { ref, source, error } = resolveRef({
        env, cwd, lastValidatedBase, overrideValidated, automaticLookupComplete,
    });
    if (!ref) {
        const why = `no baseline to compare the allowlist against (${source}: ${error})`;
        if (requireBaseline) {
            return {
                problems: [`${why}. This run was asked to prove the allowlist did not grow and `
                    + 'cannot, so it refuses rather than pass on an inventory the branch under test '
                    + 'is free to edit. Fetch enough history, or set SOURCE_SIZE_BASE to a commit '
                    + 'to compare against.'],
                describe: why,
            };
        }
        return { problems: [], describe: `${why} — comparison skipped (not required for this run)` };
    }

    const previous = readAt(ref, { cwd });
    if (previous.error) {
        const why = `the allowlist at ${ref.slice(0, 8)} could not be read: ${previous.error}`;
        return { problems: requireBaseline ? [why] : [], describe: why };
    }

    const at = `${ref.slice(0, 8)} (${source})`;
    const entries = Object.keys(current ?? {}).length;
    if (previous.absent) {
        /*
         * The same category error the size guard refuses, and for the same
         * reason: an override reaching back past the inventory's own start makes
         * `git show` fail, which reads as "the campaign begins with this change"
         * and would take every current entry on trust. Refused here rather than
         * left to the per-entry check, because it deserves to read like the
         * mistake it is rather than like a list of unjustified entries.
         */
        if (source === 'SOURCE_SIZE_BASE' && entries > 0) {
            return {
                problems: [`${ref.slice(0, 8)} predates ${ALLOWLIST_PATH}, so an override naming it `
                    + `would have the current allowlist's ${entries} `
                    + `${entries === 1 ? 'entry' : 'entries'} judged against a commit the guard `
                    + 'never ran on. An override cannot reach behind its start'],
                describe: `no allowlist at ${at} — refused as an override`,
            };
        }
        if (entries === 0) return { problems: [], describe: `no allowlist at ${at}, and nothing recorded` };
    }

    const { problems, growth } = compareAllowlist(previous.absent ? {} : previous.files, current);
    if (problems.length > 0 || growth.length === 0) {
        return { problems, describe: `compared against ${at}` };
    }

    const countsAtBase = measure(ref, [...new Set(growth.map((entry) => entry.file))], { cwd });
    return {
        problems: growthJustifiedByBase(growth, countsAtBase, ref),
        describe: `compared against ${at} — ${growth.length} addition(s) checked against its content`,
    };
}
