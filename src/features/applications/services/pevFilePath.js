/**
 * A verification's file in the PEV folders, signed by `getSignedPevUrl`: a request's PDF
 * (`companies/{id}/{collection}/{record}/pev_requests/…`) or a result, the portal answer's PDF or
 * an uploaded one (`…/pev_results/…`).
 */
export function isPevFilePath(path) {
    return typeof path === 'string' && /^companies\/[^/]+\/[^/]+\/[^/]+\/pev_(requests|results)\/./.test(path);
}
