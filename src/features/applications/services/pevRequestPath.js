/** A verification request's PDF: `companies/{id}/{collection}/{record}/pev_requests/…`, signed by `getSignedPevUrl`. */
export function isPevRequestPath(path) {
    return typeof path === 'string' && /^companies\/[^/]+\/[^/]+\/[^/]+\/pev_requests\/./.test(path);
}
