/**
 * The text cut after each of its dots, the dots kept: "john.doe@" is "john."
 * and "doe@". The same pieces as `text.split(/(?<=\.)/)`, without the
 * look-behind: Safari and every iPhone browser before 16.4 cannot read one, and
 * the one `BreakableText` had stopped the whole Settings page from loading there.
 */
export function splitAfterDots(text) {
    const parts = text.split('.');
    const pieces = parts.slice(0, -1).map((part) => `${part}.`);
    const last = parts[parts.length - 1];
    return last === '' && pieces.length > 0 ? pieces : [...pieces, last];
}
