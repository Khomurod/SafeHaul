/**
 * Which pixel baselines a CI screenshot diff replaces.
 *
 * A failed screenshot job uploads Playwright's `test-results/`: one folder per
 * attempt, named after the spec file first (`app-…`, `catalog-…`), holding
 * `<snapshot>-actual.png`. The baseline for it is
 * `e2e/visual/__screenshots__/<spec>/<snapshot>.png`.
 *
 * A snapshot whose attempts rendered different bytes is not stable, so it is
 * reported and left alone rather than taken from whichever attempt came last.
 */

const ACTUAL = /^test-results\/([^/]+)\/([^/]+)-actual\.png$/;

/**
 * @param {{ path: string, hash: string }[]} files artifact files, paths relative to its root
 * @param {string[]} specs the spec folders under `e2e/visual/__screenshots__`
 * @returns {{ updates: { from: string, to: string }[], unstable: string[] }}
 */
export function planBaselines(files, specs) {
    const byTarget = new Map();
    for (const { path, hash } of files) {
        const match = ACTUAL.exec(path);
        if (!match) continue;
        const [, folder, snapshot] = match;
        const spec = specs.find((name) => folder.startsWith(`${name.replace(/\.spec\.[cm]?js$/, '')}-`));
        if (!spec) continue;
        const to = `e2e/visual/__screenshots__/${spec}/${snapshot}.png`;
        const seen = byTarget.get(to) || [];
        seen.push({ path, hash });
        byTarget.set(to, seen);
    }
    const updates = [];
    const unstable = [];
    for (const [to, attempts] of [...byTarget].sort(([a], [b]) => a.localeCompare(b))) {
        if (new Set(attempts.map((attempt) => attempt.hash)).size > 1) unstable.push(to);
        else updates.push({ from: attempts[0].path, to });
    }
    return { updates, unstable };
}
