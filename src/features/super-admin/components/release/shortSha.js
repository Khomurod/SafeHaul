/** A commit as its seven-character short hash, or null when there is none. */
export function shortSha(sha) {
    return typeof sha === 'string' && sha.trim() !== '' ? sha.slice(0, 7) : null;
}
