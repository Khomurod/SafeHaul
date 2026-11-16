/**
 * The letters an initials disc (`Avatar`) shows for a name: the first letter
 * or digit of each of the first two words, in capitals — "Maria Garcia" is
 * "MG", "Ana Lucia Ferreira-Montgomery" is "AL", "company_admin" is "C".
 *
 * A hyphen joins two names that are each a word here, as people shorten them:
 * "Jean-Baptiste Okonkwo" is "JB", "Maria-Annunziata Delacroix-Whitfield" is
 * "MA" (C2). Words are split on any run of whitespace or hyphens, so a doubled
 * space does not lose the second initial, and a word with no letter or digit
 * in it ("—", "&") is skipped rather than shown. Letters outside ASCII are kept whole ("Šimić" is
 * "Š"). An empty string means there is nothing to show: the caller decides
 * what a disc without a name says, or draws `Avatar tone="placeholder"`.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function initialsOf(name) {
    if (typeof name !== 'string') return '';
    return name
        .trim()
        .split(/[\s-]+/)
        .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
}
