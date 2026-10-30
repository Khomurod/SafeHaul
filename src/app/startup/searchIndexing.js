/**
 * Keeps every copy of the app but `app.safehaul.io` out of search results.
 *
 * Testing (`truckerapp-system.web.app`) runs against the real backend, so a
 * driver who found it in a search would file a real application through an
 * unreleased build. A header cannot do this: Production is promoted by cloning
 * the tested Hosting version, headers included (`promote-production.yml`), so an
 * `X-Robots-Tag` on Testing would reach `app.safehaul.io` on the next release.
 * The bundle is the same on every host, so it decides by the host it runs on,
 * which also covers Production's own `*.web.app` address.
 */
export const CANONICAL_APP_HOST = 'app.safehaul.io';

export function keepNonCanonicalHostsOutOfSearch(doc = document, loc = window.location) {
    if (loc.hostname === CANONICAL_APP_HOST) return;
    if (doc.querySelector('meta[name="robots"]')) return;
    const meta = doc.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    doc.head.appendChild(meta);
}
