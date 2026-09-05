/**
 * The allowlist's key format, and how to read an older one.
 *
 * ## Why the keys moved
 *
 * Version 1 keyed every entry relative to `src/`, because `src/` was the only
 * thing the guard walked. Widening the scan to `index.html` — which Tailwind
 * compiles, and which had carried `<body class="bg-gray-50">` unseen for the
 * whole campaign — put a file OUTSIDE `src/` into the inventory, and there is no
 * honest `src/`-relative name for it. So version 2 keys everything from the
 * repository root: `src/features/…/Thing.jsx`, `index.html`.
 *
 * ## Why this is a function and not a one-off rewrite
 *
 * The inventory is compared against the base commit now
 * (`./baseline.mjs`), and the base is version 1. Without a normaliser, the
 * version bump would read as **43 files deleted and 43 files added** — every
 * entry refused as "a new exemption", and the migration impossible to land.
 *
 * So both sides are normalised to repo-relative before anything is compared:
 * the live loader normalises what it reads from disk, and `readAllowlistAt`
 * normalises what it reads out of git. A v1 base and a v2 branch then compare
 * equal, which is the only way a key-format change can pass a guard that
 * refuses additions.
 *
 * The reverse also has to hold, and it is the easier half to forget: reading a
 * v2 document must be the identity, or normalising twice would prefix `src/`
 * onto keys that already carry it.
 */

/** The format the checker writes today. */
export const ALLOWLIST_VERSION = 2;

/**
 * A file map keyed from the repository root, whatever version it arrived as.
 *
 * @param {object} document the parsed allowlist (`{version?, files}`)
 * @returns {object} `files`, repo-relative
 */
export function normaliseAllowlist(document) {
    const files = document?.files ?? {};
    /*
     * `>= ALLOWLIST_VERSION` rather than `=== `: a document from a FUTURE
     * version is already repo-relative too, and silently re-prefixing it would
     * be worse than reading it as-is. An absent version means 1 — the field did
     * not exist then.
     */
    if (Number(document?.version ?? 1) >= ALLOWLIST_VERSION) return files;

    return Object.fromEntries(
        Object.entries(files).map(([key, entry]) => [
            key.startsWith('src/') ? key : `src/${key}`,
            entry,
        ]),
    );
}
